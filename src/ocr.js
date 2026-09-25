const configuredApiUrl = import.meta.env.VITE_OCR_API_URL || "http://127.0.0.1:8124";
const OCR_API_URL = configuredApiUrl.replace(/\/$/, "");
const OCR_TIMEOUT_MS = 45_000;

export class OcrError extends Error {
  constructor(message, { code = "unknown", status = 0, detail = "" } = {}) {
    super(message);
    this.name = "OcrError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export async function recognizeKana(canvas, onProgress) {
  onProgress?.({ status: "连接 OCR 服务", progress: 0.1 });
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${OCR_API_URL}/api/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: canvas.toDataURL("image/png") }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new OcrError("OCR 服务连接超时", { code: "timeout" });
    }
    throw new OcrError("无法连接 OCR 服务", { code: "network", detail: error?.message });
  } finally {
    window.clearTimeout(timeoutId);
  }

  let payload = null;
  const responseText = await response.text();
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    // Keep the raw response in the error detail below.
  }

  if (!response.ok) {
    throw new OcrError(`OCR 服务请求失败（HTTP ${response.status}）`, {
      code: "http",
      status: response.status,
      detail: payload?.error || responseText,
    });
  }

  onProgress?.({ status: "识别中", progress: 0.65 });
  onProgress?.({ status: "识别完成", progress: 1 });
  return payload ?? { text: "", rawText: "", confidence: 0 };
}

export function getOcrApiUrl() {
  return OCR_API_URL;
}
