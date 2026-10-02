import { REVIEW_PLACEHOLDER } from "../src/units.js";

const LEVELS = ["初级", "中级", "高级"];
const SUPERSCRIPT = /<span\s+superscript=['"]([^'"]+)['"]\s*>(.*?)<\/span>/gu;
const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・]+$/u;

function stripSourceMarkup(value) {
  return value.replace(SUPERSCRIPT, (_, _reading, written) => written).replace(/<[^>]+>/gu, "").trim();
}

function readKana(value) {
  const annotated = value.replace(SUPERSCRIPT, (_, reading) => reading);
  const first = annotated.split(/[（(／/〳]/u, 1)[0]
    .replace(/(?:\[[^\]]+\]|［[^］]+］)$/u, "")
    .replace(/[～〜\s]/gu, "")
    .replaceAll("·", "・")
    .trim();
  if (KANA_ONLY.test(first)) return first;

  // A few suffixes are written as ～弁(べん), with the reading after the kanji.
  const suffixReading = value.match(/^[^（(]+[（(]([\p{Script=Hiragana}\p{Script=Katakana}ー・]+)[）)]/u)?.[1];
  return suffixReading && KANA_ONLY.test(suffixReading) ? suffixReading : REVIEW_PLACEHOLDER;
}

function readJapanese(value) {
  const plain = stripSourceMarkup(value);
  const simple = plain.match(/^([\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+)[（(]([^（）()]+)[）)]$/u);
  if (simple && /\p{Script=Han}/u.test(simple[2]) && !/[～〜／/]/u.test(simple[2])) return simple[2].trim();
  return plain;
}

export function convertBiaoriWord(row, sourceIndex) {
  if (!Array.isArray(row) || row.length !== 5 || !Number.isInteger(row[0]) || typeof row[3] !== "string") {
    throw new Error(`biaori 第 ${sourceIndex + 1} 行格式无效`);
  }
  const sourceJapanese = row[3].trim();
  const word = {
    id: `word-biaori-${sourceIndex}`,
    japanese: readJapanese(sourceJapanese),
    kana: readKana(sourceJapanese),
    accent: REVIEW_PLACEHOLDER,
    meaning: row[2]?.trim() && row[2].trim() !== "/" ? row[2].trim() : REVIEW_PLACEHOLDER,
  };
  const flags = [];
  if (word.kana === REVIEW_PLACEHOLDER) flags.push("读音待校对，暂不参与练习");
  if (word.meaning === REVIEW_PLACEHOLDER) flags.push("中文释义待校对，暂不参与练习");
  if (/[／/〳]/u.test(sourceJapanese)) flags.push("源词条有多种写法，请核对首个读音");
  if (/<span/u.test(sourceJapanese)) flags.push("源词条带注音标记，请核对转换结果");
  if (word.japanese.includes("(") || word.japanese.includes("（")) flags.push("日文保留了源词条的括号写法");
  return { word, flags };
}

export function convertBiaoriLessons(rows) {
  if (!Array.isArray(rows)) throw new Error("biaori 数据应为词条数组");
  const units = new Map();
  const review = [];
  for (const [sourceIndex, row] of rows.entries()) {
    const code = row?.[0];
    if (code === 0) continue; // Preserve the user's already imported first lesson.
    if (!Number.isInteger(code) || code < 0) throw new Error(`biaori 第 ${sourceIndex + 1} 行课程编号无效`);
    const book = Math.floor(code / 10000) + 1;
    const lesson = code % 100 + 1;
    if (!LEVELS[book - 1] || lesson < 1 || lesson > 48) throw new Error(`biaori 第 ${sourceIndex + 1} 行课程编号无效`);
    const id = `unit-biaori-b${book}-l${lesson}`;
    if (!units.has(id)) units.set(id, {
      id,
      name: `标日${LEVELS[book - 1]} 第${lesson}课`,
      kind: "vocabulary",
      words: [],
    });
    const { word, flags } = convertBiaoriWord(row, sourceIndex);
    units.get(id).words.push(word);
    if (flags.length) review.push({ unitId: id, wordId: word.id, sourceIndex, source: row[3], converted: word, flags });
  }
  return { units: [...units.values()], review };
}
