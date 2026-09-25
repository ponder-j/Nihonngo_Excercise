const configuredApiUrl = import.meta.env.VITE_OCR_API_URL || "http://127.0.0.1:8124";
const OCR_API_URL = configuredApiUrl.replace(/\/$/, "");

export async function recognizeKana(canvas, onProgress) {
  onProgress?.({ status: "上传笔迹", progress: 0.1 });
  const response = await fetch(`${OCR_API_URL}/api/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: canvas.toDataURL("image/png") }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OCR server returned ${response.status}: ${detail}`);
  }

  onProgress?.({ status: "识别中", progress: 0.65 });
  const result = await response.json();
  onProgress?.({ status: "识别完成", progress: 1 });
  return result;
}

export function getOcrApiUrl() {
  return OCR_API_URL;
}
