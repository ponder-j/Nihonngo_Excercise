import { createServer } from "node:http";
import { createWorker } from "tesseract.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const host = process.env.OCR_HOST || "127.0.0.1";
const port = Number(process.env.OCR_PORT || 8124);
const modelDir = resolve(process.env.OCR_LANG_PATH || resolve(rootDir, "ocr-models"));
const allowedOrigins = new Set(
  (process.env.OCR_ALLOWED_ORIGINS || "http://127.0.0.1:5173,http://localhost:5173,https://ponder-j.github.io")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const maxBodyBytes = 2 * 1024 * 1024;
const maxRequestsPerMinute = 30;
const requestLog = new Map();

let workerPromise;
let activeJob = false;

function cleanResult(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[^\u3040-\u30ff]/g, "")
    .trim();
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function sendJson(req, res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...corsHeaders(req),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function enforceRateLimit(req) {
  const address = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (requestLog.get(address) || []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= maxRequestsPerMinute) return false;
  recent.push(now);
  requestLog.set(address, recent);
  return true;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("jpn", 1, {
      langPath: modelDir,
      cacheMethod: "none",
      logger: (message) => {
        if (message.status === "loading language traineddata") {
          console.log(`[kana-ocr] loading model ${Math.round((message.progress || 0) * 100)}%`);
        }
      },
    })
      .then(async (worker) => {
        await worker.setParameters({
          tessedit_pageseg_mode: "10",
          preserve_interword_spaces: "0",
        });
        return worker;
      })
      .catch((error) => {
        workerPromise = undefined;
        throw error;
      });
  }
  return workerPromise;
}

async function recognize(image) {
  const match = /^data:image\/(png|jpeg|jpg);base64,([a-zA-Z0-9+/=]+)$/.exec(image);
  if (!match) throw Object.assign(new Error("image must be a PNG or JPEG data URL"), { statusCode: 400 });
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 1_500_000) {
    throw Object.assign(new Error("image payload is empty or too large"), { statusCode: 413 });
  }

  if (activeJob) throw Object.assign(new Error("OCR worker is busy"), { statusCode: 429 });
  activeJob = true;
  try {
    const worker = await getWorker();
    const result = await worker.recognize(buffer);
    return {
      text: cleanResult(result.data.text),
      rawText: result.data.text,
      confidence: result.data.confidence,
    };
  } finally {
    activeJob = false;
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/healthz") {
    sendJson(req, res, 200, { ok: true, service: "kana-ocr" });
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/ocr") {
    sendJson(req, res, 404, { error: "not found" });
    return;
  }

  if (!enforceRateLimit(req)) {
    sendJson(req, res, 429, { error: "rate limit exceeded" });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const result = await recognize(body.image);
    sendJson(req, res, 200, result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    console.error(`[kana-ocr] ${error.message}`);
    sendJson(req, res, statusCode, { error: statusCode === 500 ? "OCR service failed" : error.message });
  }
});

server.requestTimeout = 45_000;
server.headersTimeout = 50_000;
server.listen(port, host, () => {
  console.log(`[kana-ocr] listening on http://${host}:${port}`);
  console.log(`[kana-ocr] model directory: ${modelDir}`);
});

function shutdown(signal) {
  console.log(`[kana-ocr] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
