# 手机报价演示视频

这段视频用于给首批商家展示已实现的工作流程，使用独立临时数据库、虚构商家和虚构客户。它没有展示真实订单、付款或收益，也不是 iPhone / Android 真机录屏。

- [观看 / 下载竖屏 MP4](evidence/merchant-quotes-demo.mp4)
- [视频封面](evidence/demo-video-cover.jpg)
- [独立中文字幕](evidence/demo-video.zh-CN.srt)
- [录制中实际下载的中文 PDF](evidence/demo-video-quote.pdf)
- [机器可读验收记录](evidence/demo-video-verification.json)
- [分镜与字幕脚本](DEMO-VIDEO-SCRIPT.md)

视频使用 1080 × 1920、H.264、25 帧 / 秒和 `yuv420p`，字幕直接压入画面；无配音与背景音乐，可以静音观看。启用 MP4 快速起播。观看与转发视频不需要安装本项目或 Node.js。

## 展示内容

新增客户 → 为客户报价 → 两行明细自动合计 ¥209.78 → 保存与下载中文 PDF → 查看该 PDF → 保存已成交、下次跟进和备注 → 实际停止旧服务并启动新进程 → 重新查询同一份报价 → 下载并核对备份。

PDF 画面由本次实际下载的文件经 Poppler 渲染，再插入视频；该画面不代表产品提供内嵌 PDF 阅读器。重启过场是制作字幕，实际录制确实结束旧进程，并从同一临时 SQLite 数据目录启动新进程。随后检查原编号、金额、状态、日期和跟进备注。

浏览器使用 432 × 720 的触屏视口。片头、片尾、PDF 文件画面与字幕属于剪辑内容；商家操作部分来自实际运行的网页。字幕位于操作画面外，不遮挡按钮和金额。

## 重新制作

已验证的制作环境：Linux、Node.js 24、系统 Chromium、FFmpeg 7 和 Poppler。此制作脚本不作为 Windows / macOS 的安装验收结果。

```bash
npm ci
node scripts/record-demo.mjs
```

制作需要本地监听端口及 Chromium 子进程权限。脚本只监听 `127.0.0.1`，不发布公网服务，不读取 `.env` 或商家 `data/`，不调用 AI、配音或其他收费服务。默认 MP4 输出到项目目录旁的 `merchant-quotes-demo.mp4`，同时输出封面和独立字幕；PDF、字幕与验证记录写入 `docs/evidence/`。

可以用 `CHROMIUM_PATH` 指定 Chromium 路径，用 `DEMO_VIDEO_OUTPUT` 指定 MP4 完整路径。录制成功后删除临时数据库、浏览器录制缓存和临时媒体服务；`KEEP_DEMO_RAW=1` 可保留制作文件，方便继续剪辑。失败时会保留临时文件及错误记录，不把失败当作通过。

本项目已有开发依赖 Playwright。脚本通过独立临时目录复用系统 FFmpeg，不下载浏览器、字体或模型，也不修改 Playwright 安装文件。FFmpeg、Chromium 和 Poppler 作为本机制作工具使用，不随应用打包；应用依赖与字体许可仍见根目录第三方声明。

## 验收方式与交付

录制中的每个关键保存与下载都有数据断言，结束后检查中文 PDF 文本、实际服务重启和备份内容。成片检查编码、分辨率、时长及完整视频解码，并抽查片头、客户、金额、PDF、成交、重启后和片尾画面。最终结果与实际时长见验收 JSON。

发给商家时，可以配合 [简短介绍与演示邀约](SALES-MESSAGE.md)。先确认电脑、手机和网络适用，再按 [试售方案](TRIAL-OFFER.md) 说明范围，用 [交付单](HANDOVER.md) 做真机签收。视频中“已成交”只是虚构报价状态，不能作为软件已经卖出的证据。
