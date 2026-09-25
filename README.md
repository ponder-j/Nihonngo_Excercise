# かな Loop

一个轻量的日语假名练习网页。练习内容覆盖五十音、浊音和半浊音，共 71 个假名；学习权重和每日记录保存在浏览器本机。

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

- 假名 → 罗马音：显示罗马音、我知道、我忘了
- 罗马音 → 假名：显示平假名、显示片假名、我知道、我忘了
- “我知道”会降低该假名的抽取权重，“我忘了”会提高权重
- 校验模式：打开后主动写出答案；假名手写最多识别 5 次，罗马音最多输入 1 次
- 日语手写识别由独立 OCR 服务完成；前端不会下载日语模型，笔迹只会发送到配置的 OCR API
- 学习权重和每日记录保存在浏览器 `localStorage`，无需数据库
- 每完成 50 题询问是否休息
- 显示最近 7 天完成量、忘记率和薄弱假名

## OCR 服务

校验模式需要 OCR 服务。前端通过构建时的 `VITE_OCR_API_URL` 指向它；未配置时，本地开发默认使用 `http://127.0.0.1:8124`。

本地启动：

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
