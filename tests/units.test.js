import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInitialProgress, getMasteredCount, getWeakItems, normalizeProgress, pickNextItem, recordAnswer } from "../src/engine.js";
import { KANA_UNIT, REVIEW_PLACEHOLDER, formatAccent, getUnitItems, isBlankWord, isPracticeReady, normalizeLibrary, validateUnit, validateWord } from "../src/units.js";
import {
  clearProgress, loadActiveUnit, loadPracticeSettings, loadProgress, loadSequentialProgress, loadUnits,
  saveActiveUnit, savePracticeSettings, saveProgress, saveSequentialProgress, saveUnits,
} from "../src/store.js";

const word = { id: "word-china", japanese: "中国人", kana: "ちゅうごくじん", accent: 4, meaning: "中国人" };
const lesson = { id: "lesson-1", name: "第一课 小李是个中国人", kind: "vocabulary", words: [word] };
let storage;

beforeEach(() => {
  storage = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  } };
});

test("built-in kana unit exposes the existing 71 items", () => {
  assert.equal(getUnitItems(KANA_UNIT).length, 71);
  assert.equal(getUnitItems(lesson)[0], word);
  assert.deepEqual(loadUnits(), [KANA_UNIT]);
});

test("word validation keeps zero accent, trims fields and accepts full-width digits", () => {
  const result = validateWord({ ...word, japanese: " 中国人 ", accent: "０", meaning: " 中国人 " });
  assert.equal(result.valid, true);
  assert.deepEqual(result.word, { ...word, accent: 0 });
  assert.equal(isBlankWord({ accent: 0 }), false);
  assert.equal(validateWord({ ...word, japanese: "こんにちは", kana: "こんにちは", accent: 0 }).valid, true);
  assert.equal(validateWord({ ...word, japanese: "コーヒー", kana: "コーヒー", accent: 3 }).valid, true);
});

test("unknown accent remains an explicit placeholder and missing readings stay out of practice", () => {
  const pending = { ...word, accent: REVIEW_PLACEHOLDER };
  assert.equal(validateWord(pending).word.accent, REVIEW_PLACEHOLDER);
  assert.equal(formatAccent(REVIEW_PLACEHOLDER), REVIEW_PLACEHOLDER);
  assert.equal(formatAccent(0), "0 型");
  assert.equal(isPracticeReady(pending), true);
  assert.equal(isPracticeReady({ ...pending, kana: REVIEW_PLACEHOLDER }), false);
  assert.equal(isPracticeReady({ ...pending, meaning: REVIEW_PLACEHOLDER }), false);
  assert.equal(validateWord({ ...pending, kana: REVIEW_PLACEHOLDER }).valid, true);
  assert.equal(validateUnit({ id: "pending", name: "待校对", words: [pending] }).valid, true);
});

test("incomplete words and invalid accent or kana are rejected before saving", () => {
  assert.equal(validateWord({ ...word, meaning: " " }).field, "meaning");
  assert.equal(validateWord({ ...word, kana: "中国人" }).field, "kana");
  for (const accent of ["", "-1", "1.5", "two", "Infinity", "9007199254740992"]) {
    assert.equal(validateWord({ ...word, accent }).valid, false, `accepted ${accent}`);
  }
});

test("saving ignores the trailing empty row but rejects any partial row", () => {
  assert.deepEqual(validateUnit({ ...lesson, words: [word, {}] }).unit, lesson);
  const partial = validateUnit({ ...lesson, words: [word, { japanese: "学生" }] });
  assert.equal(partial.valid, false);
  assert.equal(partial.row, 1);
  assert.match(partial.message, /第 2 行/);
  assert.equal(validateUnit({ ...lesson, name: " " }).valid, false);
  assert.equal(validateUnit({ ...lesson, words: [] }).valid, true);
});

test("stable word IDs survive editing and storage reload", () => {
  const edited = { ...lesson, words: [{ ...word, meaning: "中国籍的人" }] };
  assert.equal(saveUnits([KANA_UNIT, edited]), true);
  assert.deepEqual(loadUnits(), [KANA_UNIT, edited]);
  saveActiveUnit(edited.id);
  assert.equal(loadActiveUnit(), edited.id);
});

test("library rejects duplicate identities and malformed courses", (context) => {
  const value = { version: 1, units: [lesson, lesson, { ...lesson, id: "broken", words: [null] }, { ...lesson, id: "duplicate", words: [word, word] }] };
  assert.deepEqual(normalizeLibrary(value), [KANA_UNIT, lesson]);
  storage.set("kana-loop-units-v1", "{broken");
  context.mock.method(console, "warn", () => {});
  assert.deepEqual(loadUnits(), [KANA_UNIT]);
});

test("custom cards are selected only from their unit and avoid consecutive repeats", () => {
  let progress = createInitialProgress();
  progress = recordAnswer(progress, "deleted-word", "forgot");
  progress = recordAnswer(progress, "one", "known");
  for (const random of [0, 0.3, 0.9]) {
    assert.equal(pickNextItem(progress, () => random, ["one", "two"]), "two");
  }
  assert.equal(pickNextItem(progress, () => 0, ["one"]), "one");
  assert.equal(pickNextItem(progress, () => 0, []), null);
  const normalized = normalizeProgress(progress, ["one", "two"]);
  assert.deepEqual(normalized.recent, ["one"]);
  assert.deepEqual(normalized.review, {});
});

test("custom weights favor forgotten cards and scoped mastery ignores deleted words", () => {
  let progress = createInitialProgress();
  for (let i = 0; i < 4; i += 1) progress = recordAnswer(progress, "weak", "forgot");
  for (let i = 0; i < 3; i += 1) progress = recordAnswer(progress, "mastered", "known");
  assert.equal(getWeakItems(progress, 5, ["weak", "mastered"])[0].id, "weak");
  assert.equal(getWeakItems(progress, 5, ["mastered"]).length, 0);
  assert.equal(getMasteredCount(progress, ["mastered"]), 1);
  assert.equal(getMasteredCount(progress, ["weak"]), 0);
  const counts = { weak: 0, mastered: 0 };
  let seed = 43;
  for (let i = 0; i < 1000; i += 1) {
    seed = (seed * 48271) % 2147483647;
    counts[pickNextItem({ ...progress, recent: [] }, () => seed / 2147483647, ["weak", "mastered"])] += 1;
  }
  assert.ok(counts.weak > counts.mastered * 5);
});

test("legacy kana records and course records stay isolated when saving and resetting", () => {
  const kana = recordAnswer(createInitialProgress(), "a", "known");
  storage.set("kana-loop-progress-v1", JSON.stringify(kana));
  assert.equal(loadProgress().totalAnswered, 1);
  const vocabulary = recordAnswer(createInitialProgress(), word.id, "forgot");
  saveProgress(vocabulary, lesson.id);
  saveUnits([KANA_UNIT, lesson]);
  assert.equal(loadProgress(lesson.id, [word.id]).totalForgot, 1);
  assert.deepEqual(loadProgress(lesson.id, [word.id]).recent, [word.id]);
  assert.equal(loadProgress("lesson-2", [word.id]).totalAnswered, 0);
  assert.equal(loadProgress().totalForgot, 0);
  assert.equal(clearProgress(lesson.id), true);
  assert.equal(loadProgress(lesson.id, [word.id]).totalAnswered, 0);
  assert.equal(loadProgress().totalAnswered, 1);
  assert.equal(loadUnits()[1].words.length, 1);
});

test("failed storage writes are reported so the editor can retain its draft", (context) => {
  context.mock.method(console, "warn", () => {});
  window.localStorage.setItem = () => { throw new Error("quota exceeded"); };
  assert.equal(saveUnits([KANA_UNIT, lesson]), false);
  assert.equal(saveProgress(createInitialProgress(), lesson.id), false);
  assert.equal(saveSequentialProgress(lesson.id, { [word.id]: "known" }), false);
  assert.equal(savePracticeSettings({ validationMode: true, order: "sequential", reviewMode: false }), false);
});

test("sequential progress is isolated by unit and review; clearing learning data removes only that unit's passes", () => {
  saveSequentialProgress(lesson.id, { [word.id]: "known" });
  saveSequentialProgress(lesson.id, { [word.id]: "forgot" }, true);
  saveSequentialProgress("lesson-2", { second: "known" });
  assert.deepEqual(loadSequentialProgress(lesson.id), { [word.id]: "known" });
  assert.deepEqual(loadSequentialProgress(lesson.id, true), { [word.id]: "forgot" });
  clearProgress(lesson.id);
  assert.deepEqual(loadSequentialProgress(lesson.id), {});
  assert.deepEqual(loadSequentialProgress(lesson.id, true), {});
  assert.deepEqual(loadSequentialProgress("lesson-2"), { second: "known" });
});

test("malformed sequential progress and settings fall back safely", (context) => {
  context.mock.method(console, "warn", () => {});
  for (const invalid of ["invalid JSON", "null", '{"version":2,"results":{}}', '{"version":1,"results":[]}']) {
    storage.set(`kana-loop-sequence-v1:${lesson.id}:practice`, invalid);
    assert.deepEqual(loadSequentialProgress(lesson.id), {});
  }
  storage.set(`kana-loop-sequence-v1:${lesson.id}:practice`, '{"version":1,"results":{"one":"known","two":"forgot","bad":"unknown"}}');
  assert.deepEqual(loadSequentialProgress(lesson.id), { one: "known", two: "forgot" });
  storage.set("kana-loop-practice-settings-v1", "invalid JSON");
  assert.deepEqual(loadPracticeSettings(), { validationMode: false, order: "random", reviewMode: false });
  savePracticeSettings({ validationMode: true, order: "sequential", reviewMode: true });
  assert.deepEqual(loadPracticeSettings(), { validationMode: true, order: "sequential", reviewMode: true });
});
