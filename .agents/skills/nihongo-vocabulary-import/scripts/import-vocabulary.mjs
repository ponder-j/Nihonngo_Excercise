#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const urlIndex = args.indexOf("--url");
const base = new URL(urlIndex >= 0 ? args[urlIndex + 1] : "http://127.0.0.1:1234");
if (base.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
  throw new Error("导入地址必须为本机 HTTP 服务");
}
if (urlIndex >= 0) args.splice(urlIndex, 2);
const [file] = args;
if (!file || args.length !== 1) {
  console.error("Usage: node import-vocabulary.mjs <words.json> [--url http://127.0.0.1:1234]");
  process.exitCode = 1;
} else {
  try {
    const input = JSON.parse(await readFile(file, "utf8"));
    const health = await fetch(new URL("/api/health", base), { signal: AbortSignal.timeout(10000) });
    if (!health.ok || (await health.json()).storage !== "file") throw new Error("本地词库服务未就绪，请先启动或安装服务");
    const response = await fetch(new URL("/api/imports", base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Import failed (${response.status})`);
    console.log(JSON.stringify({
      id: result.id,
      status: result.status,
      created: result.created,
      name: result.unit.name,
      words: result.unit.words.length,
      notes: result.notes || [],
      issues: result.issues || [],
      reviewUrl: new URL(`/?import=${result.id}`, base).href,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
