import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, cpSync, symlinkSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diagnoseInstallation } from '../scripts/doctor.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const appKeys = ['HOST', 'PORT', 'DATA_DIR', 'APP_PASSWORD', 'SEED_DEMO'];
const get = (result, id) => result.checks.find(check => check.id === id);

function fixture({ files = true, dependencies = true, font = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'merchant-doctor-test-'));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(join(project, 'package.json'), join(root, 'package.json'));
  copyFileSync(join(project, 'package-lock.json'), join(root, 'package-lock.json'));
  copyFileSync(join(project, 'scripts/doctor.js'), join(root, 'scripts/doctor.js'));
  if (files) {
    cpSync(join(project, 'src'), join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'public'));
    for (const file of ['index.html', 'app.js', 'style.css', 'money.js']) copyFileSync(join(project, 'public', file), join(root, 'public', file));
  }
  if (dependencies) symlinkSync(join(project, 'node_modules'), join(root, 'node_modules'), 'junction');
  if (font) {
    mkdirSync(join(root, 'fonts'));
    copyFileSync(join(project, 'fonts/NotoSansCJKsc-Regular.otf'), join(root, 'fonts/NotoSansCJKsc-Regular.otf'));
  }
  return {
    root,
    check: (options = {}) => diagnoseInstallation({ projectRoot: root, environment: {}, checkPort: false, ...options }),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runCli(f, args, environment = {}, entry = join(f.root, 'scripts/doctor.js')) {
  const env = { ...process.env };
  for (const key of appKeys) delete env[key];
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: f.root, env: { ...env, ...environment }, encoding: 'utf8', timeout: 15000,
  });
  assert.ifError(result.error);
  return result;
}

test('安装预检在独立环境验证实际 SQLite 与中文 PDF，不创建数据或配置文件', async () => {
  const f = fixture();
  try {
    const before = readdirSync(f.root).sort();
    const result = await f.check();
    assert.equal(result.ok, true);
    for (const id of ['node', 'config', 'data-directory', 'database-permissions', 'backup-directory', 'runtime', 'sqlite', 'font', 'pdf']) assert.equal(get(result, id).status, 'pass', id);
    assert.equal(get(result, 'config-file').status, 'warn');
    assert.equal(get(result, 'access-mode').status, 'warn');
    assert.match(get(result, 'access-mode').message, /首次.*创建配置.*生成访问密码/);
    assert.equal(get(result, 'port').status, 'skip');
    assert.match(get(result, 'port').message, /尚未确认/);
    assert.deepEqual(readdirSync(f.root).sort(), before);
    assert.equal(existsSync(join(f.root, '.env')), false);
    assert.equal(existsSync(join(f.root, 'data')), false);
  } finally { f.close(); }
});

test('环境变量按 Node 规则覆盖已解析 .env，密码与其他自定义配置值不出现在报告', async () => {
  const f = fixture();
  const secret = 'DO_NOT_EXPOSE_PASSWORD_8c1e19';
  const invalid = 'DO_NOT_EXPOSE_INVALID_CONFIG_e862';
  try {
    const config = `HOST=0.0.0.0\nPORT=${invalid}\nAPP_PASSWORD="${secret}"\nSEED_DEMO=false\nDATA_DIR="./local records"\n`;
    writeFileSync(join(f.root, '.env'), config);
    const result = await f.check({ environment: { HOST: '127.0.0.1', PORT: '65535', APP_PASSWORD: '', SEED_DEMO: 'true' } });
    assert.equal(result.ok, true);
    assert.equal(get(result, 'config-file').status, 'pass');
    assert.equal(get(result, 'config').status, 'pass');
    assert.equal(get(result, 'access-mode').status, 'warn');
    assert.match(get(result, 'access-mode').message, /不会.*覆盖/);
    assert.doesNotMatch(get(result, 'access-mode').message, /首次.*生成/);
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!JSON.stringify(result).includes(invalid));
    assert.equal(readFileSync(join(f.root, '.env'), 'utf8'), config);
    assert.equal(existsSync(join(f.root, 'local records')), false);
  } finally { f.close(); }
});

test('安装预检不打开或改写已有客户数据库、备份和配置，即使数据库内容不是 SQLite', async () => {
  const f = fixture();
  try {
    const directory = join(f.root, 'records'); mkdirSync(join(directory, 'backups'), { recursive: true });
    const entries = {
      '.env': 'HOST=127.0.0.1\nDATA_DIR=./records\nAPP_PASSWORD=FICTIONAL_PRIVATE_SENTINEL_214b\n',
      'records/quotes.sqlite': 'invalid SQLite, fictional private sentinel; doctor must not open this',
      'records/backups/kept.json': 'not a valid backup; doctor must not read this',
    };
    for (const [path, content] of Object.entries(entries)) writeFileSync(join(f.root, path), content);
    const modified = Object.fromEntries(Object.keys(entries).map(path => [path, statSync(join(f.root, path)).mtimeMs]));
    const result = await f.check();
    assert.equal(result.ok, true);
    assert.equal(get(result, 'database-permissions').status, 'pass');
    assert.match(get(result, 'database-permissions').message, /未读取内容.*未验证其格式或记录/);
    assert.equal(get(result, 'sqlite').status, 'pass');
    for (const [path, content] of Object.entries(entries)) {
      assert.equal(readFileSync(join(f.root, path), 'utf8'), content);
      assert.equal(statSync(join(f.root, path)).mtimeMs, modified[path]);
    }
    assert.deepEqual(readdirSync(directory).sort(), ['backups', 'quotes.sqlite']);
    assert.deepEqual(readdirSync(join(directory, 'backups')), ['kept.json']);
  } finally { f.close(); }
});

test('不支持的 Node 版本提供修复提示，未尝试读取配置或加载原生模块', async () => {
  const f = fixture({ files: false, dependencies: false, font: false });
  try {
    mkdirSync(join(f.root, '.env')); // A read attempt would fail; version gate runs first.
    for (const nodeVersion of ['18.20.8', '22.19.0', '25.0.0']) {
      const result = await f.check({ nodeVersion });
      assert.equal(result.ok, false); assert.equal(get(result, 'node').status, 'fail');
      assert.match(get(result, 'node').fix, /Node.js 24.*npm ci/);
      assert.equal(get(result, 'sqlite').status, 'skip');
      assert.equal(get(result, 'config-file'), undefined);
    }
  } finally { f.close(); }
});

test('非法端口、外部短密码、主机与示例开关被拒绝且不回显输入值', async () => {
  const f = fixture({ files: false, dependencies: false, font: false });
  const secret = 'private-sentinel-in-invalid-value';
  try {
    const cases = [
      { PORT: '0' }, { PORT: '65536' }, { PORT: '1e3' }, { PORT: secret },
      { HOST: '0.0.0.0', APP_PASSWORD: 'short' }, { HOST: `127.0.0.1 ${secret}` },
      { SEED_DEMO: secret },
    ];
    for (const environment of cases) {
      const result = await f.check({ environment });
      assert.equal(result.ok, false); assert.equal(get(result, 'config').status, 'fail');
      assert.equal(get(result, 'runtime').status, 'skip');
      assert.ok(!JSON.stringify(result).includes(secret));
      assert.ok(!JSON.stringify(result).includes('short'));
      assert.equal(existsSync(join(f.root, 'data')), false);
    }
  } finally { f.close(); }
});

test('不完整运行依赖与缺失字体分别给出明确结果，不虚报 PDF 自检通过', async () => {
  const missing = fixture({ dependencies: false });
  const font = fixture({ font: false });
  try {
    const brokenExpress = join(missing.root, 'node_modules/express');
    mkdirSync(brokenExpress, { recursive: true });
    writeFileSync(join(brokenExpress, 'package.json'), JSON.stringify({ name: 'express', exports: './missing.js' }));
    const a = await missing.check();
    assert.equal(a.ok, false); assert.equal(get(a, 'runtime').status, 'fail');
    assert.match(get(a, 'runtime').fix, /npm ci/);
    assert.equal(get(a, 'sqlite').status, 'skip'); assert.equal(get(a, 'pdf').status, 'skip');
    const b = await font.check();
    assert.equal(b.ok, false); assert.equal(get(b, 'sqlite').status, 'pass');
    assert.equal(get(b, 'font').status, 'fail'); assert.equal(get(b, 'pdf').status, 'skip');
    assert.match(get(b, 'font').fix, /fonts.*OFL/);
  } finally { missing.close(); font.close(); }
});

test('备份路径拒绝符号链接，不读取链接目标或修改原有备份', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, 'data'));
    const target = join(f.root, 'separate-backups'); mkdirSync(target);
    const sentinel = 'fictional backup sentinel'; writeFileSync(join(target, 'kept.json'), sentinel);
    symlinkSync(target, join(f.root, 'data/backups'), 'junction');
    const result = await f.check();
    assert.equal(result.ok, false); assert.equal(get(result, 'backup-directory').status, 'fail');
    assert.equal(readFileSync(join(target, 'kept.json'), 'utf8'), sentinel);
    assert.deepEqual(readdirSync(target), ['kept.json']);
  } finally { f.close(); }
});

test('缺失真正启动入口、备份模块或安装锁文件时不能通过预检', async () => {
  for (const path of ['src/server.js', 'src/backups.js', 'package-lock.json']) {
    const f = fixture();
    try {
      rmSync(join(f.root, path));
      const result = await f.check();
      assert.equal(result.ok, false, path);
      assert.equal(get(result, 'runtime').status, 'fail', path);
      assert.equal(get(result, 'pdf').status, 'skip', path);
      assert.equal(existsSync(join(f.root, 'data')), false);
    } finally { f.close(); }
  }
});

test('必要网页资源被目录占位时拒绝通过，而不是仅按可读路径判断', async () => {
  for (const path of ['public/index.html', 'public/app.js', 'public/style.css']) {
    const f = fixture();
    try {
      rmSync(join(f.root, path)); mkdirSync(join(f.root, path));
      const result = await f.check();
      assert.equal(result.ok, false, path);
      assert.equal(get(result, 'runtime').status, 'fail', path);
      assert.equal(get(result, 'pdf').status, 'skip', path);
    } finally { f.close(); }
  }
});

test('数据目录或其祖先是悬空符号链接时不能误报为可创建目录', async () => {
  const f = fixture();
  try {
    const link = join(f.root, 'dangling');
    symlinkSync(join(f.root, 'missing-target'), link, 'junction');
    for (const DATA_DIR of ['./dangling', './dangling/nested']) {
      const result = await f.check({ environment: { DATA_DIR } });
      assert.equal(result.ok, false, DATA_DIR);
      assert.equal(get(result, 'data-directory').status, 'fail', DATA_DIR);
      assert.equal(get(result, 'database-permissions').status, 'skip', DATA_DIR);
      assert.equal(existsSync(join(f.root, 'missing-target')), false);
    }
  } finally { f.close(); }
});

test('同进程已生成过 PDF 后再损坏字体，不能被模块缓存掩盖', async () => {
  const f = fixture();
  try {
    const first = await f.check();
    assert.equal(first.ok, true); assert.equal(get(first, 'pdf').status, 'pass');
    writeFileSync(join(f.root, 'fonts/NotoSansCJKsc-Regular.otf'), 'OTTO');
    const second = await f.check();
    assert.equal(second.ok, false); assert.equal(get(second, 'font').status, 'fail');
    assert.equal(get(second, 'pdf').status, 'skip');
    assert.match(get(second, 'font').fix, /本版本不支持直接替换字体/);
  } finally { f.close(); }
});

test('CLI --help 不执行预检；未知参数给中文错误且不回显参数', () => {
  const f = fixture({ files: false, dependencies: false, font: false });
  try {
    mkdirSync(join(f.root, '.env'));
    const help = runCli(f, ['--help']);
    assert.equal(help.status, 0); assert.match(help.stdout, /用法：npm run doctor/);
    assert.doesNotMatch(help.stdout, /预检发现阻断/);
    const secret = 'argument-secret-47ba';
    const bad = runCli(f, ['--json', secret]);
    assert.equal(bad.status, 1);
    const result = JSON.parse(bad.stdout);
    assert.equal(result.ok, false); assert.equal(result.checks[0].id, 'arguments');
    assert.match(result.checks[0].message, /无法识别/);
    assert.ok(!(bad.stdout + bad.stderr).includes(secret));
  } finally { f.close(); }
});

test('CLI --skip-port 明确标为跳过，JSON 与退出码不冒充完整手机验收', () => {
  const f = fixture();
  try {
    const result = runCli(f, ['--json', '--skip-port']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true); assert.equal(get(report, 'port').status, 'skip');
    assert.match(get(report, 'port').message, /尚未确认/);
    const text = runCli(f, ['--skip-port']);
    assert.equal(text.status, 0); assert.match(text.stdout, /部分项目已跳过/);
    assert.doesNotMatch(text.stdout, /全部检查通过/);
    assert.equal(existsSync(join(f.root, '.env')), false); assert.equal(existsSync(join(f.root, 'data')), false);
  } finally { f.close(); }
});

test('CLI 通过符号链接入口执行仍输出 JSON，而不是静默退出', () => {
  const f = fixture();
  try {
    const link = join(f.root, 'doctor-link.js');
    symlinkSync(join(f.root, 'scripts/doctor.js'), link, 'file');
    const result = runCli(f, ['--json', '--skip-port'], {}, link);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(get(report, 'pdf').status, 'pass');
    assert.equal(get(report, 'port').status, 'skip');
    assert.equal(existsSync(join(f.root, 'data')), false);
  } finally { f.close(); }
});

test('网络: 空闲端口可探测，探针退出后端口可重新使用', async () => {
  const f = fixture();
  let first, second;
  try {
    first = createServer().listen(0, '127.0.0.1'); await once(first, 'listening');
    const port = first.address().port; await new Promise(done => first.close(done));
    const result = await f.check({ environment: { HOST: '127.0.0.1', PORT: String(port) }, checkPort: true });
    assert.equal(result.ok, true); assert.equal(get(result, 'port').status, 'pass');
    second = createServer().listen(port, '127.0.0.1'); await once(second, 'listening');
    assert.equal(second.listening, true);
  } finally {
    if (first?.listening) await new Promise(done => first.close(done));
    if (second?.listening) await new Promise(done => second.close(done));
    f.close();
  }
});

test('网络: 占用端口正确失败且不关闭已有服务', async () => {
  const f = fixture();
  const server = createServer();
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const result = await f.check({ environment: { HOST: '127.0.0.1', PORT: String(server.address().port) }, checkPort: true });
    assert.equal(result.ok, false); assert.equal(get(result, 'port').status, 'fail');
    assert.match(get(result, 'port').message, /已被占用/);
    assert.match(get(result, 'port').fix, /不会停止/);
    assert.equal(server.listening, true);
  } finally {
    if (server.listening) await new Promise(done => server.close(done));
    f.close();
  }
});
