import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createLibraryService } from "./lib/library-service.mjs";
import { createLibraryApi } from "./lib/library-api.mjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(rootDir, "dist");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 1234);
const libraryService = createLibraryService({
  rootDir,
  ...(process.env.LIBRARY_FILE ? { dataFile: resolve(process.env.LIBRARY_FILE) } : {}),
  ...(process.env.LIBRARY_STATE_DIR ? { stateDir: resolve(process.env.LIBRARY_STATE_DIR) } : {}),
});
const libraryApi = createLibraryApi(libraryService);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function resolveRequestPath(rawUrl) {
  const url = new URL(rawUrl, `http://${host}:${port}`);
  let pathname;

  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(distDir, `.${requestedPath}`);
  const insideDist = filePath === distDir || filePath.startsWith(`${distDir}${sep}`);

  return insideDist ? filePath : null;
}

const server = createServer(async (req, res) => {
  if (await libraryApi(req, res)) return;
  if (req.url?.split("?")[0] === "/data/units.json" && (req.method === "GET" || req.method === "HEAD")) {
    try {
      const { library } = await libraryService.snapshot();
      send(res, 200, req.method === "HEAD" ? "" : JSON.stringify(library), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    } catch {
      send(res, 500, "Unable to read library");
    }
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
    return;
  }

  let filePath = resolveRequestPath(req.url || "/");
  if (!filePath) {
    send(res, 400, "Bad Request");
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    if (extname(filePath) && extname(filePath) !== ".html") {
      send(res, 404, "Not Found");
      return;
    }
    filePath = resolve(distDir, "index.html");
  }

  if (!existsSync(filePath)) {
    send(res, 503, "Build the site with npm run build first");
    return;
  }

  const extension = extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": mimeTypes[extension] || "application/octet-stream",
    "Cache-Control": extension === ".html"
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  };

  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath)
    .on("error", () => {
      if (!res.headersSent) send(res, 500, "Internal Server Error");
      else res.destroy();
    })
    .pipe(res);
});

server.on("error", (error) => {
  console.error(`[kana-loop] ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`[kana-loop] serving ${distDir} at http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`[kana-loop] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
