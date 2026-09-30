import { kanaItems } from "./kana.js";

export const KANA_UNIT_ID = "kana";
export const LIBRARY_VERSION = 1;
export const KANA_UNIT = Object.freeze({
  id: KANA_UNIT_ID,
  name: "假名练习单元",
  kind: "kana",
});

export const WORD_FIELDS = [
  { key: "japanese", label: "日文", placeholder: "中国人", lang: "ja" },
  { key: "kana", label: "假名拼写", placeholder: "ちゅうごくじん", lang: "ja" },
  { key: "accent", label: "声调类型", placeholder: "0", inputMode: "numeric" },
  { key: "meaning", label: "中文释义", placeholder: "中国人", lang: "zh-CN" },
];

export function createId(prefix) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

export function getUnitItems(unit) {
  return unit.kind === "kana" ? kanaItems : unit.words;
}

export function isBlankWord(word) {
  return WORD_FIELDS.every(({ key }) => String(word[key] ?? "").trim() === "");
}

export function validateWord(word) {
  const normalized = Object.fromEntries(WORD_FIELDS.map(({ key }) => [key, String(word[key] ?? "").trim()]));
  for (const { key, label } of WORD_FIELDS) {
    if (!normalized[key]) return { valid: false, field: key, message: `请填写${label}` };
  }
  normalized.accent = normalized.accent.normalize("NFKC");
  if (!/^\d+$/.test(normalized.accent) || !Number.isSafeInteger(Number(normalized.accent))) {
    return { valid: false, field: "accent", message: "声调类型请填写 0、1、2 等非负整数" };
  }
  if (!/^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u.test(normalized.kana)) {
    return { valid: false, field: "kana", message: "假名拼写请使用平假名或片假名" };
  }
  return { valid: true, word: { id: word.id || createId("word"), ...normalized, accent: Number(normalized.accent) } };
}

export function validateUnit(unit) {
  const name = String(unit.name ?? "").trim();
  if (!name) return { valid: false, field: "name", message: "请填写单元 / 课程名称" };
  const words = [];
  const ids = new Set();
  for (const [index, word] of unit.words.entries()) {
    if (isBlankWord(word)) continue;
    const result = validateWord(word);
    if (!result.valid) return { ...result, row: index, message: `第 ${index + 1} 行：${result.message}` };
    if (ids.has(result.word.id)) return { valid: false, row: index, message: "单词 ID 重复，请重新添加这一行" };
    ids.add(result.word.id);
    words.push(result.word);
  }
  return { valid: true, unit: { id: unit.id, name, kind: "vocabulary", words } };
}

export function normalizeLibrary(value) {
  if (!value || value.version !== LIBRARY_VERSION || !Array.isArray(value.units)) return [KANA_UNIT];
  const units = [KANA_UNIT];
  const ids = new Set([KANA_UNIT_ID]);
  for (const unit of value.units) {
    if (!unit || typeof unit.id !== "string" || !unit.id || ids.has(unit.id) || !Array.isArray(unit.words)) continue;
    // Do not silently drop malformed words from a saved course.
    if (unit.words.some((word) => !word || typeof word.id !== "string" || !word.id || isBlankWord(word))) continue;
    const result = validateUnit(unit);
    if (!result.valid) continue;
    ids.add(unit.id);
    units.push(result.unit);
  }
  return units;
}
