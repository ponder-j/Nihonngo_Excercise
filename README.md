# かな Loop

一个轻量的日语单元练习网页。内置「假名练习单元」覆盖五十音、浊音和半浊音，共 71 个假名；也可以手动建立课程和单词库。本地服务把正式词库保存到 `public/data/units.json`，该文件可随 GitHub Pages 发布。学习权重和每日记录保存在当前浏览器。

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

页面代码更新后重新构建即可，服务直接读取新的 `dist/`：

```bash
npm run build
```

修改 `server.mjs` 或 `lib/` 后执行 `npm run service:install` 重新构建并重启服务。词库文件的修改立即生效，无需重启或重建。

如需卸载常驻服务：

```bash
npm run service:uninstall
```

## 在线版本

GitHub Pages 地址：

<https://ponder-j.github.io/Nihonngo_Excercise/>

推送到 `main` 分支后，GitHub Actions 会自动测试、构建并部署。

### 将本地词库同步到 Pages

先在本地管理页确认导入内容并点击「确认并保存单元」，正式内容写入 `public/data/units.json`。待审核草稿不会发布。

第一次发布本次新增的文件保存、导入和界面功能时，需要提交全部相关源码与词库：

```bash
git status
npm test
npm run build
git add .
git commit -m "Add file-backed vocabulary library and import workflow"
git push origin main
```

以后只新增或修改词库时，在项目目录执行：

```bash
git diff -- public/data/units.json
git add public/data/units.json
git commit -m "Update vocabulary units"
git push origin main
```

`git push` 只上传已提交的内容，未 commit 的词库修改不会上传。进入 GitHub 仓库的 Actions，等待「Deploy to GitHub Pages」成功，刷新线上页面即可看到更新；无需提交 `dist/` 或手动上传构建文件。

## 功能

- 主界面选择单元 / 课程，随时切换假名练习与课程单词抽查
- 单元与词库管理：新建、重命名、编辑、删除课程，内置假名单元固定保留
- 单词按「日文（汉字 / 假名）、假名拼写、声调类型、中文释义」四栏录入，Tab 切换下一栏，Enter 确认当前行并聚焦下一行；支持日文输入法，输入法确认不会误提交
- 每行最右侧可删除单词，点击「保存单元」统一写入词库；保存时也会收录尚未按 Enter 确认的完整行，忽略空行，并提示不完整的行
- 课程单词抽查以中文释义为题，点击「查看答案」显示日文、假名和声调，再选择「我知道」或「我忘了」
- 显示答案后，点击旁边的喇叭播放日语发音；支持假名和课程单词，播放中再次点击可停止，切题或离开练习会自动停止
- 每个单元独立记录学习权重、每日题数、掌握数量和薄弱内容；原有假名学习记录自动沿用
- 假名 → 罗马音：显示罗马音、我知道、我忘了
- 罗马音 → 假名：显示平假名、显示片假名、我知道、我忘了
- “我知道”会降低该假名的抽取权重，“我忘了”会提高权重
- 校验模式：打开后主动写出答案；假名手写最多识别 5 次，罗马音最多输入 1 次
- 全局校验开关同样支持自建课程：只给中文，输入单词假名，最多 3 次；平假名可匹配词库中的片假名。三次内答对按「我知道」降低权重，三次均错或跳过按「我忘了」增加权重。结果显示标准日文和假名，点击「下一题」继续
- 错题回顾：答错、选择「我忘了」或跳过的题目会进入当前单元的错题本；进入专门回顾后，答对 2 次会自动移出
- 全站采用灰白与冷蓝界面，单元菜单支持方向键、Enter、Escape 和键盘搜索
- 日语手写识别由独立 OCR 服务完成；前端不会下载日语模型，笔迹只会发送到配置的 OCR API
- 学习权重和每日记录保存在浏览器 `localStorage`，无需数据库
- 每完成 50 题询问是否休息
- 显示最近 7 天完成量、忘记率和薄弱假名

## 日语发音

答案旁的喇叭使用有道公开词典音频外链（`https://dict.youdao.com/dictvoice`，`le=jap`），本地服务与 GitHub Pages 均可使用，无需配置密钥。只有点击播放时才将当前读音发送给有道，不提前请求整份词库。

课程单词优先朗读已录入的假名，避免汉字多音词被自动选成另一读法；内置假名朗读对应的日语假名，不读罗马音。合成语音不会根据词库的数字声调字段控制音高，声调仍以教材标注为准。

外链失败或加载超过 8 秒时，自动尝试浏览器 / 系统提供的日语音色。如果设备没有可用的日语音色，会提示检查网络或安装日语语音。此公开词典端点没有作为正式 TTS API 的稳定性承诺；地址集中在 `src/pronunciation.js` 中，便于后续更换供应商。

## 添加课程词库

进入「单元与词库管理」，点击「新建单元」，填写课程名称（例如「第一课 小李是个中国人」），再逐行填写四项单词信息。声调使用 0、1、2 等非负整数，假名拼写使用平假名或片假名。每行按 Enter 后可继续录入下一行，最后点击「保存单元」。点击「返回练习此单元」或返回「卡片练习」选择课程，即可开始抽查。

本地服务点击「保存单元」会写入 `public/data/units.json`，保存前自动备份到 `.local-data/backups/`。旧 localStorage 单元可通过「迁移浏览器中的单元」合并进文件；其他域名或设备中的旧单元可先导出词库，再在本地「导入 JSON」。同 ID 不同内容会保留为副本。

来自相邻 `biaori` 项目的词表可运行 `npm run vocab:import-biaori` 导入。脚本跳过已有的第一课，按课程建立其余单元；再次运行会保留已存在课程的人工修改。导入词的声调为 `待校对`，源条目缺少读音或中文时也用此占位符，补全前不参与练习。多写法、注音标记等需重点核对的条目列在本地 `.local-data/biaori-import-review.json`。编辑器可将声调逐条改为非负整数后保存。运行 `npm run vocab:import-biaori -- --dry-run` 可先查看导入规模。

GitHub Pages 启动时读取仓库发布的词库文件。线上临时新增、修改和删除只影响当前浏览器，可导出后导入本地服务。确认本地文件后，提交并推送到 `main`，Actions 自动测试、构建和部署词库。学习记录不随词库同步。清除练习记录保留词库，删除正式单元移除词库及当前浏览器的该单元记录。

## 图片识别并导词入库

仓库提供 `.agents/skills/nihongo-vocabulary-import/` skill 和本机导入接口。把日语单词表图片交给 agent，并要求使用 `$nihongo-vocabulary-import`，它会识别四列数据、标记不确定项并创建待审核草稿。缺失声调留空，不默认填 0。

也可将识别结果写成 JSON 后运行：

```bash
npm run vocab:import -- /absolute/path/words.json
```

打开返回的审核链接，或进入管理页点击「刷新词库」选择「待审核导入」，检查、补全、修改四列信息后点击「确认并保存单元」。只有确认后的内容进入正式文件；草稿与备份均被 Git 忽略。

接口说明和载荷示例见 [docs/library-api.md](docs/library-api.md)，文件结构见 [docs/units.schema.json](docs/units.schema.json)。图片由 agent 读取，导入接口接收整理后的文字 JSON，和原假名手写 OCR 服务相互独立。

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
