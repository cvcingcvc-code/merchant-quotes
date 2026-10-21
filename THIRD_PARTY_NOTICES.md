# 第三方软件及字体声明

清单来自本仓库 package-lock.json 和已安装的包，生成命令：`npm run licenses`。当前 110 个已安装包。Linux 不安装的可选平台依赖不在此表中；其他平台安装后请重新生成。

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
| @pdf-lib/standard-fonts | 1.0.0 | MIT | runtime |
| @pdf-lib/upng | 1.0.1 | MIT | runtime |
| @pdfme/common | 6.2.6 | MIT | runtime |
| @pdfme/generator | 6.2.6 | MIT | runtime |
| @pdfme/pdf-lib | 6.2.6 | MIT | runtime |
| @pdfme/schemas | 6.2.6 | MIT | runtime |
| @playwright/test | 1.64.1 | Apache-2.0 | development |
| @swc/helpers | 0.5.23 | Apache-2.0 | runtime |
| @types/trusted-types | 2.0.7 | MIT | runtime |
| accepts | 2.0.0 | MIT | runtime |
| acorn | 8.19.0 | MIT | runtime |
| air-datepicker | 3.6.0 | MIT | runtime |
| base64-js | 1.5.1 | MIT | runtime |
| better-sqlite3 | 13.0.3 | MIT | runtime |
| body-parser | 2.3.0 | MIT | runtime |
| brotli | 1.3.3 | MIT | runtime |
| buffer | 6.0.3 | MIT | runtime |
| bwip-js | 4.11.4 | MIT | runtime |
| bytes | 3.1.2 | MIT | runtime |
| call-bind-apply-helpers | 1.0.2 | MIT | runtime |
| call-bound | 1.0.4 | MIT | runtime |
| clone | 2.1.2 | MIT | runtime |
| color | 5.0.3 | MIT | runtime |
| color-convert | 3.1.3 | MIT | runtime |
| color-name | 2.1.1 | MIT | runtime |
| color-string | 2.1.4 | MIT | runtime |
| content-disposition | 2.0.1 | MIT | runtime |
| content-type | 2.1.0 | MIT | runtime |
| cookie | 0.7.2 | MIT | runtime |
| cookie-signature | 1.2.2 | MIT | runtime |
| date-fns | 4.4.0 | MIT | runtime |
| debug | 4.4.3 | MIT | runtime |
| depd | 2.0.0 | MIT | runtime |
| dfa | 1.2.0 | MIT | runtime |
| dompurify | 3.4.17 | (MPL-2.0 OR Apache-2.0) | runtime |
| dunder-proto | 1.0.1 | MIT | runtime |
| ee-first | 1.1.1 | MIT | runtime |
| encodeurl | 2.0.0 | MIT | runtime |
| es-define-property | 1.0.1 | MIT | runtime |
| es-errors | 1.3.0 | MIT | runtime |
| es-object-atoms | 1.1.2 | MIT | runtime |
| escape-html | 1.0.3 | MIT | runtime |
| etag | 1.8.1 | MIT | runtime |
| express | 5.3.0 | MIT | runtime |
| fast-deep-equal | 3.1.3 | MIT | runtime |
| finalhandler | 2.1.1 | MIT | runtime |
| fontkit | 2.0.4 | MIT | runtime |
| forwarded | 0.2.0 | MIT | runtime |
| fresh | 2.0.0 | MIT | runtime |
| function-bind | 1.1.2 | MIT | runtime |
| get-intrinsic | 1.3.0 | MIT | runtime |
| get-proto | 1.0.1 | MIT | runtime |
| gopd | 1.2.0 | MIT | runtime |
| has-symbols | 1.1.0 | MIT | runtime |
| hasown | 2.0.4 | MIT | runtime |
| html-entities | 2.6.0 | MIT | runtime |
| http-errors | 2.0.1 | MIT | runtime |
| iconv-lite | 0.7.3 | MIT | runtime |
| ieee754 | 1.2.1 | BSD-3-Clause | runtime |
| inherits | 2.0.4 | ISC | runtime |
| ipaddr.js | 1.9.1 | MIT | runtime |
| is-promise | 4.0.0 | MIT | runtime |
| jpeg-js | 0.4.4 | BSD-3-Clause | runtime |
| lucide | 1.60.0 | ISC | runtime |
| math-intrinsics | 1.1.0 | MIT | runtime |
| media-typer | 1.1.1 | MIT | runtime |
| merge-descriptors | 2.0.0 | MIT | runtime |
| mime-db | 1.54.0 | MIT | runtime |
| mime-types | 3.0.2 | MIT | runtime |
| ms | 2.1.3 | MIT | runtime |
| negotiator | 1.1.0 | MIT | runtime |
| node-addon-api | 8.9.2 | MIT | runtime |
| node-html-better-parser | 1.5.9 | MIT | runtime |
| object-inspect | 1.13.4 | MIT | runtime |
| on-finished | 2.4.1 | MIT | runtime |
| once | 1.4.0 | ISC | runtime |
| pako | 1.0.11 | (MIT AND Zlib) | runtime |
| pako | 1.0.11 | (MIT AND Zlib) | runtime |
| pako | 3.0.2 | (MIT AND Zlib) | runtime |
| pako | 0.2.9 | MIT | runtime |
| parseurl | 1.3.3 | MIT | runtime |
| path-to-regexp | 8.4.2 | MIT | runtime |
| playwright | 1.64.1 | Apache-2.0 | development |
| playwright-core | 1.64.1 | Apache-2.0 | development |
| proxy-addr | 2.0.8 | MIT | runtime |
| qs | 6.16.1 | BSD-3-Clause | runtime |
| range-parser | 1.3.0 | MIT | runtime |
| raw-body | 3.0.2 | MIT | runtime |
| restructure | 3.0.2 | MIT | runtime |
| router | 2.2.0 | MIT | runtime |
| safer-buffer | 2.1.2 | MIT | runtime |
| send | 1.2.1 | MIT | runtime |
| serve-static | 2.2.1 | MIT | runtime |
| setprototypeof | 1.2.0 | ISC | runtime |
| side-channel | 1.1.1 | MIT | runtime |
| side-channel-list | 1.0.1 | MIT | runtime |
| side-channel-map | 1.0.1 | MIT | runtime |
| side-channel-weakmap | 1.0.2 | MIT | runtime |
| signature_pad | 5.1.4 | MIT | runtime |
| statuses | 2.0.2 | MIT | runtime |
| tiny-inflate | 1.0.3 | MIT | runtime |
| toidentifier | 1.0.1 | MIT | runtime |
| tslib | 2.8.1 | 0BSD | runtime |
| type-is | 2.1.0 | MIT | runtime |
| unicode-properties | 1.4.1 | MIT | runtime |
| unicode-trie | 2.0.0 | MIT | runtime |
| unpipe | 1.0.0 | MIT | runtime |
| vary | 1.1.2 | MIT | runtime |
| wrappy | 1.0.2 | ISC | runtime |
| zod | 4.6.7 | MIT | runtime |
