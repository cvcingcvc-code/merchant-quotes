import { z } from 'zod';
import { calculateItems } from '../public/money.js';

const text = max => z.string().trim().max(max);
const required = max => text(max).min(1, '请填写必填内容');
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, '日期无效');
const optionalDate = z.union([date, z.literal('')]);
const timestamp = z.string().datetime();
export const customerInput = z.object({
  name: required(60), contact: text(40), phone: text(40),
  email: z.union([z.string().email().max(120), z.literal('')]),
  address: text(160), notes: text(400),
}).strict();
export const merchantInput = z.object({
  name: required(60), contact: text(40), phone: text(40), address: text(160), terms: text(300),
}).strict();
export const itemInput = z.object({
  name: required(80), unit: text(10), quantity: required(12), unitPrice: required(12),
}).strict();
export const quoteInput = z.object({
  customerId: z.string().uuid(), title: required(80), quoteDate: date, validUntil: date,
  items: z.array(itemInput).min(1).max(100), notes: text(600), nextFollowUp: optionalDate,
}).strict().refine(v => v.validUntil >= v.quoteDate, '有效期不能早于报价日期');
export const followUpInput = z.object({
  status: z.enum(['pending', 'won', 'lost']), nextFollowUp: optionalDate, note: text(300),
}).strict();
export const savedCustomer = customerInput.extend({ id: z.string().uuid(), createdAt: timestamp, updatedAt: timestamp });
const savedItem = itemInput.extend({ amountCents: z.number().int().nonnegative().max(99999999999) });
export const savedQuote = z.object({
  id: z.string().uuid(), number: z.string().regex(/^BJ-\d{8}-\d{3,6}$/),
  customerId: z.string().uuid(), customerSnapshot: savedCustomer, merchantSnapshot: merchantInput,
  title: required(80), quoteDate: date, validUntil: date, notes: text(600),
  items: z.array(savedItem).min(1).max(100), totalCents: z.number().int().nonnegative().max(99999999999),
  status: z.enum(['pending', 'won', 'lost']), nextFollowUp: optionalDate,
  followUps: z.array(z.object({ at: timestamp, status: z.enum(['pending', 'won', 'lost']), nextFollowUp: optionalDate, note: text(300) }).strict()).max(1000),
  createdAt: timestamp, updatedAt: timestamp, version: z.number().int().min(1),
}).strict().superRefine((q, ctx) => {
  try {
    const computed = calculateItems(q.items);
    if (computed.totalCents !== q.totalCents || computed.items.some((it, i) => it.amountCents !== q.items[i].amountCents)) throw new Error('备份金额不匹配');
    if (q.customerId !== q.customerSnapshot.id || q.validUntil < q.quoteDate) throw new Error('备份报价信息无效');
  } catch (e) { ctx.addIssue({ code: 'custom', message: e.message }); }
});
export const backupSchema = z.object({
  format: z.literal('merchant-quotes'), schemaVersion: z.literal(1), exportedAt: timestamp,
  merchant: merchantInput, customers: z.array(savedCustomer).max(10000), quotes: z.array(savedQuote).max(10000),
}).strict().superRefine((b, ctx) => {
  const customerIds = new Set(b.customers.map(c => c.id));
  if (customerIds.size !== b.customers.length || new Set(b.quotes.map(q => q.id)).size !== b.quotes.length ||
      new Set(b.quotes.map(q => q.number)).size !== b.quotes.length || b.quotes.some(q => !customerIds.has(q.customerId))) {
    ctx.addIssue({ code: 'custom', message: '备份包含重复编号或失效的客户关联' });
  }
});

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function addDays(value, days) {
  return new Date(Date.parse(`${value}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
