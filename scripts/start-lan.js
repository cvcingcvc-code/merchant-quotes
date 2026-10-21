import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const configFile = join(root, '.env');
try {
  if (!existsSync(configFile) && !process.env.APP_PASSWORD) {
    const password = randomBytes(18).toString('base64url');
    writeFileSync(configFile, [
      '# 本机演示配置。请勿提交或分享这个文件。',
      '# 手机登录用户名：merchant；密码见 APP_PASSWORD。',
      'HOST=127.0.0.1', 'PORT=3000', 'DATA_DIR=./data',
      `APP_PASSWORD=${password}`, 'SEED_DEMO=true', '',
    ].join('\n'), { flag: 'wx', mode: 0o600 });
    console.log('已创建 .env 并生成访问密码。请用文本编辑器打开 .env 查看 APP_PASSWORD。');
  }
  if (existsSync(configFile)) process.loadEnvFile(configFile);
  if (!process.env.APP_PASSWORD || process.env.APP_PASSWORD.length < 12) {
    throw new Error('请在 .env 中设置至少 12 位的 APP_PASSWORD，再运行 npm run demo:lan。');
  }
  const port = process.env.PORT || '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('局域网演示的 PORT 必须为 1～65535。');
  console.log('\n电脑打开：http://127.0.0.1:' + port);
  console.log('手机连接电脑所在的同一 Wi-Fi，服务启动后尝试以下地址：');
  let found = false;
  try {
    for (const [name, entries] of Object.entries(networkInterfaces())) {
      for (const entry of entries || []) {
        if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue;
        console.log(`  http://${entry.address}:${port}  (${name})`);
        found = true;
      }
    }
  } catch { /* Restricted runtimes may not expose interfaces. */ }
  if (!found) console.log('  无法自动检测局域网地址，请查看电脑网络设置中的 IPv4 地址。');
  console.log('登录用户名：merchant；密码使用 .env 的 APP_PASSWORD，或你已配置的 APP_PASSWORD 环境变量。');
  console.log('请保持此窗口打开。演示结束按 Ctrl+C 停止；不要把这些局域网地址当作公网链接。\n');
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: root, env: { ...process.env, HOST: '0.0.0.0' }, stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill('SIGTERM'));
  server.on('error', error => { console.error('启动失败：' + error.message); process.exitCode = 1; });
  server.on('exit', code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
