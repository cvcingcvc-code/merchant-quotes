import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { generateQuotePdf } from './pdf.js';
import { today } from './validation.js';
import { HttpError } from './store.js';

const digest = value => createHash('sha256').update(value).digest();
export function createApp(store, { password = '', backups = null } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'Cache-Control': 'no-store',
    });
    if (!password) return next();
    const auth = req.headers.authorization ?? '';
    const decoded = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString('utf8') : '';
    const valid = timingSafeEqual(digest(decoded), digest(`merchant:${password}`));
    if (!valid) return res.status(401).set('WWW-Authenticate', 'Basic realm="Merchant Quotes", charset="UTF-8"').send('请使用商家账号登录');
    next();
  });
  // All browser mutations need this custom header and same origin (also blocks Basic-auth CSRF).
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (req.get('X-Requested-With') !== 'merchant-quotes') return next(new HttpError(403, '请求来源无效'));
      if (req.get('sec-fetch-site') === 'cross-site') return next(new HttpError(403, '不允许跨站写入'));
      if (req.get('origin')) {
        try { if (new URL(req.get('origin')).host !== req.get('host')) throw new Error(); }
        catch { return next(new HttpError(403, '请求来源无效')); }
      }
    }
    next();
  });
  app.use(express.json({ limit: '8mb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/bootstrap', (req, res) => {
    backups?.safeDaily();
    res.json({ merchant: store.merchant(), customers: store.customers(), quotes: store.quotes(), workspace: store.workspace(),
      today: today(), passwordProtected: Boolean(password), backups: backups ? { enabled: true, ...backups.status() } : { enabled: false } });
  });
  app.post('/api/setup', (req, res) => res.json(store.completeSetup(req.body)));
  app.get('/api/customers', (req, res) => res.json(store.customers(String(req.query.q ?? '').slice(0, 120))));
  app.post('/api/customers', (req, res) => res.status(201).json(store.saveCustomer(req.body)));
  app.put('/api/customers/:id', (req, res) => res.json(store.saveCustomer(req.body, req.params.id)));
  app.post('/api/quotes', (req, res) => res.status(201).json(store.saveQuote(req.body)));
  app.get('/api/quotes/:id', (req, res) => res.json(store.quote(req.params.id)));
  app.put('/api/quotes/:id', (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new HttpError(400, '报价内容格式无效');
    const { version, ...input } = req.body;
    res.json(store.saveQuote(input, req.params.id, version));
  });
  app.patch('/api/quotes/:id/follow-up', (req, res) => res.json(store.followUp(req.params.id, req.body)));
  app.get('/api/quotes/:id/pdf', async (req, res) => {
    const q = store.quote(req.params.id);
    const bytes = await generateQuotePdf(q);
    res.type('pdf').set('Content-Disposition', `attachment; filename="${q.number}.pdf"; filename*=UTF-8''${encodeURIComponent(`${q.number}-${q.customerSnapshot.name}.pdf`)}`).send(Buffer.from(bytes));
  });
  app.put('/api/merchant', (req, res) => res.json(store.setMerchant(req.body)));
  app.get('/api/backup', (req, res) => res.type('json').set('Content-Disposition', `attachment; filename="merchant-quotes-${today()}.json"`).send(JSON.stringify(store.backup(), null, 2)));
  app.post('/api/restore', (req, res) => res.json(store.restore(req.body)));
  app.get('/api/backups', (req, res) => res.json(backups ? backups.list() : []));
  app.get('/api/backups/:name', (req, res) => {
    if (!backups) throw new HttpError(404, '暂无服务端备份');
    const bytes = backups.read(req.params.name);
    res.type('json').set('Content-Disposition', `attachment; filename="${req.params.name}"`).send(bytes);
  });
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url)), { etag: false, maxAge: 0 }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ZodError) return res.status(400).json({ error: `内容校验失败：${err.issues[0]?.message ?? '请检查输入'}` });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: '文件过大，请使用不超过 8 MB 的备份' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 文件格式无效' });
    if (!err.status || err.status >= 500) console.error('Request failed:', err.message);
    res.status(err.status ?? 500).json({ error: err.status ? err.message : '操作失败，请稍后重试' });
  });
  return app;
}
