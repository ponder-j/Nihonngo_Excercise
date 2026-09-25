export const MAX_HANDWRITING_ATTEMPTS = 5;
export const MAX_ROMAJI_ATTEMPTS = 1;

export function getValidationFields({ direction, script }, item) {
  if (direction === "romajiToKana") {
    return [
      { id: "hiragana", label: "平假名", kind: "handwriting", expected: item.hiragana },
      { id: "katakana", label: "片假名", kind: "handwriting", expected: item.katakana },
    ];
  }

  return [
    {
      id: script === "hiragana" ? "katakana" : "hiragana",
      label: script === "hiragana" ? "片假名" : "平假名",
      kind: "handwriting",
      expected: script === "hiragana" ? item.katakana : item.hiragana,
    },
    { id: "romaji", label: "罗马音", kind: "romaji", expected: item.romaji },
  ];
}

export function normalizeRomaji(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function normalizeKana(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s\n\r]/g, "");
}

export function matchesValidationAnswer(value, field) {
  const normalized = field.kind === "romaji" ? normalizeRomaji(value) : normalizeKana(value);
  return normalized === field.expected;
}
