import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createUnitManager } from "../src/unit-manager.js";
import { KANA_UNIT } from "../src/units.js";
import { createInitialProgress, recordAnswer } from "../src/engine.js";
import { loadProgress, loadUnits, saveProgress } from "../src/store.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const firstWord = { id: "word-1", japanese: "中国人", kana: "ちゅうごくじん", accent: 4, meaning: "中国人" };
const secondWord = { id: "word-2", japanese: "学生", kana: "がくせい", accent: 0, meaning: "学生" };
const lesson = { id: "lesson-1", kind: "vocabulary", name: "第一课 小李是个中国人", words: [firstWord, secondWord] };
let dom;
let units;
let manager;
let practiced;

beforeEach(() => {
  dom = new JSDOM(html, { url: "https://ponder-j.github.io/Nihonngo_Excercise/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const dialog = document.querySelector("#confirm-dialog");
  // jsdom has no rendering; model the standard dialog open/close state.
  dialog.showModal = () => dialog.setAttribute("open", "");
  dialog.close = () => dialog.removeAttribute("open");
  units = [KANA_UNIT, structuredClone(lesson)];
  practiced = null;
  manager = createUnitManager({
    getUnits: () => units,
    onChange: (next) => { units = next; },
    onPractice: (id) => { practiced = id; },
    showToast: () => {},
  });
  manager.open(lesson.id);
});

afterEach(() => dom.window.close());

function input(selector, value) {
  const element = document.querySelector(selector);
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
  return element;
}

function fillRow(index, word) {
  for (const field of ["japanese", "kana", "accent", "meaning"]) {
    input(`.word-row:nth-child(${index + 1}) [data-field="${field}"]`, String(word[field]));
  }
}

function pressEnter(element, options = {}) {
  element.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options }));
}

test("Enter confirms all four fields and focuses the next row without saving the whole library", () => {
  fillRow(2, { japanese: "先生", kana: "せんせい", accent: 3, meaning: "老师" });
  pressEnter(document.querySelector(".word-row:nth-child(3) [data-field='meaning']"));
  assert.equal(document.querySelectorAll(".word-row").length, 4);
  assert.equal(document.activeElement.getAttribute("aria-label"), "第 4 行日文");
  assert.equal(document.querySelector(".word-row:nth-child(3)").classList.contains("is-committed"), true);
  assert.equal(loadUnits().length, 1);
  document.querySelector("#save-unit-button").click();
  assert.equal(loadUnits()[1].words.length, 3);
});

test("Japanese IME confirmation and held Enter do not create or submit rows", () => {
  fillRow(2, { japanese: "先生", kana: "せんせい", accent: 3, meaning: "老师" });
  const field = document.querySelector(".word-row:nth-child(3) [data-field='meaning']");
  pressEnter(field, { isComposing: true });
  pressEnter(field, { keyCode: 229 });
  pressEnter(field, { repeat: true });
  assert.equal(document.querySelectorAll(".word-row").length, 3);
  assert.equal(loadUnits().length, 1);
  pressEnter(field);
  assert.equal(document.querySelectorAll(".word-row").length, 4);
});

test("final Save includes unconfirmed complete rows and rejects partial rows with focus on the missing field", () => {
  input(".word-row:nth-child(3) [data-field='japanese']", "先生");
  document.querySelector("#save-unit-button").click();
  assert.equal(loadUnits().length, 1);
  assert.equal(document.activeElement.getAttribute("aria-label"), "第 3 行假名拼写");
  assert.match(document.querySelector("#editor-status").textContent, /第 3 行/);
  fillRow(2, { japanese: "先生", kana: "せんせい", accent: 3, meaning: "老师" });
  document.querySelector("#save-unit-button").click();
  assert.equal(loadUnits()[1].words.length, 3);
  assert.equal(loadUnits()[1].words[0].id, firstWord.id);
  assert.equal(loadUnits()[1].words[1].accent, 0);
});

test("per-word deletion takes effect on Save and keeps the remaining word identity", () => {
  document.querySelector(".word-row .word-delete").click();
  assert.equal(document.querySelectorAll(".word-row").length, 2);
  assert.equal(document.querySelector(".word-row input").value, "学生");
  assert.equal(units[1].words.length, 2);
  document.querySelector("#save-unit-button").click();
  assert.deepEqual(loadUnits()[1].words, [secondWord]);
});

test("canceling leave preserves the draft, and confirming leave clears the dirty flag", async () => {
  input("#unit-name", "第一课 未保存名称");
  const canceled = manager.canLeave();
  assert.equal(document.querySelector("#confirm-dialog").open, true);
  document.querySelector("#confirm-cancel").click();
  assert.equal(await canceled, false);
  assert.equal(document.querySelector("#unit-name").value, "第一课 未保存名称");
  assert.equal(units[1].name, lesson.name);
  const discarded = manager.canLeave();
  document.querySelector("#confirm-accept").click();
  assert.equal(await discarded, true);
  assert.equal(await manager.canLeave(), true);
  manager.open(lesson.id);
  assert.equal(document.querySelector("#unit-name").value, lesson.name);
});

test("saving and practicing uses the edited unit, while built-in kana stays read-only", () => {
  input("#unit-name", "第一课 新名称");
  document.querySelector("#practice-unit-button").click();
  assert.equal(practiced, lesson.id);
  assert.equal(loadUnits()[1].name, "第一课 新名称");
  manager.open(KANA_UNIT.id);
  assert.equal(document.querySelector("#unit-form").hidden, true);
  assert.equal(document.querySelector("#delete-unit-button").hidden, true);
  assert.equal(document.querySelectorAll("#builtin-kana-grid span").length, 71);
});

test("empty units can be created, and deleting a unit removes only its own records", async () => {
  document.querySelector("#new-unit-button").click();
  await Promise.resolve();
  input("#unit-name", "第二课");
  document.querySelector("#save-unit-button").click();
  assert.equal(units.length, 3);
  assert.deepEqual(units[2].words, []);
  const createdId = units[2].id;
  saveProgress(recordAnswer(createInitialProgress(), "test", "known"), createdId);
  saveProgress(recordAnswer(createInitialProgress(), firstWord.id, "forgot"), lesson.id);
  document.querySelector("#delete-unit-button").click();
  document.querySelector("#confirm-cancel").click();
  await Promise.resolve();
  assert.equal(units.length, 3);
  document.querySelector("#delete-unit-button").click();
  document.querySelector("#confirm-accept").click();
  await Promise.resolve();
  assert.equal(units.length, 2);
  assert.equal(loadProgress(createdId, ["test"]).totalAnswered, 0);
  assert.equal(loadProgress(lesson.id, [firstWord.id]).totalForgot, 1);
  assert.equal(document.querySelector("#unit-form").hidden, true);
});

test("failed storage saves retain the draft and do not publish a partially saved course", (context) => {
  input("#unit-name", "必须保留的草稿");
  context.mock.method(window.Storage.prototype, "setItem", () => { throw new Error("quota exceeded"); });
  context.mock.method(console, "warn", () => {});
  document.querySelector("#save-unit-button").click();
  assert.equal(document.querySelector("#unit-name").value, "必须保留的草稿");
  assert.equal(units[1].name, lesson.name);
  assert.match(document.querySelector("#editor-status").textContent, /保存失败/);
  const unload = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);
});
