import test from "node:test";
import assert from "node:assert/strict";
import { getValidationFields, getMaxAttempts, matchesValidationAnswer } from "../src/validation.js";

test("vocabulary accepts hiragana for a katakana word while preserving small kana and long vowels", () => {
  const field = getValidationFields({ direction: "meaningToJapanese" }, { kana: "コーヒー" })[0];
  assert.equal(getMaxAttempts(field), 3);
  assert.equal(matchesValidationAnswer("こーひー", field), true);
  assert.equal(matchesValidationAnswer(" ｺｰﾋｰ ", field), true);
  assert.equal(matchesValidationAnswer("こひ", field), false);
  assert.equal(matchesValidationAnswer("きや", { ...field, expected: "キャ" }), false);
  assert.equal(matchesValidationAnswer("がくせい", { ...field, expected: "がくせい" }), true);
});
