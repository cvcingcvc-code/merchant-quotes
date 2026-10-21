import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { createApp } from '../src/app.js';

test('HTTP 客户 → 报价 → PDF → 跟进 → 备份恢复，并拒绝非法请求', async () => {
  const store = new Store(':memory:', { seed: false });
  const server = createApp(store).listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (url, method, body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'merchant-quotes' }, body: JSON.stringify(body) });
  try {
    const c = await (await send('/api/customers', 'POST', { name: 'HTTP 虚构客户', contact: '', phone: '', email: '', address: '', notes: '' })).json();
    const found = await (await fetch(`${base}/api/customers?q=${encodeURIComponent('虚构')}`)).json();
    assert.equal(found[0].id, c.id);
    const response = await send('/api/quotes', 'POST', { customerId: c.id, title: 'HTTP 中文报价', quoteDate: '2026-10-21', validUntil: '2026-11-01', nextFollowUp: '', notes: '', items: [{ name: '中文安装服务', quantity: '2', unitPrice: '99.99', unit: '次' }] });
    assert.equal(response.status, 201); const q = await response.json(); assert.equal(q.totalCents, 19998);
    const pdf = await fetch(`${base}/api/quotes/${q.id}/pdf`);
    assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /application\/pdf/);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    const followed = await (await send(`/api/quotes/${q.id}/follow-up`, 'PATCH', { status: 'won', nextFollowUp: '2026-11-01', note: '客户已确认' })).json();
    assert.equal(followed.status, 'won'); assert.equal(followed.followUps[0].note, '客户已确认');
    const backup = await (await fetch(base + '/api/backup')).json();
    assert.equal((await send('/api/restore', 'POST', backup)).status, 200);
    assert.equal((await fetch(base + '/api/quotes/missing/pdf')).status, 404);
    assert.equal((await fetch(base + '/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const crossSite = await fetch(base + '/api/merchant', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'merchant-quotes', Origin: 'https://untrusted.example' }, body: '{}' });
    assert.equal(crossSite.status, 403);
    assert.equal((await send('/api/restore', 'POST', { format: 'wrong' })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
test('配置访问密码后页面和数据接口均受保护', async () => {
  const store = new Store(':memory:');
  const server = createApp(store, { password: 'test-password-123' }).listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base + '/api/backup')).status, 401);
    const auth = { Authorization: `Basic ${Buffer.from('merchant:test-password-123').toString('base64')}` };
    assert.equal((await fetch(base + '/api/bootstrap', { headers: auth })).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
