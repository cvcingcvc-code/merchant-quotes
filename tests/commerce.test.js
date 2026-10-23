import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';

const merchant = { name: '虚构商家正式配置', contact: '测试负责人', phone: '010-0000-0090', address: '虚构测试地址', terms: '本报价以双方最终确认内容为准。' };
const customerInput = c => Object.fromEntries(['name', 'contact', 'phone', 'email', 'address', 'notes'].map(k => [k, c[k]]));
const quoteInput = q => ({ customerId: q.customerId, title: q.title, quoteDate: q.quoteDate, validUntil: q.validUntil, items: q.items.map(({ name, quantity, unit, unitPrice }) => ({ name, quantity, unit, unitPrice })), notes: q.notes, nextFollowUp: q.nextFollowUp });
const setup = (s, dataAction = 'remove_demo', confirmation = '') => ({ merchant, dataAction, confirmation, expectedRevision: s.workspace().revision });
function diskStore(fn) {
  const directory = mkdtempSync(join(tmpdir(), 'merchant-trial-'));
  const s = new Store(join(directory, 'db.sqlite'));
  try { fn(s, directory); } finally { s.close(); rmSync(directory, { recursive: true, force: true }); }
}

test('正式配置移除未修改示例，保护编辑过的客户及自己报价引用的客户', () => diskStore((s, directory) => {
  const customers = s.customers();
  const changed = customers[0], referenced = customers[1];
  s.saveCustomer({ ...customerInput(changed), contact: '自己更正的联系人' }, changed.id);
  const template = s.quotes().find(q => q.customerId === referenced.id);
  const ownQuote = s.saveQuote({ ...quoteInput(template), title: '自己创建的报价' });
  const own = s.saveCustomer({ ...customerInput(customers[2]), name: '山野咖啡', notes: '这是自己录入的虚构测试资料' });
  assert.equal(s.workspace().removableDemoCustomers, 3);
  const result = s.completeSetup(setup(s));
  assert.equal(result.removedCustomers, 3); assert.equal(result.removedQuotes, 4);
  assert.equal(s.customer(changed.id).contact, '自己更正的联系人');
  assert.equal(s.customer(referenced.id).id, referenced.id); assert.equal(s.customer(own.id).id, own.id);
  assert.equal(s.quote(ownQuote.id).title, '自己创建的报价');
  assert.equal(s.workspace().setupCompleted, true); assert.equal(s.merchant().name, merchant.name);
  const backup = JSON.parse(readFileSync(join(directory, 'backups', result.safetyBackup), 'utf8'));
  assert.equal(backup.customers.length, 6); assert.equal(backup.quotes.length, 6);
  assert.equal(backup.workspace.setupCompleted, false); assert.equal(backup.schemaVersion, 2);
  assert.throws(() => s.completeSetup(setup(s)), /已完成初始化/);
}));

test('跟进过的示例成为自己管理的记录，首次清理保留它和客户', () => {
  const s = new Store(':memory:'); const q = s.quotes()[0];
  s.followUp(q.id, { status: 'won', nextFollowUp: '', note: '自己确认的合作' });
  assert.equal(s.quote(q.id).source, undefined);
  s.completeSetup(setup(s));
  assert.equal(s.quotes().length, 1); assert.equal(s.customers().length, 1);
  assert.equal(s.quote(q.id).followUps[0].note, '自己确认的合作'); s.close();
});

test('配置前备份失败或预览后资料改变，均不会删除或覆盖商家数据', () => diskStore(s => {
  const stale = setup(s);
  s.saveCustomer({ ...customerInput(s.customers()[0]), name: '后来新增的客户' });
  assert.throws(() => s.completeSetup(stale), /资料发生变化/);
  const oldMerchant = s.merchant();
  s.safetyBackup = () => { throw new Error('simulated disk failure'); };
  assert.throws(() => s.completeSetup(setup(s)), /disk failure/);
  assert.equal(s.customers().length, 6); assert.equal(s.quotes().length, 5);
  assert.deepEqual(s.merchant(), oldMerchant); assert.equal(s.workspace().setupCompleted, false);
}));

test('明确清空全部资料必须输入确认，清空前备份可恢复整个原工作区', () => diskStore((s, directory) => {
  assert.throws(() => s.completeSetup(setup(s, 'clear_all', 'wrong')), /确认/);
  assert.equal(s.customers().length, 5);
  const result = s.completeSetup(setup(s, 'clear_all', '清空全部客户和报价'));
  assert.equal(s.customers().length, 0); assert.equal(s.quotes().length, 0);
  s.restore(JSON.parse(readFileSync(join(directory, 'backups', result.safetyBackup), 'utf8')));
  assert.equal(s.customers().length, 5); assert.equal(s.quotes().length, 5);
  assert.equal(s.workspace().setupCompleted, false); assert.equal(s.workspace().removableDemoCustomers, 5);
}));

test('旧版数据库和 v1 备份均保留现有资料，不按名称推断为可删除样例', () => diskStore((s, directory) => {
  const backup = s.backup(); backup.schemaVersion = 1; delete backup.workspace;
  s.restore(backup);
  assert.equal(s.workspace().setupCompleted, true);
  assert.equal(s.workspace().removableDemoCustomers, 0);
  assert.ok(s.customers().every(c => c.source === undefined));
  assert.ok(s.quotes().every(q => q.source === undefined));
  s.db.exec('DROP TABLE app_meta; PRAGMA user_version=1');
  const second = new Store(join(directory, 'db.sqlite'));
  try {
    assert.equal(second.workspace().removableDemoQuotes, 0);
    second.completeSetup(setup(second));
    assert.equal(second.customers().length, 5); assert.equal(second.quotes().length, 5);
  } finally { second.close(); }
}));

test('编辑报价默认冻结资料，明确勾选才更新该单快照，其他报价不变', () => {
  const s = new Store(':memory:'); const q = s.quotes()[0], c = s.customer(q.customerId);
  const another = s.saveQuote(quoteInput(q));
  s.saveCustomer({ ...customerInput(c), phone: '010-0000-0081', address: '更正后的虚构地址' }, c.id);
  s.setMerchant({ ...merchant, name: '更新后的虚构商家' });
  const frozen = s.saveQuote(quoteInput(q), q.id, q.version);
  assert.equal(frozen.customerSnapshot.phone, c.phone); assert.equal(frozen.merchantSnapshot.name, q.merchantSnapshot.name);
  const updated = s.saveQuote({ ...quoteInput(q), refreshCustomerSnapshot: true, refreshMerchantSnapshot: true }, q.id, frozen.version);
  assert.equal(updated.customerSnapshot.phone, '010-0000-0081'); assert.equal(updated.merchantSnapshot.name, '更新后的虚构商家');
  assert.equal(s.quote(another.id).customerSnapshot.phone, c.phone);
  assert.equal(s.quote(another.id).merchantSnapshot.name, q.merchantSnapshot.name);
  s.close();
});

test('复制按新报价生成编号和当前资料，原单成交状态与跟进历史不变', () => {
  const s = new Store(':memory:'); const q = s.quotes()[0];
  s.followUp(q.id, { status: 'won', nextFollowUp: '', note: '原报价已成交' });
  const original = s.quote(q.id), c = s.customer(q.customerId);
  s.saveCustomer({ ...customerInput(c), contact: '最新联系人' }, c.id);
  const copy = s.saveQuote({ ...quoteInput(original), title: '原报价副本', nextFollowUp: '' });
  assert.notEqual(copy.id, original.id); assert.notEqual(copy.number, original.number);
  assert.equal(copy.status, 'pending'); assert.equal(copy.followUps.length, 0);
  assert.equal(copy.source, undefined); assert.equal(copy.customerSnapshot.contact, '最新联系人');
  assert.deepEqual(s.quote(original.id), original); s.close();
});

test('较新数据库拒绝被旧应用打开，不覆盖版本或现有记录', () => diskStore((s, directory) => {
  s.db.pragma('user_version = 3');
  assert.throws(() => new Store(join(directory, 'db.sqlite')), /较新版本/);
  assert.equal(s.db.pragma('user_version', { simple: true }), 3);
  assert.equal(s.customers().length, 5); assert.equal(s.quotes().length, 5);
}));
