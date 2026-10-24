import * as fs from 'node:fs';
import * as util from 'node:util';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const installFix = '请安装 Node.js 24，在完整项目目录执行 npm ci，然后重新运行 npm run doctor。';
const sourceFiles = ['package.json', 'package-lock.json', 'src/server.js', 'src/backups.js', 'src/store.js', 'src/app.js', 'src/pdf.js', 'src/validation.js',
  'public/index.html', 'public/app.js', 'public/style.css', 'public/money.js'];
const dependencies = ['express', 'better-sqlite3', 'zod', '@pdfme/common', '@pdfme/generator', '@pdfme/schemas'];
// This release ships the original, unmodified Noto font. Update this checksum
// deliberately when releasing a new font; checking current bytes also prevents
// an earlier PDF module import from hiding a subsequently damaged font file.
const bundledFontSha256 = 'd2cca006b58cf2a6305f89f997cec7789f1fd142c0d45944f167b87546700435';
const dependentChecks = ['config', 'data-directory', 'database-permissions', 'backup-directory', 'runtime', 'sqlite', 'font', 'pdf', 'port'];
const help = `简单报价 · 商家安装预检

用法：npm run doctor -- [--json] [--skip-port]
  --json       以 JSON 输出结果，不输出密码或配置值
  --skip-port  明确跳过端口探测，不能据此确认端口可用
  --help, -h   显示帮助，不执行预检

预检只检查当前用户的目录权限，并在内存中验证 SQLite、服务依赖及中文 PDF。
它不会打开客户数据库，不创建 data/，不改写 .env，也不启动报价应用。
端口探测最多约 3 秒，临时监听后立即关闭；不会停止任何占用端口的服务。
预检不能代替真实手机、局域网、防火墙或 HTTPS 验收。`;

// Run the short bind probe in its own process so even a stalled hostname lookup
// can be stopped at the deadline, without touching a running merchant service.
const portProbeSource = `
const net = require('node:net');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', value => input += value);
process.stdin.on('end', () => {
  let options;
  try { options = JSON.parse(input); } catch { process.exit(1); }
  const server = net.createServer(socket => socket.destroy());
  const done = result => process.stdout.write(JSON.stringify(result), () => process.exit(0));
  server.once('error', error => done({ code: error.code || 'PROBE_FAILED' }));
  try {
    server.listen({ host: options.host, port: options.port, exclusive: true }, () =>
      server.close(error => done(error ? { code: error.code || 'PROBE_FAILED' } : { available: true })));
  } catch { done({ code: 'PROBE_FAILED' }); }
});`;

function probePort(host, port) {
  return new Promise(resolveProbe => {
    let child, output = '', done = false, timedOut = false;
    const finish = result => {
      if (done) return;
      done = true; clearTimeout(timer); resolveProbe(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (child?.pid) child.kill('SIGKILL');
      else finish({ code: 'TIMEOUT' });
    }, 3000);
    try {
      child = spawn(process.execPath, ['-e', portProbeSource], { stdio: ['pipe', 'pipe', 'ignore'] });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', value => { if (output.length < 1024) output += value; });
      child.stdin.on('error', () => {});
      child.once('error', error => finish({ code: error.code || 'PROBE_FAILED' }));
      child.once('close', () => {
        if (timedOut) return finish({ code: 'TIMEOUT' });
        try { finish(JSON.parse(output)); } catch { finish({ code: 'PROBE_FAILED' }); }
      });
      child.stdin.end(JSON.stringify({ host, port }));
    } catch { finish({ code: 'PROBE_FAILED' }); }
  });
}

function existingParent(path) {
  let current = path;
  for (;;) {
    try { return { path: current, stat: fs.statSync(current) }; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // stat follows links. A dangling link (including an ancestor encountered
      // while walking upwards) is not a directory that the app can create.
      try { fs.lstatSync(current); throw new Error('existing-path-unusable'); }
      catch (entryError) { if (entryError.code !== 'ENOENT') throw entryError; }
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

export async function diagnoseInstallation({ projectRoot = defaultRoot, environment = process.env,
  nodeVersion = process.versions.node, checkPort = true } = {}) {
  const checks = [];
  const add = (id, status, message, fix) => checks.push({ id, status, message, ...(fix ? { fix } : {}) });
  const finish = () => ({ ok: !checks.some(check => check.status === 'fail'), checks });
  const skipRemaining = message => {
    for (const id of dependentChecks) if (!checks.some(check => check.id === id)) add(id, 'skip', message);
    return finish();
  };
  if (!/^24\./.test(String(nodeVersion))) {
    add('node', 'fail', '当前 Node.js 主版本不符合要求；本项目需要 Node.js 24。', installFix);
    return skipRemaining('需要先安装支持的 Node.js 版本。');
  }
  add('node', 'pass', 'Node.js 主版本符合要求。');

  let root, merged, hasEnvFile = false;
  try {
    root = resolve(projectRoot);
    const file = join(root, '.env');
    let configured = {};
    try {
      const content = fs.readFileSync(file, 'utf8'); hasEnvFile = true;
      configured = util.parseEnv(content);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    merged = { ...configured };
    for (const [key, value] of Object.entries(environment)) if (value !== undefined) merged[key] = String(value);
    add('config-file', hasEnvFile ? 'pass' : 'warn', hasEnvFile
      ? '已读取配置文件；已有环境变量优先，未修改配置。'
      : '没有配置文件，将按默认值及已有环境变量预检；未创建配置文件。');
  } catch {
    add('config-file', 'fail', '项目路径或配置文件无法读取、解析。', '请确认完整源码目录与 .env 的读权限和格式，不要将密码粘贴到错误报告中。');
    return skipRemaining('需要先修复配置文件读取问题。');
  }
  const host = merged.HOST || '127.0.0.1', portText = merged.PORT || '3000';
  const password = merged.APP_PASSWORD || '';
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const problems = [];
  if (!host.trim() || host.trim() !== host || /[\u0000-\u0020\u007f]/.test(host)) problems.push('HOST 应为本机有效地址或主机名');
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) problems.push('PORT 应为 1～65535 的整数');
  if (!local && password.length < 12) problems.push('外部监听必须设置至少 12 位的 APP_PASSWORD');
  if (merged.SEED_DEMO !== undefined && !['true', 'false'].includes(merged.SEED_DEMO)) problems.push('SEED_DEMO 应为 true 或 false，也可以不设置');
  if (problems.length) {
    add('config', 'fail', '启动配置存在错误。', problems.join('；') + '。修改配置后重新预检。');
    return skipRemaining('需要先修复启动配置。');
  }
  add('config', 'pass', '主机、端口、示例数据开关及外部访问密码要求符合预检规则。');
  if (local && password.length < 12) {
    const message = hasEnvFile
      ? '当前可用于本机演示；已有配置文件不会被局域网启动器覆盖。'
      : password
        ? '当前可用于本机演示；已有环境变量中的访问密码不足局域网演示要求。'
        : '当前可用于本机演示；首次运行 npm run demo:lan 会创建配置并生成访问密码。';
    add('access-mode', 'warn', message, hasEnvFile || password
      ? '手机访问前请自行设置至少 12 位的 APP_PASSWORD，再运行 npm run demo:lan。'
      : '手机演示时运行 npm run demo:lan，并在生成的 .env 中自行查看密码。');
  } else add('access-mode', 'pass', '访问密码已配置；预检不会显示密码。');

  let directory, directoryReady = false;
  try {
    directory = resolve(root, merged.DATA_DIR || 'data');
    const parent = existingParent(directory);
    if (!parent.stat.isDirectory()) throw new Error();
    fs.accessSync(parent.path, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    directoryReady = true;
    add('data-directory', 'pass', parent.path === directory
      ? '数据目录具备当前用户的读写和遍历权限；未打开数据库。'
      : '数据目录尚未创建，最近现有父目录具备创建权限；本次未创建目录。');
  } catch {
    add('data-directory', 'fail', '数据目录路径无效或当前用户没有所需目录权限。', '请将 DATA_DIR 指向当前用户可读写的本地目录，并检查父目录权限。');
  }
  if (directoryReady) {
    try {
      const file = join(directory, 'quotes.sqlite');
      let stat;
      try { stat = fs.lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error();
      if (stat) fs.accessSync(file, fs.constants.R_OK | fs.constants.W_OK);
      add('database-permissions', 'pass', stat
        ? '现有数据库文件读写权限可用；未读取内容，也未验证其格式或记录。'
        : '没有现有数据库文件；本次未创建或打开客户数据库。');
    } catch {
      add('database-permissions', 'fail', '数据库路径不是普通可读写文件，或无法检查其权限。', '请由安装人员确认 quotes.sqlite 的文件类型、当前用户读写权限及完整备份；不要删除现有文件。');
    }
    try {
      const folder = join(directory, 'backups');
      let stat;
      try { stat = fs.lstatSync(folder); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new Error();
      if (stat) fs.accessSync(folder, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
      add('backup-directory', 'pass', stat
        ? '备份目录是当前用户可读写的普通目录；未读取备份内容。'
        : '备份目录尚未创建，将由应用启动时创建；本次未创建。');
    } catch {
      add('backup-directory', 'fail', '备份目录不是可读写的普通目录，或是符号链接。', '请由安装人员保留原备份后，修正 backups 的文件类型和读写权限；不要覆盖或删除原备份。');
    }
  } else {
    add('database-permissions', 'skip', '需要先修复数据目录，未检查客户数据库文件权限。');
    add('backup-directory', 'skip', '需要先修复数据目录，未检查备份目录权限。');
  }

  let runtimeReady = false, fontReady = false, store;
  try {
    for (const file of sourceFiles) {
      const path = join(root, file);
      if (!fs.statSync(path).isFile()) throw new Error();
      fs.accessSync(path, fs.constants.R_OK);
    }
    const require = createRequire(join(root, 'package.json'));
    for (const name of dependencies) require.resolve(name);
    runtimeReady = true;
    add('runtime', 'pass', '必要项目文件可读，服务依赖可解析；后续实际加载 SQLite 与 PDF。');
  } catch {
    add('runtime', 'fail', '源码文件或服务依赖不完整、不可读取。', installFix);
  }
  if (runtimeReady) {
    try {
      const { Store } = await import(pathToFileURL(join(root, 'src/store.js')).href);
      store = new Store(':memory:');
      if (store.db.prepare('SELECT 1 AS value').get().value !== 1 || !store.quotes()[0]) throw new Error();
      add('sqlite', 'pass', 'SQLite 本地模块已完成内存自检，仅使用虚构记录；未打开客户数据库。');
    } catch {
      add('sqlite', 'fail', 'SQLite 本地模块或内存自检不可用。', '请使用 Node.js 24，在项目目录重新执行 npm ci；若仍失败，请由安装人员检查本机平台和原生模块构建环境。');
    }
  } else add('sqlite', 'skip', '需要先补齐项目文件与依赖，未执行 SQLite 自检。');
  let fd;
  try {
    const file = join(root, 'fonts/NotoSansCJKsc-Regular.otf');
    if (!fs.statSync(file).isFile()) throw new Error();
    fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(4);
    if (fs.readSync(fd, header, 0, 4, 0) !== 4 || header.toString('ascii') !== 'OTTO') throw new Error();
    const data = fs.readFileSync(fd);
    if (createHash('sha256').update(data).digest('hex') !== bundledFontSha256) throw new Error();
    fontReady = true; add('font', 'pass', '内置中文字体可读取，且与本发行版的原版字体校验一致。');
  } catch {
    add('font', 'fail', '内置中文字体缺失、不可读取、损坏或与本发行版不符。', '请重新完整解压本版本，保留 fonts 中的原版字体与 OFL.txt；本版本不支持直接替换字体。');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  try {
    if (!runtimeReady || !store || !fontReady) add('pdf', 'skip', '需要先修复运行依赖、SQLite 或字体，未执行 PDF 自检。');
    else {
      try {
        const [{ createApp }, { generateQuotePdf }] = await Promise.all([
          import(pathToFileURL(join(root, 'src/app.js')).href), import(pathToFileURL(join(root, 'src/pdf.js')).href),
        ]);
        createApp(store); // Construct routes without listening or serving data.
        const bytes = Buffer.from(await generateQuotePdf(store.quotes()[0]));
        if (bytes.subarray(0, 4).toString() !== '%PDF' || bytes.length < 1000) throw new Error();
        add('pdf', 'pass', '已使用内置字体在内存中生成虚构中文报价 PDF，并初始化服务路由；未保存文件或启动应用。');
      } catch {
        add('pdf', 'fail', '中文 PDF 生成或服务路由初始化失败。', '请重新完整解压项目，执行 npm ci 后重试，并保留原字体文件；仍需人工打开 PDF 验收。');
      }
    }
  } finally { store?.close(); }

  if (!checkPort) add('port', 'skip', '已按参数跳过端口探测；尚未确认端口是否可用。');
  else {
    const result = await probePort(host, Number(portText));
    if (result.available) add('port', 'pass', '配置的监听地址和端口可短暂绑定，探测进程已退出；不代表手机、防火墙或公网可达。');
    else if (result.code === 'EADDRINUSE') add('port', 'fail', '配置的监听端口已被占用。', '若本工具已经启动，可直接打开现有页面；否则修改 PORT 或停止已明确识别的占用服务，本预检不会停止任何服务。');
    else if (['EPERM', 'EACCES'].includes(result.code)) add('port', 'fail', '当前环境或用户权限不允许执行本地监听探测，不能据此判定端口被占用。', '请在实际运行电脑执行预检或检查系统权限；--skip-port 只会跳过检查，不证明端口可用。');
    else if (result.code === 'TIMEOUT') add('port', 'fail', '监听探测超时，临时探测进程已终止。', '请检查 HOST 是否属于当前电脑及本机名称解析，修正后再试。');
    else add('port', 'fail', '配置的监听地址和端口无法绑定；未启动报价应用。', '请检查 HOST 是否属于当前电脑，以及端口和系统网络配置后重试。');
  }
  return finish();
}

async function main() {
  const args = process.argv.slice(2), json = args.includes('--json');
  let result;
  if (args.some(arg => !['--json', '--skip-port', '--help', '-h'].includes(arg))) {
    result = { ok: false, checks: [{ id: 'arguments', status: 'fail', message: '无法识别的参数。', fix: '请运行 npm run doctor -- --help 查看用法。' }] };
  } else if (args.includes('--help') || args.includes('-h')) { console.log(help); return; }
  else {
    try { result = await diagnoseInstallation({ checkPort: !args.includes('--skip-port') }); }
    catch { result = { ok: false, checks: [{ id: 'internal', status: 'fail', message: '安装预检未能完成。', fix: '请确认项目目录可读及 Node.js 24 可用，再由安装人员重试；不要发送密码或客户数据。' }] }; }
  }
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('简单报价 · 商家安装预检\n');
    const labels = { pass: '通过', warn: '提示', fail: '未通过', skip: '跳过' };
    for (const check of result.checks) console.log(`[${labels[check.status]}] ${check.message}${check.fix ? `\n  处理：${check.fix}` : ''}`);
    console.log(!result.ok ? '\n预检发现阻断问题，请按提示修复后重试。'
      : result.checks.some(check => check.status === 'skip') ? '\n已完成可执行检查，部分项目已跳过，不能视为完整验收。'
        : '\n预检完成，未发现已检查项目的启动阻断。');
    console.log('本预检不验证客户记录内容，不能代替真实手机、局域网、防火墙或 HTTPS 验收。');
  }
  process.exitCode = result.ok ? 0 : 1;
}

let isCommand = false;
if (process.argv[1]) {
  try { isCommand = fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { /* Importing the helper must never execute the CLI on a bad argv. */ }
}
if (isCommand) await main();
