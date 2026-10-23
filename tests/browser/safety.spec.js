import { test as baseTest, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { Store } from '../../src/store.js';
import { today, addDays } from '../../src/validation.js';

const merchant = {
  name: '旧库虚构印务商家', contact: '虚构负责人', phone: '010-0000-0077',
  address: '演示市 旧库验收路 7 号（虚构）', terms: '旧库约定：先确认样稿，再预付 30%；验收后结清。',
};
const mutationHeaders = { 'X-Requested-With': 'merchant-quotes' };

async function start(dataDir) {
  const service = spawn(process.execPath, ['src/server.js'], {
    cwd: resolve('.'),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: dataDir, SEED_DEMO: 'false', APP_PASSWORD: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const base = await new Promise((resolveStart, reject) => {
      let output = '', ready = false;
      const timer = setTimeout(() => reject(new Error(`安全回归服务启动超时：${output}`)), 15000);
      service.stdout.on('data', bytes => {
        output += bytes;
        const address = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (!address || ready) return;
        ready = true; clearTimeout(timer);
        resolveStart(`http://127.0.0.1:${address[1]}`);
      });
      service.stderr.on('data', bytes => output += bytes);
      service.once('error', error => { clearTimeout(timer); reject(error); });
      service.once('exit', code => {
        if (!ready) { clearTimeout(timer); reject(new Error(`安全回归服务提前退出（${code}）：${output}`)); }
      });
    });
    return { service, base };
  } catch (error) {
    await stop(service);
    throw error;
  }
}

async function stop(service) {
  if (service?.exitCode === null && service.pid) {
    service.kill('SIGTERM');
    await once(service, 'exit');
  }
}

// Each case owns a separate database and child server. Existing data/ is never opened.
const test = baseTest.extend({
  sandbox: async ({}, use) => {
    const dataDir = mkdtempSync(join(tmpdir(), 'merchant-safety-browser-'));
    let running;
    try {
      const store = new Store(join(dataDir, 'quotes.sqlite'), { seed: false });
      let customer, quote, input;
      try {
        store.setMerchant(merchant);
        customer = store.saveCustomer({ name: '旧库虚构客户', contact: '虚构店长', phone: '010-0000-0078', email: '', address: '演示市 虚构客户路 8 号', notes: '仅用于安全回归。' });
        input = { customerId: customer.id, title: '旧库自有报价', quoteDate: today(), validUntil: addDays(today(), 14),
          items: [{ name: '虚构印务服务', quantity: '2', unit: '套', unitPrice: '80.00' }], notes: '原始报价说明。', nextFollowUp: '' };
        quote = store.saveQuote(input);
        expect(store.workspace()).toMatchObject({ setupCompleted: false, customerCount: 1, quoteCount: 1, removableDemoCustomers: 0, removableDemoQuotes: 0 });
      } finally { store.close(); }
      running = await start(dataDir);
      await use({ base: running.base, customer, quote, input });
    } finally {
      await stop(running?.service);
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
});

test('旧库首次配置默认保留商家全部资料、条款与已有客户报价', async ({ page, sandbox }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${sandbox.base}/#settings`);
  await expect(page.locator('#merchant-name')).toHaveText(merchant.name);
  await page.getByRole('button', { name: '配置我的商家', exact: true }).click();
  const setup = page.locator('#setup-form');
  for (const [name, value] of Object.entries(merchant)) {
    await expect(setup.locator(`[name=${name}]`)).toHaveValue(value);
  }
  await expect(setup.locator('[name=dataAction]')).toHaveValue('keep');
  await expect(setup.locator('[name=dataAction] option[value=remove_demo]')).toHaveCount(0);
  await expect(setup).toContainText('1 位客户 / 1 份报价');
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${sandbox.base}/api/setup`);
  await setup.getByRole('button', { name: '保存并开始使用', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.locator('.setup-banner')).toHaveCount(0);
  const response = await page.request.get(`${sandbox.base}/api/bootstrap`);
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.merchant).toEqual(merchant);
  expect(data.customers).toEqual([sandbox.customer]);
  expect(data.quotes).toEqual([sandbox.quote]);
  expect(data.workspace).toMatchObject({ setupCompleted: true, customerCount: 1, quoteCount: 1 });
  await page.reload();
  for (const [name, value] of Object.entries(merchant)) {
    await expect(page.locator(`#merchant-form [name=${name}]`)).toHaveValue(value);
  }
  expect(errors).toEqual([]);
});

test('内联新增客户后旧报价草稿仍以原版本提交，409 不覆盖新版或误建单', async ({ page, sandbox }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(sandbox.base);
  await page.getByRole('button', { name: `查看 ${sandbox.quote.title}`, exact: true }).click();
  await page.getByRole('button', { name: '编辑报价', exact: true }).click();
  const staleTitle = '旧版本草稿不得覆盖新报价';
  const staleNotes = '此草稿在内联新增客户前填写，应保留但不能提交覆盖。';
  await page.locator('#quote-form [name=title]').fill(staleTitle);
  await page.locator('#quote-form [name=notes]').fill(staleNotes);
  await page.locator('#quote-form #price-0').fill('9.99');
  await page.locator('#quote-form [data-action=inline-customer]').click();
  await expect(page.locator('#customer-form')).toBeVisible();

  const newerInput = { ...sandbox.input, title: '另一窗口确认的新报价（版本 2）', notes: '另一窗口已经确认，禁止旧草稿覆盖。',
    items: [{ name: '虚构印务服务', quantity: '3', unit: '套', unitPrice: '88.00' }] };
  const updated = await page.request.put(`${sandbox.base}/api/quotes/${sandbox.quote.id}`, {
    headers: mutationHeaders, data: { ...newerInput, version: sandbox.quote.version },
  });
  expect(updated.status()).toBe(200);
  const newerQuote = await updated.json();
  expect(newerQuote).toMatchObject({ version: 2, title: newerInput.title, totalCents: 26400, customerId: sandbox.customer.id });

  const inlineName = '内联新增虚构客户';
  await page.locator('#customer-form [name=name]').fill(inlineName);
  await page.locator('#customer-form [name=phone]').fill('010-0000-0079');
  await page.getByRole('button', { name: '保存客户', exact: true }).click();
  const quoteForm = page.locator('#quote-form');
  await expect(quoteForm).toBeVisible();
  await expect(quoteForm.locator('#customerId option:checked')).toHaveText(inlineName);
  await expect(quoteForm.locator('[name=title]')).toHaveValue(staleTitle);
  await expect(quoteForm.locator('[name=notes]')).toHaveValue(staleNotes);
  await expect(page.locator('#quote-total')).toHaveText('¥19.98');
  const rejected = page.waitForResponse(response => response.request().method() === 'PUT' && response.url() === `${sandbox.base}/api/quotes/${sandbox.quote.id}`);
  await quoteForm.getByRole('button', { name: '保存修改', exact: true }).click();
  const conflict = await rejected;
  expect(conflict.request().postDataJSON()).toMatchObject({ version: 1, title: staleTitle, notes: staleNotes });
  expect(conflict.status()).toBe(409);
  await expect(quoteForm.getByRole('alert')).toHaveText('报价已发生变化，请重新打开后编辑');
  await expect(quoteForm.locator('[name=title]')).toHaveValue(staleTitle);
  await expect(quoteForm.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
  const current = await page.request.get(`${sandbox.base}/api/quotes/${sandbox.quote.id}`);
  expect(current.status()).toBe(200);
  expect(await current.json()).toEqual(newerQuote);
  const data = await (await page.request.get(`${sandbox.base}/api/bootstrap`)).json();
  expect(data.quotes).toEqual([newerQuote]);
  expect(data.customers).toHaveLength(2);
  expect(data.customers.map(customer => customer.name)).toContain(inlineName);
  expect(errors).toEqual([]);
});
