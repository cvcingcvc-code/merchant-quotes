import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';
import { Store } from '../src/store.js';
import { addDays } from '../src/validation.js';

// A real, isolated browser walkthrough. No production data directory is opened.
// Requires local Chromium, FFmpeg (libvpx-vp9/libx264/libass), and Poppler.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.env.DEMO_VIDEO_OUTPUT || join(root, '..', 'merchant-quotes-demo.mp4'));
const work = mkdtempSync(join(tmpdir(), 'merchant-demo-video-'));
const dataDir = join(work, 'data');
const evidence = join(root, 'docs/evidence');
const pdfPath = join(evidence, 'demo-video-quote.pdf');
const subtitlePath = join(evidence, 'demo-video.zh-CN.srt');
const reportPath = join(evidence, 'demo-video-verification.json');
const font = join(root, 'fonts/NotoSansCJKsc-Regular.otf');
const merchantName = '青禾图文工作室（演示）';
const customerName = '山野咖啡（演示）';
const quoteTitle = '门店展示物料报价';
const note = '虚构店长已确认，安排后续交付。';
const errors = [], events = [];
let service, mediaServer, mediaBase, mediaDocument = '', browser, context, page, base, port = '0', videoStart, quoteId, firstPid, secondPid;
const report = { format: 'merchant-quotes-demo-video', appVersion: '1.1.0', recordedAt: new Date().toISOString(),
  fictionalDataOnly: true, browserMobileViewport: { width: 432, height: 720, deviceScaleFactor: 2 },
  physicalPhoneRecording: false, soundtrack: 'silent; Chinese captions burned into video', checks: {}, cleanup: {} };

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, XDG_CACHE_HOME: join(work, 'cache') }, ...options });
}
async function start() {
  service = spawn(process.execPath, ['src/server.js'], { cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: port, DATA_DIR: dataDir, SEED_DEMO: 'true', APP_PASSWORD: '' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ready, reject) => {
    let output = '', started = false;
    const timer = setTimeout(() => reject(new Error(`录制服务启动超时：${output}`)), 15000);
    service.stdout.on('data', bytes => {
      output += bytes;
      const address = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (!address || started) return;
      started = true; clearTimeout(timer); port = address[1]; base = `http://127.0.0.1:${port}`; ready();
    });
    service.stderr.on('data', bytes => output += bytes);
    service.once('error', error => { clearTimeout(timer); reject(error); });
    service.once('exit', code => { if (!started) { clearTimeout(timer); reject(new Error(`录制服务退出 ${code}: ${output}`)); } });
  });
}
async function stop() {
  if (service?.exitCode === null && service.pid) { service.kill('SIGTERM'); await once(service, 'exit'); }
}
async function json(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200); return response.json();
}
async function scene(name, caption, seconds, action = async () => {}) {
  const start = Date.now();
  events.push({ name, caption, start: (start - videoStart) / 1000 });
  console.log(`SCENE: ${name}`);
  await action();
  await pause(Math.max(0, seconds * 1000 - (Date.now() - start)));
}
async function type(locator, value, delay = 55) {
  await locator.scrollIntoViewIfNeeded(); await locator.click(); await locator.fill('');
  await locator.pressSequentially(value, { delay }); await pause(200);
}
function card(title, body, small = '') {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#f8faf4;color:#234d3d;font-family:"Noto Sans CJK SC",sans-serif;min-height:720px;display:flex;align-items:center;padding:42px}main{width:100%}.mark{width:46px;height:6px;background:#328263;margin-bottom:35px}h1{font-size:38px;line-height:1.5;font-weight:600;letter-spacing:1px;margin:0 0 24px}p{font-size:21px;line-height:1.9;margin:0;white-space:pre-line}small{display:block;font-size:13px;color:#809075;line-height:1.9;margin-top:38px}</style><main><div class="mark"></div><h1>${title}</h1><p>${body}</p><small>${small}</small></main></html>`;
}
async function showCard(title, body, small) { mediaDocument = card(title, body, small); await page.goto(mediaBase); }
async function openQuote() {
  await page.goto(base + '/#quotes');
  await page.getByRole('textbox', { name: '搜索报价' }).fill(quoteTitle);
  await page.getByRole('button', { name: `查看 ${quoteTitle}`, exact: true }).click();
  await page.locator('.detail-title').waitFor();
}
function timestamp(seconds, ass = false) {
  const units = ass ? 100 : 1000;
  const n = Math.round(seconds * units), h = Math.floor(n / (3600 * units));
  const m = Math.floor(n / (60 * units)) % 60, s = Math.floor(n / units) % 60;
  return `${ass ? h : String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${ass ? '.' : ','}${String(n % units).padStart(ass ? 2 : 3, '0')}`;
}
const filterPath = value => value.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");

try {
  mkdirSync(evidence, { recursive: true }); mkdirSync(dirname(output), { recursive: true });
  const ffmpeg = run('which', ['ffmpeg']).trim();
  run('ffprobe', ['-version']); run('pdftoppm', ['-v'], { stdio: ['ignore', 'pipe', 'pipe'] });
  // Use the installed FFmpeg in an isolated Playwright registry; no downloads,
  // changes to node_modules, or writes to the user's browser cache are needed.
  const browsers = JSON.parse(readFileSync(join(root, 'node_modules/playwright-core/browsers.json'), 'utf8'));
  const revision = browsers.browsers.find(item => item.name === 'ffmpeg').revision;
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(work, 'browsers');
  const encoderDir = join(process.env.PLAYWRIGHT_BROWSERS_PATH, `ffmpeg-${revision}`);
  mkdirSync(encoderDir, { recursive: true }); symlinkSync(ffmpeg, join(encoderDir, 'ffmpeg-linux'));
  const { chromium } = await import('@playwright/test');
  const store = new Store(join(dataDir, 'quotes.sqlite'));
  try {
    store.completeSetup({ merchant: { name: merchantName, contact: '虚构负责人', phone: '010-0000-0000',
      address: '演示市 创意路 1 号（虚构）', terms: '本报价以双方最终确认内容为准。' },
      dataAction: 'keep', confirmation: '', expectedRevision: store.workspace().revision });
  } finally { store.close(); }
  await start(); firstPid = service.pid;
  // Serve editing cards on an ordinary temporary loopback HTTP origin. Managed
  // Chromium policies may prohibit navigation to data: or file: URLs.
  mediaServer = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/pdf.png') {
      res.setHeader('Content-Type', 'image/png'); res.end(readFileSync(join(work, 'pdf-page.png')));
    } else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(mediaDocument); }
  }).listen(0, '127.0.0.1');
  await once(mediaServer, 'listening'); mediaBase = `http://127.0.0.1:${mediaServer.address().port}/`;
  const initial = await json('/api/bootstrap'); assert.equal(initial.customers.length, 5); assert.equal(initial.quotes.length, 5);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  context = await browser.newContext({ viewport: { width: 432, height: 720 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    recordVideo: { dir: join(work, 'raw'), size: { width: 432, height: 720 } } });
  videoStart = Date.now(); page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const recording = page.video();
  await showCard('给客户一份<br>清晰的报价', '手机开单，中文 PDF 带走。\n一次演示，看完整流程。', '简单报价 · 单商家工作台');
  await scene('开场', '手机开报价，中文 PDF 带走', 5);
  await scene('工作台', '客户、报价与跟进，一处整理', 5, async () => {
    await page.goto(base); await page.locator('.quote-row').first().waitFor();
  });
  await scene('新增客户', '先记下客户资料\n下次报价直接选择', 15, async () => {
    await page.getByRole('link', { name: '客户', exact: true }).click();
    await page.getByRole('button', { name: '新增客户', exact: true }).click();
    await type(page.getByLabel('客户 / 公司名称'), customerName, 85);
    await type(page.getByLabel('联系人', { exact: true }), '虚构店长', 110);
    await type(page.getByLabel('联系电话', { exact: true }), '010-0000-0099', 65);
    await pause(800);
    await page.getByRole('button', { name: '保存客户', exact: true }).click();
    await page.locator('#modal').waitFor({ state: 'hidden' });
    await page.getByRole('textbox', { name: '搜索客户' }).fill(customerName);
    await page.locator('.customer-card').waitFor();
    assert.equal(await page.locator('.customer-card').count(), 1);
  });
  await scene('新建报价', '选好客户，开始一份报价', 7, async () => {
    await page.getByRole('button', { name: '为他报价' }).click();
    assert.equal(await page.locator('#customerId option:checked').textContent(), customerName);
    await type(page.getByLabel('报价名称'), quoteTitle, 95);
  });
  await scene('第一项明细', '商品、数量和单价\n输入后自动计算', 9, async () => {
    await type(page.getByRole('textbox', { name: '第 1 项名称' }), '中文展示架', 100);
    await type(page.locator('#qty-0'), '3'); await type(page.locator('#unit-0'), '个');
    await type(page.locator('#price-0'), '19.90', 110);
  });
  await scene('小数数量', '安装服务：1.5 小时 × 100.05 元', 10, async () => {
    await page.getByRole('button', { name: '添加一项' }).click();
    await type(page.getByRole('textbox', { name: '第 2 项名称' }), '中文安装服务', 100);
    await type(page.locator('#qty-1'), '1.5', 90); await type(page.locator('#unit-1'), '小时');
    await type(page.locator('#price-1'), '100.05', 100);
    await page.getByLabel('报价说明').fill('全部内容为虚构演示资料。');
  });
  await scene('自动合计', '59.70 + 150.08\n自动合计 ¥209.78', 6, async () => {
    await page.locator('#quote-total').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#quote-total').textContent(), '¥209.78');
    report.checks.automaticTotalCents = 20978;
  });
  await scene('保存与导出', '保存报价\n一键导出中文 PDF', 7, async () => {
    await page.getByRole('button', { name: '保存报价', exact: true }).click();
    await page.locator('.detail-title').waitFor();
    assert.equal(await page.locator('.detail-title').textContent(), quoteTitle);
    const state = await json('/api/bootstrap'); const q = state.quotes.find(q => q.title === quoteTitle);
    assert.equal(q.totalCents, 20978); quoteId = q.id; report.quoteNumber = q.number;
    await pause(1400);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出中文 PDF' }).click();
    await (await download).saveAs(pdfPath);
    const text = run('pdftotext', ['-layout', pdfPath, '-']);
    for (const value of [merchantName, customerName, '中文安装服务', '209.78']) assert.ok(text.includes(value));
    report.checks.chinesePdfDownloadAndText = true;
  });
  await scene('实际导出的 PDF', '中文抬头、明细、金额与条款\n画面来自刚下载的 PDF', 12, async () => {
    const imagePath = join(work, 'pdf-page');
    run('pdftoppm', ['-f', '1', '-singlefile', '-scale-to', '1600', '-png', pdfPath, imagePath]);
    mediaDocument = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#e8ede5;color:#234d3d;font-family:sans-serif}header{padding:18px 20px;font-size:15px}small{display:block;color:#718269;font-size:12px;margin-top:6px}img{display:block;width:100%;box-shadow:0 3px 18px #234d3d18}main{padding:0 12px 20px}</style><header>已下载 · 中文报价单<small>${report.quoteNumber}.pdf · 文件画面预览</small></header><main><img alt="本次实际导出的报价单" src="/pdf.png"></main></html>`;
    await page.goto(mediaBase);
    await pause(4500);
    await page.locator('img').evaluate(img => { img.style.width = '155%'; img.style.maxWidth = 'none'; });
    await page.evaluate(() => window.scrollTo({ top: 270, behavior: 'smooth' }));
    await pause(2500);
    await page.evaluate(() => window.scrollTo({ top: 535, behavior: 'smooth' }));
  });
  await scene('更新跟进', '记录成交状态\n安排下次跟进', 14, async () => {
    await openQuote();
    await page.locator('#status').scrollIntoViewIfNeeded();
    await page.locator('#status').selectOption('won');
    await page.getByLabel('下次跟进', { exact: true }).fill(addDays(initial.today, 3));
    await type(page.getByLabel('本次跟进记录'), note, 80);
    await pause(700); await page.getByRole('button', { name: '保存跟进', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.detail-meta .pill')?.textContent === '已成交');
    assert.equal(await page.locator('.detail-meta .pill').textContent(), '已成交');
    await page.locator('.followup-history').scrollIntoViewIfNeeded();
  });
  await scene('实际重启服务', '结束并重启本机服务\n再重新打开这份报价', 4, async () => {
    await showCard('重新打开，<br>记录还在', '正在重启本机服务…', '接下来刷新页面，重新读取保存的数据。');
    await stop(); await start(); secondPid = service.pid; assert.notEqual(firstPid, secondPid);
  });
  await scene('重启后查询', '¥209.78、已成交、跟进备注\n重启后都能查到', 8, async () => {
    await openQuote();
    const state = await json('/api/bootstrap'); const q = state.quotes.find(q => q.id === quoteId);
    assert.equal(state.customers.length, 6); assert.equal(state.quotes.length, 6);
    assert.equal(q.number, report.quoteNumber); assert.equal(q.totalCents, 20978); assert.equal(q.status, 'won');
    assert.equal(q.nextFollowUp, addDays(initial.today, 3)); assert.equal(q.followUps[0].note, note);
    report.checks.actualProcessRestart = true; report.checks.restartPreservesQuoteAndFollowUp = true;
    await pause(2800); await page.locator('.followup-history').scrollIntoViewIfNeeded();
  });
  await scene('导出备份', '资料可以导出备份\n请另存一份到其他设备', 8, async () => {
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('link', { name: '商家设置', exact: true }).click();
    await page.getByRole('heading', { name: '数据备份与恢复', exact: true }).scrollIntoViewIfNeeded();
    await pause(1200);
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出备份', exact: true }).click();
    const path = join(work, 'export.json'); await (await download).saveAs(path);
    const backup = JSON.parse(readFileSync(path, 'utf8')); assert.equal(backup.customers.length, 6);
    assert.equal(backup.quotes.find(q => q.id === quoteId).status, 'won'); report.checks.backupDownloadedAndChecked = true;
  });
  await scene('片尾', '简单报价 · 单商家试用演示\n可预约安装与流程演示', 6, async () => {
    await showCard('报价做得清楚，<br>跟进记得明白。', '客户资料 · 中文报价单\n成交状态 · 数据备份', '可联系演示提供方预约试用\n本片为虚构资料演示，无实际成交或收益证明。');
  });
  assert.deepEqual(errors, []); report.checks.browserPageErrors = 0;
  await context.close(); context = null; await browser.close(); browser = null;
  await stop(); report.cleanup.serverStopped = true;
  const rawPath = await recording.path();
  const raw = JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', rawPath]));
  const trimStart = events[0].start, duration = Number(raw.format.duration) - trimStart;
  assert.ok(duration >= 95 && duration < 180, `Unexpected demo duration: ${duration}`);
  const timeline = events.map((event, index) => ({ ...event, start: Math.max(0, event.start - trimStart),
    end: Math.min(duration, index + 1 < events.length ? events[index + 1].start - trimStart : duration) }));
  report.timeline = timeline;
  report.rawRecording = { trimStart, durationSeconds: duration, width: raw.streams[0].width, height: raw.streams[0].height };
  writeFileSync(subtitlePath, timeline.map((event, index) => `${index + 1}\n${timestamp(event.start)} --> ${timestamp(event.end)}\n${event.caption}\n`).join('\n'));
  const assPath = join(work, 'captions.ass');
  writeFileSync(assPath, `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Noto Sans CJK SC,43,&H003D4D23,&H003D4D23,&H00EBF4F1,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,55,55,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` + timeline.map(event => `Dialogue: 0,${timestamp(event.start, true)},${timestamp(event.end, true)},Default,,0,0,0,,${event.caption.replaceAll('\n', '\\N')}`).join('\n') + '\n');
  const filterFile = join(work, 'compose.ffmpeg');
  writeFileSync(filterFile, `[0:v]crop=432:720:0:0,scale=960:1600:flags=lanczos:out_range=tv,setsar=1[screen];color=c=0xf1f4eb:s=1080x1920:r=25:d=${duration.toFixed(3)}[bg];[bg][screen]overlay=60:144:shortest=1,drawbox=x=58:y=142:w=964:h=1604:color=0xdce5d6:t=2,drawtext=fontfile='${filterPath(font)}':text='简单报价':fontsize=50:fontcolor=0x234d3d:x=60:y=29,drawtext=fontfile='${filterPath(font)}':text='虚构资料 · 浏览器手机视口演示':fontsize=24:fontcolor=0x718369:x=60:y=98,subtitles=filename='${filterPath(assPath)}':fontsdir='${filterPath(join(root, 'fonts'))}'[video]`);
  console.log('ENCODE: composing 1080x1920 H.264 MP4 with Chinese captions');
  const encodeLog = join(work, 'encode.log');
  const encoder = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'warning', '-ss', trimStart.toFixed(3), '-i', rawPath,
    '-filter_complex_script', filterFile, '-map', '[video]', '-an', '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '21', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-threads', '4', '-movflags', '+faststart', output],
    { env: { ...process.env, XDG_CACHE_HOME: join(work, 'cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let encodingOutput = ''; encoder.stderr.on('data', bytes => { encodingOutput += bytes; });
  const [code] = await once(encoder, 'exit'); writeFileSync(encodeLog, encodingOutput);
  if (code !== 0) throw new Error(`视频编码失败：${encodingOutput.slice(-2000)}`);
  const media = JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output]));
  const stream = media.streams.find(s => s.codec_type === 'video');
  assert.equal(stream.codec_name, 'h264'); assert.equal(stream.pix_fmt, 'yuv420p'); assert.equal(stream.width, 1080); assert.equal(stream.height, 1920);
  assert.ok(Math.abs(Number(media.format.duration) - duration) < 0.5);
  run(ffmpeg, ['-v', 'error', '-i', output, '-map', '0:v:0', '-f', 'null', '-'], { timeout: 120000 });
  const cover = output.replace(/\.mp4$/i, '-cover.jpg');
  const totalScene = timeline.find(event => event.name === '自动合计');
  run(ffmpeg, ['-y', '-v', 'error', '-ss', String(totalScene.start + 2), '-i', output, '-frames:v', '1', '-q:v', '2', cover]);
  copyFileSync(subtitlePath, output.replace(/\.mp4$/i, '.zh-CN.srt'));
  report.output = { filename: output.split('/').at(-1), bytes: statSync(output).size, durationSeconds: Number(media.format.duration),
    width: stream.width, height: stream.height, codec: stream.codec_name, pixelFormat: stream.pix_fmt,
    sha256: createHash('sha256').update(readFileSync(output)).digest('hex'), fullDecodePassed: true,
    fastStart: true, chineseCaptionsBurnedIn: true };
  report.pdfPreviewMethod = 'The PDF actually downloaded in this run was rendered with Poppler; this is an edited video preview, not an in-app PDF viewer.';
  report.timeline = timeline; report.result = 'passed';
  console.log(JSON.stringify({ result: report.result, output, ...report.output }));
} catch (error) {
  report.result = 'failed'; report.error = error.message;
  console.error(error.stack); process.exitCode = 1;
} finally {
  try { if (context) await context.close(); if (browser) await browser.close(); } catch {}
  await stop(); report.cleanup.serverStopped = !service || service.exitCode !== null;
  if (mediaServer?.listening) await new Promise(resolveClose => mediaServer.close(resolveClose));
  report.cleanup.mediaServerStopped = !mediaServer?.listening;
  if (process.env.KEEP_DEMO_RAW === '1' || report.result !== 'passed') report.rawWorkDirectory = work;
  else { rmSync(work, { recursive: true, force: true }); report.cleanup.temporaryDataRemoved = true; }
  mkdirSync(evidence, { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}
