# かな Loop

一个轻量的日语单元练习网页。内置「假名练习单元」覆盖五十音、浊音和半浊音，共 71 个假名；也可以手动建立课程和单词库。词库、学习权重和每日记录保存在浏览器本机。

## 运行

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址即可。

## 作为常驻服务运行

项目已提供 macOS `launchd` 用户服务，默认监听本机 `127.0.0.1:1234`，登录后自动启动，异常退出后自动拉起。

```bash
npm run service:install
```

安装后访问：

<http://127.0.0.1:1234>

代码更新后重新构建即可，服务会直接读取新的 `dist/`：

```bash
npm run build
```

如需卸载常驻服务：

```bash
npm run service:uninstall
```

## 在线版本

GitHub Pages 地址：

<https://ponder-j.github.io/Nihonngo_Excercise/>

推送到 `main` 分支后，GitHub Actions 会自动测试、构建并部署。

## 功能

- 主界面选择单元 / 课程，随时切换假名练习与课程单词抽查
- 单元与词库管理：新建、重命名、编辑、删除课程，内置假名单元固定保留
- 单词按「日文（汉字 / 假名）、假名拼写、声调类型、中文释义」四栏录入，Tab 切换下一栏，Enter 确认当前行并聚焦下一行；支持日文输入法，输入法确认不会误提交
- 每行最右侧可删除单词，点击「保存单元」统一写入词库；保存时也会收录尚未按 Enter 确认的完整行，忽略空行，并提示不完整的行
- 课程单词抽查以中文释义为题，点击「查看答案」显示日文、假名和声调，再选择「我知道」或「我忘了」
- 每个单元独立记录学习权重、每日题数、掌握数量和薄弱内容；原有假名学习记录自动沿用
- 假名 → 罗马音：显示罗马音、我知道、我忘了
- 罗马音 → 假名：显示平假名、显示片假名、我知道、我忘了
- “我知道”会降低该假名的抽取权重，“我忘了”会提高权重
- 校验模式：打开后主动写出答案；假名手写最多识别 5 次，罗马音最多输入 1 次
- 日语手写识别由独立 OCR 服务完成；前端不会下载日语模型，笔迹只会发送到配置的 OCR API
- 学习权重和每日记录保存在浏览器 `localStorage`，无需数据库
- 每完成 50 题询问是否休息
- 显示最近 7 天完成量、忘记率和薄弱假名

## 添加课程词库

进入「单元与词库管理」，点击「新建单元」，填写课程名称（例如「第一课 小李是个中国人」），再逐行填写四项单词信息。声调使用 0、1、2 等非负整数，假名拼写使用平假名或片假名。每行按 Enter 后可继续录入下一行，最后点击「保存单元」。点击「返回练习此单元」或返回「卡片练习」选择课程，即可开始抽查。

GitHub Pages 版本无需数据库。自建词库与记录仅保存在当前浏览器，刷新或重新打开仍会保留；不同浏览器、设备和网站域名之间不自动同步。清除单元练习记录会保留词库，删除单元会同时移除该单元词库与记录。OCR 校验模式仍仅用于假名练习。

## OCR 服务

校验模式需要 OCR 服务。前端通过构建时的 `VITE_OCR_API_URL` 指向它；未配置时，本地开发默认使用 `http://127.0.0.1:8124`。

本机 PaddleOCR 测试（Windows PowerShell，Python 3.12）：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r paddle-ocr-requirements.txt
.\.venv\Scripts\python.exe paddle-ocr-server.py
```

首次启动会下载 `PP-OCRv5_server_rec` 模型；看到 `listening on http://127.0.0.1:8124` 后，在另一个终端执行 `npm install`、`npm run dev`，打开本地网页的校验模式。`http://127.0.0.1:8124/healthz` 可检查服务。PaddleOCR 服务与原来的 Tesseract.js 服务使用同一个端口，不要同时启动。可用 `OCR_MODEL_NAME` 环境变量切换 PaddleOCR 的文字识别模型。

后端会从画布中裁出笔迹，以单字识别模型推理，并把常见的同形汉字或符号归一化为假名。响应中的 `rawText` 保留模型原始输出，识别失败时网页会显示它，便于判断是识别问题还是连接问题。单字「エ/ユ」等仍可能混淆。

原 Tesseract.js 服务启动方式：

```bash
npm run ocr-server
```

线上部署使用独立的用户级 systemd 服务，监听服务器本机 `127.0.0.1:8124`，再通过 Tailscale 提供 HTTPS 入口。服务文件和环境变量模板位于 `deploy/`；日语模型放在服务器的 `models/` 目录，不提交到 Git。

注意：如果 Tailscale 入口是 `tailnet only`，只有同一 Tailnet 内的设备能使用校验模式；要让任意公网访问 GitHub Pages，需要为该 OCR 入口启用 Tailscale Funnel。

## 验证

```bash
npm test
npm run build
```

## 服务日志

- 标准日志：`~/Library/Logs/kana-loop.log`
- 错误日志：`~/Library/Logs/kana-loop-error.log`
