import { resolve } from 'node:path';
import { Store } from './store.js';
import { createApp } from './app.js';
import { BackupManager } from './backups.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const password = process.env.APP_PASSWORD || '';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && password.length < 12) {
  throw new Error('对外监听时，必须设置至少 12 位的 APP_PASSWORD（账号 merchant）。');
}
const directory = resolve(process.env.DATA_DIR || 'data');
const store = new Store(resolve(directory, 'quotes.sqlite'), { seed: process.env.SEED_DEMO !== 'false' });
const backups = new BackupManager(store, { directory: resolve(directory, 'backups') });
backups.safeDaily();
const backupTimer = setInterval(() => backups.safeDaily(), 60 * 60 * 1000);
backupTimer.unref();
const server = createApp(store, { password, backups }).listen(port, host, () => console.log(`简单报价已启动：http://${host}:${server.address().port}`));
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(backupTimer);
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
