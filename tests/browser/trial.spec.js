import { test, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

test.describe.configure({ mode: 'serial' });

const evidence = resolve('docs/evidence');
const merchantName = '试售验收图文工作室';
const updatedMerchantName = '试售验收图文工作室（更新）';
const customerName = '试售虚构客户';
const originalTitle = '试售报价主单';
const copiedTitle = `${originalTitle}（副本）`;
const originalNote = '首批试售虚构成交记录';
const errors = [];
let service, dataDir, base, port = '0', serverDay, originalNumber, copiedNumber, backupPath;

const addDays = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

async function start() {
  service = spawn(process.execPath, ['src/server.js'], {
    cwd: resolve('.'),
    env: { ...process.env, HOST: '127.0.0.1', PORT: port, DATA_DIR: dataDir, SEED_DEMO: 'true', APP_PASSWORD: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolveStart, reject) => {
    let output = '', ready = false;
    const timer = setTimeout(() => reject(new Error(`试售服务启动超时：${output}`)), 15000);
    service.stdout.on('data', bytes => {
      output += bytes;
      const address = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (!address || ready) return;
      ready = true; clearTimeout(timer);
      port = address[1]; base = `http://127.0.0.1:${port}`;
      resolveStart();
    });
    service.stderr.on('data', bytes => output += bytes);
    service.once('error', error => { clearTimeout(timer); reject(error); });
    service.once('exit', code => {
      if (!ready) { clearTimeout(timer); reject(new Error(`试售服务提前退出（${code}）：${output}`)); }
    });
  });
}

async function stop() {
  if (service?.exitCode === null) {
    service.kill('SIGTERM');
    await once(service, 'exit');
  }
}

async function section(page, name, label) {
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.locator('#page-label')).toHaveText(label);
}

async function closeDialog(page) {
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
}

async function openQuote(page, title) {
  await section(page, '报价单', '报价单');
  await page.getByRole('textbox', { name: '搜索报价' }).fill(title);
  await page.getByRole('button', { name: `查看 ${title}`, exact: true }).click();
  await expect(page.locator('.detail-title')).toHaveText(title);
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'merchant-trial-browser-'));
  mkdirSync(evidence, { recursive: true });
  await start();
});
test.afterAll(async () => {
  await stop();
  rmSync(dataDir, { recursive: true, force: true });
});
test.beforeEach(async ({ page }) => { page.on('pageerror', error => errors.push(error.message)); });

test('手机正式配置 → 自有报价成交 → 更正单据资料及中文 PDF', async ({ page }) => {
  await page.goto(base);
  await expect(page.locator('.quote-row')).toHaveCount(5);
  await page.getByRole('button', { name: '配置我的商家', exact: true }).click();
  const setup = page.locator('#setup-form');
  await expect(setup.locator('[name=dataAction]')).toHaveValue('remove_demo');
  await expect(setup.locator('[name=terms]')).toHaveValue('本报价以双方最终确认内容为准。');
  await setup.locator('[name=name]').fill(merchantName);
  await setup.locator('[name=contact]').fill('虚构负责人');
  await setup.locator('[name=phone]').fill('010-0000-0099');
  await setup.locator('[name=address]').fill('演示市 试售验收路 1 号（虚构）');
  await setup.locator('[name=terms]').fill('服务范围与交付时间以双方最终确认为准。');
  await page.locator('#modal').evaluate(dialog => dialog.scrollTop = 0);
  await page.screenshot({ path: join(evidence, 'trial-onboarding.png'), fullPage: false });
  await setup.getByRole('button', { name: '保存并开始使用', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.locator('.setup-banner')).toHaveCount(0);
  await expect(page.locator('.quote-row')).toHaveCount(0);
  await expect(page.locator('#merchant-name')).toHaveText(merchantName);

  await section(page, '客户', '客户管理');
  await expect(page.locator('.customer-card')).toHaveCount(0);
  await page.getByRole('button', { name: '新增客户', exact: true }).first().click();
  const customer = page.locator('#customer-form');
  await customer.locator('[name=name]').fill(customerName);
  await customer.locator('[name=contact]').fill('虚构店长');
  await customer.locator('[name=phone]').fill('010-0000-0066');
  await customer.locator('[name=address]').fill('演示市 虚构客户路 2 号');
  await customer.getByRole('button', { name: '保存客户', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.locator('.customer-card')).toHaveCount(1);
  await page.getByRole('button', { name: '为他报价' }).click();
  const quote = page.locator('#quote-form');
  await expect(quote.locator('#customerId option:checked')).toHaveText(customerName);
  serverDay = await quote.locator('[name=quoteDate]').inputValue();
  await quote.locator('[name=title]').fill(originalTitle);
  await quote.locator('[name=quoteDate]').fill(addDays(serverDay, -7));
  await quote.locator('[name=validUntil]').fill(addDays(serverDay, 7));
  await quote.getByRole('textbox', { name: '第 1 项名称' }).fill('中文展示架');
  await quote.locator('#qty-0').fill('3');
  await quote.locator('#unit-0').fill('个');
  await quote.locator('#price-0').fill('19.90');
  await quote.getByRole('button', { name: '添加一项' }).click();
  await quote.getByRole('textbox', { name: '第 2 项名称' }).fill('中文安装服务');
  await quote.locator('#qty-1').fill('1.5');
  await quote.locator('#unit-1').fill('小时');
  await quote.locator('#price-1').fill('100.05');
  await quote.locator('[name=nextFollowUp]').fill(addDays(serverDay, 1));
  await quote.locator('[name=notes]').fill('全部内容为独立试售验收虚构资料。');
  await expect(page.locator('#quote-total')).toHaveText('¥209.78');
  await quote.getByRole('button', { name: '保存报价', exact: true }).click();
  await expect(page.locator('.detail-title')).toHaveText(originalTitle);
  originalNumber = await page.locator('.detail-number').textContent();
  await page.locator('#status').selectOption('won');
  await page.locator('#followup-form [name=nextFollowUp]').fill(addDays(serverDay, 2));
  await page.locator('#followup-form [name=note]').fill(originalNote);
  await page.getByRole('button', { name: '保存跟进', exact: true }).click();
  await expect(page.locator('.detail-meta .pill')).toHaveText('已成交');
  await closeDialog(page);

  await section(page, '客户', '客户管理');
  await page.getByRole('button', { name: '编辑客户' }).click();
  await page.locator('#customer-form [name=phone]').fill('010-0000-0088');
  await page.locator('#customer-form [name=address]').fill('演示市 更正后的虚构地址 3 号');
  await page.getByRole('button', { name: '保存客户', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await section(page, '商家设置', '商家设置');
  await page.locator('#merchant-form [name=name]').fill(updatedMerchantName);
  await page.locator('#merchant-form [name=phone]').fill('010-0000-0098');
  await page.getByRole('button', { name: '保存商家信息', exact: true }).click();
  await expect(page.locator('#merchant-name')).toHaveText(updatedMerchantName);

  await openQuote(page, originalTitle);
  await expect(page.locator('.detail-parties')).toContainText('010-0000-0066');
  await expect(page.locator('.detail-parties')).not.toContainText(updatedMerchantName);
  await page.getByRole('button', { name: '编辑报价', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '使用最新客户资料', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: '使用最新商家资料', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: '使用最新客户资料', exact: true }).check();
  await page.getByRole('checkbox', { name: '使用最新商家资料', exact: true }).check();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.locator('.detail-parties')).toContainText('010-0000-0088');
  await expect(page.locator('.detail-parties')).toContainText(updatedMerchantName);
  await expect(page.locator('.detail-meta .pill')).toHaveText('已成交');
  await expect(page.locator('.followup-history')).toContainText(originalNote);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出中文 PDF', exact: true }).click();
  const path = join(evidence, 'trial-updated-quote.pdf');
  await (await downloadPromise).saveAs(path);
  const text = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
  expect(text).toContain(updatedMerchantName);
  expect(text).toContain(customerName);
  expect(text).toContain('010-0000-0088');
  expect(text).toContain('中文安装服务');
  expect(text).toContain('209.78');
  expect(text).not.toContain('010-0000-0066');
  await page.locator('#modal').evaluate(dialog => dialog.scrollTop = 0);
  await page.screenshot({ path: join(evidence, 'trial-updated-quote.png'), fullPage: false });
  expect(errors).toEqual([]);
});

test('复制生成独立新报价 → 下载本机备份 → v2 备份恢复原成交与副本', async ({ page }) => {
  await page.goto(base + '/#quotes');
  await openQuote(page, originalTitle);
  await page.getByRole('button', { name: '复制报价', exact: true }).click();
  const copy = page.locator('#quote-form');
  await expect(copy.locator('[name=title]')).toHaveValue(copiedTitle);
  await expect(copy.locator('[name=quoteDate]')).toHaveValue(serverDay);
  await expect(copy.locator('[name=validUntil]')).toHaveValue(addDays(serverDay, 14));
  await expect(copy.locator('[name=nextFollowUp]')).toHaveValue('');
  await expect(page.locator('#quote-total')).toHaveText('¥209.78');
  await copy.getByRole('button', { name: '保存报价', exact: true }).click();
  await expect(page.locator('.detail-title')).toHaveText(copiedTitle);
  copiedNumber = await page.locator('.detail-number').textContent();
  expect(copiedNumber).not.toBe(originalNumber);
  await expect(page.locator('.detail-meta .pill')).toHaveText('待回复');
  await expect(page.locator('.followup-history')).toHaveCount(0);
  await expect(page.locator('.detail-parties')).toContainText('010-0000-0088');
  await closeDialog(page);
  await openQuote(page, originalTitle);
  await expect(page.locator('.detail-number')).toHaveText(originalNumber);
  await expect(page.locator('.detail-meta .pill')).toHaveText('已成交');
  await expect(page.locator('.followup-history')).toContainText(originalNote);
  await closeDialog(page);

  await section(page, '商家设置', '商家设置');
  const daily = page.locator('.backup-row').filter({ has: page.getByText('每日备份', { exact: true }) });
  const beforeSetup = page.locator('.backup-row').filter({ has: page.getByText('商家配置前备份', { exact: true }) });
  await expect(daily).toHaveCount(1);
  await expect(beforeSetup).toHaveCount(1);
  const dailyDownload = page.waitForEvent('download');
  await daily.getByRole('button', { name: '下载', exact: true }).click();
  const dailyPath = join(dataDir, 'downloaded-daily.json');
  await (await dailyDownload).saveAs(dailyPath);
  const dailyBackup = JSON.parse(readFileSync(dailyPath, 'utf8'));
  expect(dailyBackup.schemaVersion).toBe(2);
  expect(dailyBackup.customers.length).toBe(5);
  expect(dailyBackup.quotes.length).toBe(5);

  const currentDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  backupPath = join(dataDir, 'trial-current-backup.json');
  await (await currentDownload).saveAs(backupPath);
  const current = JSON.parse(readFileSync(backupPath, 'utf8'));
  expect(current.schemaVersion).toBe(2);
  expect(current.workspace.setupCompleted).toBe(true);
  expect(current.customers.length).toBe(1);
  expect(current.quotes.length).toBe(2);
  expect(current.quotes.find(q => q.number === originalNumber).status).toBe('won');
  expect(current.quotes.find(q => q.number === copiedNumber).followUps).toEqual([]);

  await openQuote(page, copiedTitle);
  await page.locator('#status').selectOption('lost');
  await page.locator('#followup-form [name=note]').fill('恢复前的临时虚构修改');
  await page.getByRole('button', { name: '保存跟进', exact: true }).click();
  await expect(page.locator('.detail-meta .pill')).toHaveText('未成交');
  await closeDialog(page);
  await section(page, '商家设置', '商家设置');
  await page.locator('#restore-file').setInputFiles(backupPath);
  await expect(page.locator('.restore-summary')).toContainText('1 位客户 / 2 份报价');
  await page.getByRole('button', { name: '确认替换并恢复', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.locator('.backup-row').filter({ has: page.getByText('恢复前备份', { exact: true }) })).toHaveCount(1);
  await page.locator('#saved-backups').screenshot({ path: join(evidence, 'trial-backups.png') });
  await openQuote(page, copiedTitle);
  await expect(page.locator('.detail-meta .pill')).toHaveText('待回复');
  await expect(page.locator('.followup-history')).toHaveCount(0);
  await closeDialog(page);
  await openQuote(page, originalTitle);
  await expect(page.locator('.detail-meta .pill')).toHaveText('已成交');
  await expect(page.locator('.followup-history')).toContainText(originalNote);
  expect(errors).toEqual([]);
});

test('服务实际重启后保留商家配置、客户、两份独立报价与跟进历史', async ({ page }) => {
  await page.goto(base + '/#quotes');
  await expect(page.locator('.quote-row')).toHaveCount(2);
  await stop();
  await start();
  await page.reload(); // Force a new document and bootstrap request after the process restart.
  await expect(page.locator('.quote-row')).toHaveCount(2);
  await expect(page.locator('.setup-banner')).toHaveCount(0);
  await expect(page.locator('#merchant-name')).toHaveText(updatedMerchantName);
  await expect(page.getByRole('button', { name: `查看 ${originalTitle}`, exact: true })).toContainText('已成交');
  await expect(page.getByRole('button', { name: `查看 ${copiedTitle}`, exact: true })).toContainText('待回复');
  await section(page, '客户', '客户管理');
  await expect(page.locator('.customer-card')).toHaveCount(1);
  await expect(page.locator('.customer-card')).toContainText('010-0000-0088');
  await openQuote(page, originalTitle);
  await expect(page.locator('.detail-number')).toHaveText(originalNumber);
  await expect(page.locator('#modal .total-strip strong')).toHaveText('¥209.78');
  await expect(page.locator('.followup-history')).toContainText(originalNote);
  const retained = readdirSync(join(dataDir, 'backups'));
  expect(retained.filter(name => name.startsWith('before-setup-')).length).toBe(1);
  expect(retained.filter(name => name.startsWith('before-restore-')).length).toBe(1);
  expect(retained.some(name => /^auto-\d{4}-\d{2}-\d{2}\.json$/.test(name))).toBe(true);
  expect(errors).toEqual([]);
});
