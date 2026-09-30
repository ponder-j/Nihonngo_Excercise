import { ApiError } from "./library-service.mjs";

function send(res, status, value, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) throw new ApiError(415, "请求须使用 application/json");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new ApiError(413, "导入文件不得超过 5 MB");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ApiError(400, "JSON 格式无效"); }
}

function checkLocalRequest(req) {
  const host = req.headers.host;
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new ApiError(403, "词库接口仅限本机访问");
  if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new ApiError(403, "不允许跨站访问本地词库");
  if (req.headers["sec-fetch-site"] === "cross-site") throw new ApiError(403, "不允许跨站访问本地词库");
}

export function createLibraryApi(service) {
  return async (req, res) => {
    const path = new URL(req.url || "/", "http://localhost").pathname;
    if (!path.startsWith("/api/")) return false;
    try {
      checkLocalRequest(req);
      if (path === "/api/library" && req.method === "GET") {
        const result = await service.snapshot();
        send(res, 200, result, { ETag: result.revision });
      } else if (path === "/api/library" && req.method === "PUT") {
        const input = await readJson(req);
        const result = await service.save(input, req.headers["if-match"], input?.importId);
        send(res, 200, result, { ETag: result.revision });
      } else if (path === "/api/imports" && req.method === "GET") {
        send(res, 200, { imports: (await service.snapshot()).imports });
      } else if (path === "/api/imports" && req.method === "POST") {
        const result = await service.createImport(await readJson(req));
        send(res, result.created ? 201 : 200, result);
      } else if (path.startsWith("/api/imports/") && req.method === "DELETE") {
        send(res, 200, await service.deleteImport(path.slice("/api/imports/".length)));
      } else if (path === "/api/health" && req.method === "GET") {
        await service.snapshot();
        send(res, 200, { ok: true, storage: "file", version: 1 });
      } else {
        send(res, 404, { error: "接口或请求方法不存在" });
      }
    } catch (error) {
      if (!error.status) console.error("[kana-loop] library API:", error);
      send(res, error.status || 500, { error: error.status ? error.message : "无法读取或写入词库文件，请检查文件及服务日志" });
    }
    return true;
  };
}
