import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { calculateItems } from '../public/money.js';

const customer = { name: '虚构测试客户', contact: '测试员', phone: '010-0000-0000', email: '', address: '', notes: '自动化测试虚构信息' };
function quote(customerId) { return { customerId, title: '中文商品报价', quoteDate: '2026-10-21', validUntil: '2026-11-21', nextFollowUp: '2026-10-25', notes: '', items: [{ name: '商品', unit: '个', quantity: '3', unitPrice: '19.90' }, { name: '服务', unit: '小时', quantity: '1.5', unitPrice: '100.05' }] }; }

test('金额按分运算：十进制精度、数量三位小数与逐项四舍五入', () => {
  assert.equal(calculateItems([{ quantity: '3', unitPrice: '0.10' }]).totalCents, 30);
  const result = calculateItems(quote('').items);
  assert.deepEqual(result.items.map(i => i.amountCents), [5970, 15008]);
  assert.equal(result.totalCents, 20978);
  assert.equal(calculateItems([{ quantity: '0.005', unitPrice: '1.00' }]).totalCents, 1);
});
test('拒绝负数、零数量、科学计数、超精度和超大金额', () => {
  for (const [quantity, unitPrice] of [['-1', '2'], ['0', '2'], ['1e2', '2'], ['1.0001', '2'], ['1', '2.001'], ['99999999', '99999999']]) {
    assert.throws(() => calculateItems([{ quantity, unitPrice }]));
  }
});
test('首次启动提供五组虚构数据，编辑客户保留历史报价快照', () => {
  const s = new Store(':memory:');
  assert.equal(s.customers().length, 5); assert.equal(s.quotes().length, 5);
  const q = s.quotes()[0], c = s.customer(q.customerId);
  const { id, createdAt, updatedAt, ...input } = c;
  s.saveCustomer({ ...input, name: '已修改名称' }, id);
  assert.equal(s.customer(id).name, '已修改名称');
  assert.equal(s.quote(q.id).customerSnapshot.name, c.name);
  s.close();
});
test('报价输入校验、失效客户和编辑冲突不会写入错误记录', () => {
  const s = new Store(':memory:', { seed: false });
  const c = s.saveCustomer(customer), input = quote(c.id);
  assert.throws(() => s.saveQuote({ ...input, validUntil: '2026-02-30' }));
  assert.throws(() => s.saveQuote({ ...input, validUntil: '2026-10-01' }));
  assert.throws(() => s.saveQuote({ ...input, customerId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' }));
  const q = s.saveQuote(input);
  s.followUp(q.id, { status: 'won', nextFollowUp: '', note: '已确认' });
  assert.throws(() => s.saveQuote(input, q.id, q.version), /发生变化/);
  assert.equal(s.quotes().length, 1); assert.equal(s.quote(q.id).status, 'won');
  s.close();
});
test('文件 SQLite 关闭并重新打开后保留客户、报价、金额、跟进和商家设置', () => {
  const folder = mkdtempSync(join(tmpdir(), 'merchant-persistence-'));
  try {
    let s = new Store(join(folder, 'db.sqlite'), { seed: false });
    const c = s.saveCustomer(customer), q = s.saveQuote(quote(c.id));
    s.followUp(q.id, { status: 'won', nextFollowUp: '2026-11-01', note: '持久化跟进' });
    s.setMerchant({ ...s.merchant(), name: '测试商家' }); s.close();
    s = new Store(join(folder, 'db.sqlite'));
    assert.equal(s.customers().length, 1); assert.equal(s.quote(q.id).totalCents, 20978);
    assert.equal(s.quote(q.id).followUps[0].note, '持久化跟进');
    assert.equal(s.quote(q.id).status, 'won'); assert.equal(s.merchant().name, '测试商家'); s.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
test('备份恢复原子替换并保留恢复前文件，篡改金额和重复关联会被拒绝', () => {
  const folder = mkdtempSync(join(tmpdir(), 'merchant-restore-'));
  const s = new Store(join(folder, 'db.sqlite'));
  try {
    const backup = s.backup();
    s.saveCustomer({ ...customer, name: '恢复前新增' });
    const result = s.restore(backup);
    assert.equal(s.customers().length, 5); assert.equal(s.quotes().length, 5);
    assert.ok(readdirSync(join(folder, 'backups')).includes(result.safetyBackup));
    const bad = structuredClone(backup); bad.quotes[0].totalCents++;
    assert.throws(() => s.restore(bad));
    const duplicate = structuredClone(backup); duplicate.customers.push(duplicate.customers[0]);
    assert.throws(() => s.restore(duplicate));
    const broken = structuredClone(backup); broken.customers = [];
    assert.throws(() => s.restore(broken));
    assert.equal(s.quotes()[0].totalCents, backup.quotes.at(-1).totalCents);
    assert.equal(s.customers().length, 5);
  } finally { s.close(); rmSync(folder, { recursive: true, force: true }); }
});
