import { KANA_UNIT_ID, LIBRARY_VERSION, WORD_FIELDS, isBlankWord, validateUnit } from "./units.js";

export function validateLibrary(value) {
  if (!value || value.version !== LIBRARY_VERSION || !Array.isArray(value.units)) {
    throw new Error("词库格式应为 { version: 1, units: [...] }");
  }
  if (value.units.length > 1000) throw new Error("词库最多包含 1000 个单元");
  const ids = new Set([KANA_UNIT_ID]);
  const units = value.units.map((unit, index) => {
    if (!unit || typeof unit.id !== "string" || !/^[\w-]{1,128}$/.test(unit.id) || ids.has(unit.id)) {
      throw new Error(`第 ${index + 1} 个单元的 ID 无效或重复`);
    }
    if (typeof unit.name !== "string" || unit.kind !== "vocabulary" || !Array.isArray(unit.words) || unit.words.length > 5000) {
      throw new Error(`第 ${index + 1} 个单元的类型或单词列表无效`);
    }
    for (const word of unit.words) {
      if (!word || typeof word.id !== "string" || !/^[\w-]{1,128}$/.test(word.id) || isBlankWord(word)) {
        throw new Error(`「${unit.name}」包含无效的单词或 ID`);
      }
      if (WORD_FIELDS.some(({ key }) => !["string", "number"].includes(typeof word[key]))) {
        throw new Error(`「${unit.name}」的单词字段必须为文字或数字`);
      }
    }
    const result = validateUnit(unit);
    if (!result.valid) throw new Error(`「${unit.name}」：${result.message}`);
    ids.add(unit.id);
    return result.unit;
  });
  return { version: LIBRARY_VERSION, units };
}

export function toLibrary(units) {
  return validateLibrary({ version: LIBRARY_VERSION, units: units.filter((unit) => unit.id !== KANA_UNIT_ID) });
}
