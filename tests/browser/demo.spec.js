import { test, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

test.describe.configure({ mode: 'serial' });
let processHandle, dataDir, base, port = '0', backupPath;
const evidence = resolve('docs/evidence');
const errors = [];
async function start() {
  processHandle = spawn(process.execPath, ['src/server.js'], { cwd: resolve('.'), env: { ...process.env, HOST: '127.0.0.1', PORT: port, DATA_DIR: dataDir, SEED_DEMO: 'true', APP_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolveStart, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`服务启动超时：${output}`)), 15000);
    processHandle.stdout.on('data', bytes => { output += bytes; const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); port = match[1]; base = `http://127.0.0.1:${port}`; resolveStart(); } });
    processHandle.stderr.on('data', bytes => output += bytes);
    processHandle.once('exit', code => { if (code) { clearTimeout(timer); reject(new Error(output)); } });
  });
}
async function stop() { if (processHandle?.exitCode === null) { processHandle.kill('SIGTERM'); await once(processHandle, 'exit'); } }
test.beforeAll(async () => { dataDir = mkdtempSync(join(tmpdir(), 'merchant-browser-')); await start(); });
test.afterAll(async () => { await stop(); rmSync(dataDir, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => { page.on('pageerror', e => errors.push(e.message)); });

test('手机完整演示：新增客户 → 报价计算 → 中文 PDF → 跟进成交 → 服务重启', async ({ page }) => {
  await page.goto(base);
  await expect(page.getByRole('heading', { name: '每一份报价，都向前一步。' })).toBeVisible();
  await page.screenshot({ path: join(evidence, 'mobile-dashboard.png'), fullPage: true });
  await page.getByRole('link', { name: '客户', exact: true }).click();
  await page.getByRole('button', { name: '新增客户', exact: true }).click();
  await page.getByLabel('客户 / 公司名称').fill('演示验收商店');
  await page.getByLabel('联系人', { exact: true }).fill('虚构店长');
  await page.getByLabel('联系电话', { exact: true }).fill('010-0000-0099');
  await page.getByLabel('地址', { exact: true }).fill('演示市 验收路 1 号（虚构）');
  await page.getByRole('button', { name: '保存客户', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.getByRole('textbox', { name: '搜索客户' }).fill('验收商店');
  await expect(page.locator('.customer-card')).toHaveCount(1);
  await page.getByRole('button', { name: '编辑客户' }).click();
  await page.getByLabel('联系电话', { exact: true }).fill('010-0000-0088');
  await page.getByRole('button', { name: '保存客户', exact: true }).click();
  await expect(page.locator('.customer-card')).toContainText('010-0000-0088');
  await page.getByRole('button', { name: '为他报价' }).click();
  await expect(page.locator('#customerId option:checked')).toHaveText('演示验收商店');
  await page.getByLabel('报价名称').fill('手机演示中文报价');
  await page.getByRole('textbox', { name: '第 1 项名称' }).fill('中文展示架');
  await page.getByLabel('数量', { exact: true }).fill('3');
  await page.getByLabel('单位', { exact: true }).fill('个');
  await page.getByLabel('单价（元）', { exact: true }).fill('19.90');
  await page.getByRole('button', { name: '添加一项' }).click();
  await page.getByRole('textbox', { name: '第 2 项名称' }).fill('中文安装服务');
  await page.locator('#qty-1').fill('1.5');
  await page.locator('#unit-1').fill('小时');
  await page.locator('#price-1').fill('100.05');
  await page.getByLabel('报价说明').fill('此报价用于虚构商家验收，含中文商品和小数数量。');
  await expect(page.locator('#quote-total')).toHaveText('¥209.78');
  await page.screenshot({ path: join(evidence, 'mobile-quote-form.png'), fullPage: true });
  await page.getByRole('button', { name: '保存报价', exact: true }).click();
  await expect(page.locator('.detail-title')).toHaveText('手机演示中文报价');
  await expect(page.locator('#modal .total-strip strong')).toHaveText('¥209.78');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出中文 PDF' }).click();
  const pdf = await downloadPromise; await pdf.saveAs(join(evidence, 'demo-chinese-quote.pdf'));
  expect(readFileSync(join(evidence, 'demo-chinese-quote.pdf')).subarray(0, 4).toString()).toBe('%PDF');
  // Poppler is optional for ordinary development; acceptance in this environment requires it.
  const text = execFileSync('pdftotext', ['-layout', join(evidence, 'demo-chinese-quote.pdf'), '-'], { encoding: 'utf8' });
  expect(text).toContain('演示验收商店'); expect(text).toContain('中文安装服务'); expect(text).toContain('209.78');
  writeFileSync(join(evidence, 'demo-pdf-text.txt'), text);
  await page.locator('#status').selectOption('won');
  await page.getByLabel('下次跟进', { exact: true }).fill('2026-11-01');
  await page.getByLabel('本次跟进记录').fill('虚构店长已确认报价，演示成交。');
  await page.getByRole('button', { name: '保存跟进', exact: true }).click();
  await expect(page.locator('.detail-meta .pill')).toHaveText('已成交');
  await expect(page.locator('.followup-history')).toContainText('虚构店长已确认报价，演示成交。');
  await page.screenshot({ path: join(evidence, 'mobile-quote-detail.png'), fullPage: true });
  await stop(); await start();
  await page.goto(base + '/#quotes');
  await page.reload(); // A hash-only navigation keeps the previous document and dialog alive.
  await page.getByRole('textbox', { name: '搜索报价' }).fill('手机演示中文报价');
  await expect(page.locator('.quote-row')).toHaveCount(1);
  await expect(page.locator('.quote-row')).toContainText('已成交');
  await expect(page.locator('.quote-row')).toContainText('209.78');
  await page.locator('.quote-row').click();
  await expect(page.locator('.followup-history')).toContainText('虚构店长已确认报价，演示成交。');
  await expect(page.locator('.detail-parties')).toContainText('010-0000-0088');
  expect(errors).toEqual([]);
});

test('手机备份恢复：下载、改变数据、上传备份、校验状态和恢复前副本', async ({ page }) => {
  await page.goto(base + '/#settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份' }).click();
  backupPath = join(dataDir, 'browser-backup.json'); await (await downloadPromise).saveAs(backupPath);
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  expect(backup.customers.length).toBe(6); expect(backup.quotes.length).toBe(6);
  const q = backup.quotes.find(q => q.title === '手机演示中文报价'); expect(q.status).toBe('won');
  await page.getByRole('link', { name: '报价单', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索报价' }).fill('手机演示中文报价');
  await page.locator('.quote-row').click(); await page.locator('#status').selectOption('lost');
  await page.getByRole('button', { name: '保存跟进', exact: true }).click();
  await expect(page.locator('.detail-meta .pill')).toHaveText('未成交');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('link', { name: '商家设置', exact: true }).click();
  await page.locator('#restore-file').setInputFiles(backupPath);
  await expect(page.locator('.restore-summary')).toContainText('6 位客户 / 6 份报价');
  await page.getByRole('button', { name: '确认替换并恢复' }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.getByRole('link', { name: '报价单', exact: true }).click();
  await expect(page.locator('.quote-row')).toContainText('已成交');
  expect(readdirSync(join(dataDir, 'backups')).length).toBe(1);
  expect(errors).toEqual([]);
});

test('320px、390px、768px 和桌面主要页面无横向溢出，保存桌面截图', async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['quotes', 'customers', 'followups', 'settings']) {
      await page.goto(base + '/#' + view);
      await expect(page.locator('#page-label')).toHaveText({ quotes: '报价单', customers: '客户管理', followups: '跟进日程', settings: '商家设置' }[view]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
  await page.goto(base + '/#quotes');
  await expect(page.locator('.quote-row')).toHaveCount(6);
  await page.screenshot({ path: join(evidence, 'desktop-dashboard.png'), fullPage: true });
  expect(errors).toEqual([]);
});
