# 本地词库接口

默认地址 `http://127.0.0.1:1234`。`npm run dev` 的 Vite 服务也提供同一套接口；`vite preview` 仅用于静态预览。API 只接受 loopback Host 和同源浏览器请求，CLI 请求可不带 Origin。

## 正式词库

仓库文件：`public/data/units.json`。结构是 `{ "version": 1, "units": [...] }`。每个单元包含 `id`、`name`、`kind: "vocabulary"`、`words`；每个单词包含稳定 `id`、`japanese`、`kana`、`accent`、`meaning`。声调为非负整数或文字占位符 `待校对`；缺失读音也可用 `待校对`，补全前不参与练习。内置 71 个假名由程序提供，不重复写入文件。完整规范见 `units.schema.json`。

- `GET /api/health`：确认服务与词库可读，返回 `{ "ok": true, "storage": "file", "version": 1 }`。
- `GET /api/library`：返回 `{ library, revision, imports }`，响应 `ETag` 等于 `revision`。
- `PUT /api/library`：请求 `Content-Type: application/json`，`If-Match` 使用最近读出的完整 `revision`（包含双引号），body 是完整词库。审核导入时附加 `importId`，正式词库需包含该草稿的单元 ID。
- `GET /data/units.json`：返回最新正式词库，本地服务无需重建便可看到修改。Pages 提供构建时复制的版本。

缺少 If-Match 返回 428；版本过期返回 409；字段错误返回 422；所有错误使用 `{ "error": "原因" }`。正式词库读取出错时返回 500，绝不静默清空。写入采用临时文件、fsync、原子替换；旧版本保存到 `.local-data/backups/`。

## 图片识别结果导入

由 agent 直接识别图片并整理 JSON，再调用 `POST /api/imports`。这个接口接收文字结果，不是图片 OCR 服务，不需要额外模型、API key 或 MCP 配置。

```json
{
  "name": "第一课",
  "source": "第一课词表.png",
  "words": [
    { "japanese": "学生", "kana": "がくせい", "accent": 0, "meaning": "学生" },
    { "japanese": "先生", "kana": "せんせい", "accent": "", "meaning": "老师" }
  ],
  "notes": [{ "row": 2, "field": "accent", "message": "未标注声调" }]
}
```

课程名称和 1–5000 行 words 必填。不完整字段允许空字符串，不确定项放在 notes；0 是有效声调，不能用来代替未知。row 从 1 开始。每次请求限 5 MB。

响应包含 `id`、`status: "pending"`、`unit`、`notes`、`issues`、`created`。相同规范化载荷使用同一 ID，重试不会新增重复草稿；已经确认的载荷返回 `status: "approved"`。草稿存在 `.local-data/imports/`，不会随 Pages 发布。

- `GET /api/imports`：返回 `{ imports: [...] }`。
- `DELETE /api/imports/:id`：丢弃草稿，不影响正式词库。
- 打开 `/?import=草稿ID` 直接审核，或在管理页点击「刷新词库」，选择「待审核导入」。填写缺失字段并核对，点击「确认并保存单元」后进入正式文件。

CLI：`npm run vocab:import -- /absolute/path/words.json`，可加 `--url http://127.0.0.1:PORT`。

## 旧数据与 Pages

本地管理页的「迁移浏览器中的单元」会合并当前 origin 的旧 localStorage 单元，保留旧存储作备份。同 ID 不同内容会另建副本，避免覆盖。浏览器不能跨域读取旧数据：其他域名或设备上的词库应先在原页面「导出词库」，然后在本地服务「导入 JSON」。

Pages 启动时读取已发布的 `data/units.json`。线上临时修改使用本地覆盖层，不会直接修改 GitHub；可导出后导回本地服务。未修改的发布单元能随新版本更新。学习记录始终留在当前浏览器。
