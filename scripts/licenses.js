import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const allowed = new Set(['MIT', '(MIT AND Zlib)', 'Apache-2.0', '(MPL-2.0 OR Apache-2.0)', 'BSD-3-Clause', 'ISC', '0BSD']);
const inventory = [], notices = [], problems = [];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || !existsSync(join(path, 'package.json'))) continue; // platform-specific optional dependency
  const p = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  const license = typeof p.license === 'string' ? p.license : p.license?.type;
  if (!allowed.has(license)) problems.push(`${p.name}: unreviewed license ${license}`);
  const files = readdirSync(path).filter(f => /^(licen[cs]e|notice|copying|third.?party.*(?:notice|licen))/i.test(f));
  // These upstream releases declare MIT but omit a separate license document.
  // Keep their exact READMEs, author metadata, plus upstream text when available.
  if (!files.length) files.push(...readdirSync(path).filter(f => /^readme/i.test(f)));
  const repo = typeof p.repository === 'string' ? p.repository : p.repository?.url || '';
  const row = { name: p.name, version: p.version, license, scope: entry.dev ? 'development' : 'runtime', repository: repo, author: p.author || '', preservedFiles: files };
  inventory.push(row);
  notices.push(`\n${'='.repeat(80)}\n${p.name}@${p.version}\nDeclared license: ${license}\nAuthor: ${typeof p.author === 'string' ? p.author : JSON.stringify(p.author || '')}\nRepository: ${repo}\n`);
  for (const file of files) {
    try { notices.push(`\n--- ${file} ---\n${readFileSync(join(path, file), 'utf8')}\n`); }
    catch { problems.push(`${p.name}: cannot preserve ${file}`); }
  }
}
// brotli.js declares MIT at package level; its Google-derived decoder sources
// retain Apache-2.0 headers. Preserve these additional notices explicitly.
for (const file of readdirSync('node_modules/brotli/dec').filter(f => f.endsWith('.js'))) {
  const content = readFileSync(join('node_modules/brotli/dec', file), 'utf8');
  const header = content.match(/^\/\*[\s\S]*?\*\//)?.[0];
  if (header) notices.push(`\n--- brotli/dec/${file}: original header ---\n${header}\n`);
}
for (const file of readdirSync('docs/third-party/upstream').sort()) notices.push(`\n--- upstream/${file} ---\n${readFileSync(join('docs/third-party/upstream', file), 'utf8')}\n`);
inventory.sort((a, b) => a.name.localeCompare(b.name));
mkdirSync('docs/third-party', { recursive: true });
writeFileSync('docs/third-party/inventory.json', JSON.stringify(inventory, null, 2) + '\n');
writeFileSync('docs/third-party/LICENSES.txt', notices.join('\n'));
const table = inventory.map(p => `| ${p.name} | ${p.version} | ${p.license.replaceAll('|', '\\|')} | ${p.scope} |`).join('\n');
writeFileSync('THIRD_PARTY_NOTICES.md', `# 第三方软件及字体声明

清单来自本仓库 package-lock.json 和已安装的包，生成命令：\`npm run licenses\`。当前 ${inventory.length} 个已安装包。Linux 不安装的可选平台依赖不在此表中；其他平台安装后请重新生成。

完整许可、NOTICE、原始 README 和补充声明保存在 [LICENSES.txt](docs/third-party/LICENSES.txt)，机器可读清单为 [inventory.json](docs/third-party/inventory.json)。分发源码或构建镜像时保留本文件、上述声明及 fonts/OFL.txt。npm 安装的模块还保留各自原始代码中的版权头。

- 本项目源码：MIT，见根目录 LICENSE。
- pdfme：MIT，Copyright (c) 2020 HandDot。其 npm 发布包省略单独许可证，已从官方仓库保留全文于 docs/third-party/upstream/pdfme-MIT.txt（来源 https://github.com/pdfme/pdfme/blob/main/LICENSE.md）。未复制 pdfme 编辑器或整个仓库。
- air-datepicker：MIT，保留官方 v3 分支 LICENSE.md 于 upstream/air-datepicker-MIT.txt。
- fontkit、dfa、brotli 的当前 npm 包和官方仓库没有独立 LICENSE 文件，保留原始 README 的 MIT 声明与包作者元数据。MIT 标准条款见 upstream/MIT-terms.txt；不虚构未提供的版权年份。
- brotli.js：包声明 MIT，但 dec/*.js 含 Copyright 2013 Google Inc. 的 Apache-2.0 头，已额外保留各头和 Apache-2.0 全文。不能只按根 package.json 的 MIT 标签判断整个包。
- DOMPurify 的可选许可证表达式为 MPL-2.0 OR Apache-2.0，本交付选用 Apache-2.0，并保留其原始 LICENSE。MIT AND Zlib 组合依赖须同时保留两者声明；原文件均已收录。
- 中文字体：Noto Sans CJK SC Regular，Copyright 2014–2021 Adobe，另保留上游 Google 版权声明，OFL 1.1。字体从 NotoSansCJK-Regular.ttc 的 SC 字面提取，未修改字形与字体名称。来源 https://github.com/notofonts/noto-cjk；全文 fonts/OFL.txt。生成 PDF 不会因此被要求使用 OFL。
- 几何线形界面图标参考 Lucide 的开放图标样式；ISC 声明随 lucide 包的许可文件保留。

已核对表中的 MIT、MIT AND Zlib、Apache-2.0、BSD-3-Clause、ISC、0BSD 及上述双重许可选择，均为可用于商业分发的开放许可证；应履行各自声明保留义务。许可证检查不会替代商家自己的商标与业务内容授权。

| 包 | 精确版本 | 声明许可证 | 用途 |
| --- | --- | --- | --- |
${table}
`);
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log(`License review: ${inventory.length} packages checked; notices preserved; no unreviewed license declarations.`);
