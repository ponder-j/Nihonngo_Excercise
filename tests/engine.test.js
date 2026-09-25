import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialProgress,
  getDailyStats,
  getMasteredCount,
  getRecentDays,
  getWeakItems,
  pickNextItem,
  pickPrompt,
  recordAnswer,
  updateWeight,
} from "../src/engine.js";
import { KANA_IDS, kanaItems } from "../src/kana.js";
import {
  getValidationFields,
  matchesValidationAnswer,
  normalizeRomaji,
} from "../src/validation.js";

test("kana set contains 71 unique entries", () => {
  assert.equal(kanaItems.length, 71);
  assert.equal(new Set(KANA_IDS).size, 71);
});

test("similar-sounding kana retain distinct keyboard romanization", () => {
  const byId = Object.fromEntries(kanaItems.map((item) => [item.id, item.romaji]));
  assert.equal(byId.zu, "zu");
  assert.equal(byId.du, "du");
  assert.equal(byId.ji, "ji");
  assert.equal(byId.di, "di");
});

test("known lowers weight and forgot raises it", () => {
  const lowered = updateWeight(1, "known");
  const raised = updateWeight(1, "forgot");
  assert.ok(lowered < 1);
  assert.ok(raised > 1);
});

test("recordAnswer updates item and daily statistics", () => {
  const progress = recordAnswer(createInitialProgress(), "a", "forgot", new Date(2026, 8, 17, 10));
  const today = getDailyStats(progress, new Date(2026, 8, 17, 12));
  assert.equal(today.answered, 1);
  assert.equal(today.forgot, 1);
  assert.equal(today.known, 0);
  assert.equal(today.forgotRate, 1);
  assert.equal(progress.totalAnswered, 1);
  assert.equal(progress.totalForgot, 1);
  assert.equal(progress.weights.a.forgot, 1);
});

test("recent days are ordered and include zero-fill days", () => {
  let progress = createInitialProgress();
  progress = recordAnswer(progress, "a", "known", new Date(2026, 8, 17));
  const days = getRecentDays(progress, 7, new Date(2026, 8, 17));
  assert.equal(days.length, 7);
  assert.equal(days[6].key, "2026-09-17");
  assert.equal(days[6].answered, 1);
  assert.equal(days[0].answered, 0);
});

test("selection favors higher weighted items", () => {
  let progress = createInitialProgress();
  for (let i = 0; i < 4; i += 1) {
    progress = recordAnswer(progress, "a", "forgot", new Date(2026, 8, 17));
  }
  progress = recordAnswer(progress, "i", "known", new Date(2026, 8, 17));

  let aCount = 0;
  let seed = 17;
  for (let i = 0; i < 5000; i += 1) {
    seed = (seed * 48271) % 2147483647;
    if (pickNextItem(progress, () => seed / 2147483647) === "a") aCount += 1;
  }
  assert.ok(aCount > 100, `expected "a" to be favored, got ${aCount}`);
});

test("weak items and mastery reflect progress", () => {
  let progress = createInitialProgress();
  progress = recordAnswer(progress, "a", "forgot");
  progress = recordAnswer(progress, "i", "known");
  progress = recordAnswer(progress, "i", "known");
  progress = recordAnswer(progress, "i", "known");
  assert.equal(getWeakItems(progress)[0].id, "a");
  assert.equal(getMasteredCount(progress), 1);
});

test("prompt picker returns an allowed mode", () => {
  assert.deepEqual(pickPrompt(() => 0.1), { direction: "kanaToRomaji", script: "hiragana" });
  assert.deepEqual(pickPrompt(() => 0.9), { direction: "romajiToKana", script: "katakana" });
});

test("validation fields require the complementary script and romaji", () => {
  const item = kanaItems.find((entry) => entry.id === "ka");
  assert.deepEqual(
    getValidationFields({ direction: "romajiToKana", script: "hiragana" }, item).map(({ id, kind, expected }) => ({ id, kind, expected })),
    [
      { id: "hiragana", kind: "handwriting", expected: "か" },
      { id: "katakana", kind: "handwriting", expected: "カ" },
    ],
  );
  assert.deepEqual(
    getValidationFields({ direction: "kanaToRomaji", script: "hiragana" }, item).map(({ id, kind, expected }) => ({ id, kind, expected })),
    [
      { id: "katakana", kind: "handwriting", expected: "カ" },
      { id: "romaji", kind: "romaji", expected: "ka" },
    ],
  );
});

test("validation normalizes keyboard input but keeps distinct romaji", () => {
  assert.equal(normalizeRomaji("  ZU  "), "zu");
  assert.equal(normalizeRomaji("づ"), "づ");
  const item = kanaItems.find((entry) => entry.id === "du");
  assert.equal(matchesValidationAnswer("du", { kind: "romaji", expected: item.romaji }), true);
  assert.equal(matchesValidationAnswer("zu", { kind: "romaji", expected: item.romaji }), false);
});
