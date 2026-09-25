# かな Loop

一个零后端的日语假名练习网页。练习内容覆盖五十音、浊音和半浊音，共 71 个假名。

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
- 日语手写识别在浏览器端使用 `tesseract.js` 的 `jpn` 模型，首次识别需要下载模型，笔迹不会上传到应用服务器
- 学习权重和每日记录保存在浏览器 `localStorage`，无需数据库
- 每完成 50 题询问是否休息
- 显示最近 7 天完成量、忘记率和薄弱假名

## 验证

```bash
npm test
npm run build
```

## 服务日志

- 标准日志：`~/Library/Logs/kana-loop.log`
- 错误日志：`~/Library/Logs/kana-loop-error.log`
