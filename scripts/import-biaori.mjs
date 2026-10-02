import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLibraryService } from "../lib/library-service.mjs";
import { validateLibrary } from "../src/library-format.js";
import { convertBiaoriLessons } from "./biaori-converter.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(process.argv.find((arg, index) => index > 1 && !arg.startsWith("--")) || resolve(rootDir, "../biaori/words.json"));
const dryRun = process.argv.includes("--dry-run");
const rows = JSON.parse(await readFile(sourcePath, "utf8"));
const { units, review } = convertBiaoriLessons(rows);
const service = createLibraryService({ rootDir });
const { library, revision } = await service.snapshot();
const existingIds = new Set(library.units.map((unit) => unit.id));
const added = units.filter((unit) => !existingIds.has(unit.id));
const next = validateLibrary({ version: 1, units: [...library.units, ...added] });
const pendingReadings = added.flatMap((unit) => unit.words).filter((word) => word.kana === "待校对").length;
const pendingMeanings = added.flatMap((unit) => unit.words).filter((word) => word.meaning === "待校对").length;

console.log(`源数据：${units.length} 课；新增：${added.length} 课、${added.reduce((sum, unit) => sum + unit.words.length, 0)} 条；已存在：${units.length - added.length} 课。`);
console.log(`其中 ${pendingReadings} 条读音、${pendingMeanings} 条释义需补全；所有新词声调均为“待校对”。`);
if (!dryRun && added.length) {
  await service.save(next, revision);
  const reportPath = resolve(rootDir, ".local-data/biaori-import-review.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ source: sourcePath, importedUnits: added.map((unit) => unit.id), review }, null, 2)}\n`, "utf8");
  console.log(`待重点核对条目：${reportPath}`);
}
