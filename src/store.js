import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { calculateItems } from '../public/money.js';
import { customerInput, merchantInput, quoteInput, followUpInput, backupSchema, today, addDays } from './validation.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const emptyMerchant = { name: '我的商家', contact: '', phone: '', address: '', terms: '本报价以双方最终确认内容为准。' };

export class Store {
  constructor(path, { seed = true } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.path = path;
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE,
        customer_id TEXT NOT NULL REFERENCES customers(id), payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS quotes_customer_idx ON quotes(customer_id);
      PRAGMA user_version = 1;
    `);
    const isNew = !this.db.prepare('SELECT id FROM settings').get();
    if (isNew) {
      this.db.transaction(() => {
        this.setMerchant(emptyMerchant);
        if (seed) this.seed();
      })();
    }
  }
  close() { this.db.close(); }
  merchant() { return JSON.parse(this.db.prepare('SELECT payload FROM settings WHERE id=1').get().payload); }
  setMerchant(raw) {
    const merchant = merchantInput.parse(raw);
    this.db.prepare('INSERT OR REPLACE INTO settings (id,payload) VALUES (1,?)').run(JSON.stringify(merchant));
    return merchant;
  }
  customers(search = '') {
    const q = search.toLocaleLowerCase();
    return this.db.prepare('SELECT payload FROM customers ORDER BY name COLLATE NOCASE').all().map(r => JSON.parse(r.payload))
      .filter(c => [c.name, c.contact, c.phone, c.email].some(v => v.toLocaleLowerCase().includes(q)));
  }
  customer(id) {
    const row = this.db.prepare('SELECT payload FROM customers WHERE id=?').get(id);
    if (!row) throw new HttpError(404, '客户不存在');
    return JSON.parse(row.payload);
  }
  saveCustomer(raw, id) {
    const input = customerInput.parse(raw);
    const old = id ? this.customer(id) : null;
    const now = new Date().toISOString();
    const c = { ...input, id: old?.id ?? randomUUID(), createdAt: old?.createdAt ?? now, updatedAt: now };
    this.db.prepare('INSERT INTO customers (id,name,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload').run(c.id, c.name, JSON.stringify(c));
    return c;
  }
  quotes() {
    return this.db.prepare('SELECT payload FROM quotes ORDER BY rowid DESC').all().map(r => JSON.parse(r.payload));
  }
  quote(id) {
    const row = this.db.prepare('SELECT payload FROM quotes WHERE id=?').get(id);
    if (!row) throw new HttpError(404, '报价不存在');
    return JSON.parse(row.payload);
  }
  saveQuote(raw, id, expectedVersion) {
    const input = quoteInput.parse(raw);
    let computed;
    try { computed = calculateItems(input.items); } catch (e) { throw new HttpError(400, e.message); }
    return this.db.transaction(() => {
      const old = id ? this.quote(id) : null;
      if (old && old.version !== expectedVersion) throw new HttpError(409, '报价已发生变化，请重新打开后编辑');
      const customer = this.customer(input.customerId);
      const dayPrefix = `BJ-${today().replaceAll('-', '')}-`;
      const numbers = this.db.prepare('SELECT number FROM quotes WHERE number LIKE ?').all(`${dayPrefix}%`);
      const next = numbers.reduce((max, r) => Math.max(max, Number(r.number.slice(dayPrefix.length))), 0) + 1;
      const now = new Date().toISOString();
      const q = {
        ...input, ...computed, id: old?.id ?? randomUUID(), number: old?.number ?? `${dayPrefix}${String(next).padStart(3, '0')}`,
        customerSnapshot: old?.customerId === customer.id ? old.customerSnapshot : customer,
        merchantSnapshot: old?.merchantSnapshot ?? this.merchant(),
        status: old?.status ?? 'pending', followUps: old?.followUps ?? [],
        createdAt: old?.createdAt ?? now, updatedAt: now, version: (old?.version ?? 0) + 1,
      };
      this.db.prepare('INSERT INTO quotes (id,number,customer_id,payload) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,payload=excluded.payload')
        .run(q.id, q.number, q.customerId, JSON.stringify(q));
      return q;
    })();
  }
  followUp(id, raw) {
    const input = followUpInput.parse(raw);
    const q = this.quote(id);
    if (q.followUps.length >= 1000) throw new HttpError(400, '此报价的跟进记录已达上限');
    const now = new Date().toISOString();
    q.status = input.status;
    q.nextFollowUp = input.nextFollowUp;
    q.updatedAt = now;
    q.version++;
    q.followUps.unshift({ ...input, at: now });
    this.db.prepare('UPDATE quotes SET payload=? WHERE id=?').run(JSON.stringify(q), id);
    return q;
  }
  backup() {
    return { format: 'merchant-quotes', schemaVersion: 1, exportedAt: new Date().toISOString(), merchant: this.merchant(), customers: this.customers(), quotes: this.quotes().reverse() };
  }
  restore(raw) {
    const b = backupSchema.parse(raw); // all validation happens before touching the live data
    let safetyBackup = '';
    if (this.path !== ':memory:') {
      const folder = join(dirname(this.path), 'backups');
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      safetyBackup = `before-restore-${Date.now()}-${randomUUID().slice(0, 8)}.json`;
      writeFileSync(join(folder, safetyBackup), JSON.stringify(this.backup(), null, 2), { mode: 0o600, flag: 'wx' });
    }
    this.db.transaction(() => {
      this.db.exec('DELETE FROM quotes; DELETE FROM customers;');
      this.setMerchant(b.merchant);
      for (const c of b.customers) this.db.prepare('INSERT INTO customers VALUES (?,?,?)').run(c.id, c.name, JSON.stringify(c));
      for (const q of b.quotes) this.db.prepare('INSERT INTO quotes VALUES (?,?,?,?)').run(q.id, q.number, q.customerId, JSON.stringify(q));
    })();
    return { customers: b.customers.length, quotes: b.quotes.length, safetyBackup };
  }
  seed() {
    this.setMerchant({ name: '青禾设计工作室', contact: '林设计师', phone: '010-0000-0000', address: '演示市 青禾创意园 08 号（虚构）', terms: '报价有效期内可确认合作；预付 50%，交付验收后支付尾款。此报价含税。' });
    const names = [ ['山野咖啡', '陈店长', '门店品牌升级', '品牌视觉设计', '1', '6800', '套'], ['木间花房', '许女士', '春日门店焕新', '门店导视设计', '1', '3200', '套'], ['拾光面包', '周先生', '包装与物料设计', '包装视觉设计', '2', '1800', '款'], ['远山民宿', '赵经理', '民宿视觉方案', '品牌应用延展', '1', '8500', '套'], ['禾日杂货', '李店长', '开业物料制作', '开业海报设计', '6', '280', '张'] ];
    const day = today();
    names.forEach((row, i) => {
      const c = this.saveCustomer({ name: row[0], contact: row[1], phone: `010-0000-000${i + 1}`, email: '', address: `演示市 创意路 ${i + 1} 号（虚构）`, notes: '虚构示例客户，仅用于产品演示。' });
      const q = this.saveQuote({ customerId: c.id, title: row[2], quoteDate: day, validUntil: addDays(day, 14),
        items: [{ name: row[3], quantity: row[4], unitPrice: row[5], unit: row[6] }], notes: '服务范围与交付时间以双方确认内容为准。', nextFollowUp: addDays(day, i - 1) });
      if (i === 2 || i === 3) this.followUp(q.id, { status: i === 2 ? 'won' : 'lost', nextFollowUp: '', note: i === 2 ? '客户已确认方案，开始合作。' : '客户本期预算调整，暂不合作。' });
    });
  }
}
