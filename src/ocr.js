const TESSERACT_VERSION = "7.0.0";
const LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0";
const CORE_PATH = `https://cdn.jsdelivr.net/npm/tesseract.js-core@v${TESSERACT_VERSION}`;
const WORKER_PATH = `https://cdn.jsdelivr.net/npm/tesseract.js@v${TESSERACT_VERSION}/dist/worker.min.js`;

let workerPromise;
let progressCallback;

function cleanResult(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[^\u3040-\u30ff]/g, "")
    .trim();
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = import("tesseract.js")
      .then(({ createWorker }) => createWorker("jpn", 1, {
        corePath: CORE_PATH,
        langPath: LANG_PATH,
        workerPath: WORKER_PATH,
        cacheMethod: "write",
        logger: (message) => progressCallback?.(message),
      }))
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

export async function recognizeKana(canvas, onProgress) {
  progressCallback = onProgress;
  const worker = await getWorker();
  const result = await worker.recognize(canvas);
  progressCallback = undefined;
  return {
    text: cleanResult(result.data.text),
    rawText: result.data.text,
    confidence: result.data.confidence,
  };
}

export function isOcrReady() {
  return Boolean(workerPromise);
}
