import test, { before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import { build } from "vite";

const word = { id: "word-1", japanese: "中国人", kana: "ちゅうごくじん", accent: 4, meaning: "中国人" };
const lesson = { id: "lesson-1", name: "第一课", kind: "vocabulary", words: [word] };
const secondWord = { id: "word-2", japanese: "学生", kana: "がくせい", accent: 0, meaning: "学生" };
const thirdWord = { id: "word-3", japanese: "先生", kana: "せんせい", accent: 3, meaning: "老师" };
const settle = () => new Promise((resolve) => setImmediate(resolve));
let code, html, dom, doc, snapshot, requests, audioClips, keyTime;

before(async () => {
  html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const output = await build({ logLevel: "silent", build: { write: false, emptyOutDir: false } });
  code = output.output.find((item) => item.type === "chunk" && item.isEntry).code;
});
beforeEach(async () => {
  dom = new JSDOM(html, { url: "http://127.0.0.1:1234", runScripts: "outside-only", pretendToBeVisual: true });
  doc = dom.window.document;
  snapshot = { library: { version: 1, units: [structuredClone(lesson)] }, revision: '"v1"', imports: [] };
  requests = [];
  audioClips = [];
  keyTime = 0;
  dom.window.Audio = function (src) {
    const audio = doc.createElement("audio");
    if (src) audio.src = src;
    audio.pauseCalls = 0;
    audio.play = async () => audio.dispatchEvent(new dom.window.Event("playing"));
    audio.pause = () => { audio.pauseCalls += 1; };
    audio.load = () => {};
    audioClips.push(audio);
    return audio;
  };
  Object.defineProperty(dom.window.crypto, "randomUUID", { value: randomUUID });
  dom.window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === "PUT") {
      const payload = JSON.parse(options.body);
      snapshot.library = { version: 1, units: payload.units };
      snapshot.revision = '"v2"';
      if (payload.importId) snapshot.imports = snapshot.imports.filter((draft) => draft.id !== payload.importId);
    }
    return { ok: true, json: async () => structuredClone(snapshot) };
  };
  dom.window.eval(code);
  await settle();
  doc.querySelector("#unit-select-trigger").click();
  [...doc.querySelectorAll("[role='option']")].find((option) => option.textContent === lesson.name).click();
});
afterEach(() => dom.window.close());

function validationOn() {
  const toggle = doc.querySelector("#validation-mode");
  toggle.checked = true;
  toggle.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
async function submit(value) {
  doc.querySelector(".validation-field input").value = value;
  doc.querySelector(".button-check").click();
  await settle();
}
function progress() {
  return JSON.parse(dom.window.localStorage.getItem("kana-loop-unit-progress-v1:lesson-1"));
}
function press(key, { target = doc.activeElement, elapsed = 100, ...options } = {}) {
  const event = new dom.window.KeyboardEvent("keydown", {
    key, code: key === " " ? "Space" : key, bubbles: true, cancelable: true, ...options,
  });
  keyTime += elapsed;
  Object.defineProperty(event, "timeStamp", { value: keyTime });
  target.dispatchEvent(event);
  return event;
}

async function useLibrary(units) {
  snapshot.library.units = structuredClone(units);
  doc.querySelector("#manage-nav").click();
  await settle();
  doc.querySelector("#practice-nav").click();
  await settle();
}

function chooseOrder(value) {
  doc.querySelector(`#practice-order input[value='${value}']`).click();
}

test("practice order can only be selected after validation is enabled", () => {
  const group = doc.querySelector("#practice-order");
  assert.equal(group.disabled, true);
  chooseOrder("sequential");
  assert.equal(group.querySelector("input:checked").value, "random");
  validationOn();
  assert.equal(group.disabled, false);
  chooseOrder("sequential");
  assert.equal(doc.querySelector("#sequence-status").textContent, "已完成 0 / 1");
  const toggle = doc.querySelector("#validation-mode");
  toggle.checked = false;
  toggle.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(group.disabled, true);
  assert.equal(group.querySelector("input:checked").value, "random");
  assert.equal(doc.querySelector("#sequence-progress").hidden, true);
  validationOn();
  assert.equal(group.querySelector("input:checked").value, "random");
});

test("sequential validation visits each ready word once, counts skips and failures, and stops at the result", async () => {
  const pending = { ...secondWord, id: "word-pending", kana: "待校对" };
  await useLibrary([{ ...lesson, words: [word, pending, secondWord, thirdWord] }]);
  dom.window.Math.random = () => 0.99;
  validationOn();
  chooseOrder("sequential");
  assert.equal(doc.querySelector("#prompt").textContent, word.meaning);
  assert.equal(doc.querySelector("#sequence-status").textContent, "已完成 0 / 3");
  await submit("あ");
  assert.equal(doc.querySelector("#sequence-progress").value, 0);
  await submit(word.kana);
  assert.equal(doc.querySelector("#sequence-progress").value, 1);
  press("Enter");
  assert.equal(doc.querySelector("#prompt").textContent, secondWord.meaning);
  press(" ");
  press(" ");
  assert.equal(doc.querySelector("#sequence-progress").value, 2);
  press("Enter");
  assert.equal(doc.querySelector("#prompt").textContent, thirdWord.meaning);
  await submit("あ");
  await submit("い");
  await submit("う");
  assert.equal(doc.querySelector(".validation-next").textContent, "查看本轮结果");
  assert.equal(doc.querySelector("#sequence-progress").value, 3);
  assert.equal(progress().totalAnswered, 3);
  assert.equal(progress().totalForgot, 2);
  press("Enter");
  assert.equal(doc.querySelector("#prompt").textContent, "本轮检验完成");
  assert.equal(doc.querySelector("#empty-unit-button").hidden, true);
  assert.equal(doc.querySelector("#validation-area").hidden, true);
  assert.equal(doc.querySelector("#prompt-hint").textContent, "共 3 题，答对 1 题，未答对或跳过 2 题。");
  for (const entry of [word, secondWord, thirdWord]) assert.equal(progress().weights[entry.id].seen, 1);
  assert.equal(progress().weights[pending.id], undefined);
  doc.querySelector("#restart-sequence-button").click();
  assert.equal(doc.querySelector("#prompt").textContent, word.meaning);
  assert.equal(doc.querySelector("#sequence-status").textContent, "已完成 0 / 3");
  assert.equal(progress().totalAnswered, 3);
});

test("switching back to random preserves weighted selection and starts a new sequence from the beginning", async () => {
  await useLibrary([{ ...lesson, words: [word, secondWord, thirdWord] }]);
  dom.window.Math.random = () => 0.99;
  validationOn();
  chooseOrder("sequential");
  assert.equal(doc.querySelector("#prompt").textContent, word.meaning);
  await submit(word.kana);
  chooseOrder("random");
  assert.equal(doc.querySelector("#prompt").textContent, thirdWord.meaning);
  assert.equal(doc.querySelector("#sequence-status").hidden, true);
  assert.equal(doc.querySelector("#answer-panel").hidden, true);
  assert.equal(progress().totalAnswered, 1);
  chooseOrder("sequential");
  assert.equal(doc.querySelector("#prompt").textContent, word.meaning);
  assert.equal(doc.querySelector("#sequence-status").textContent, "已完成 0 / 3");
});

test("the completed pass ignores held Enter and can return to random without recording another answer", async () => {
  validationOn();
  chooseOrder("sequential");
  await submit(word.kana);
  press("Enter");
  const restart = doc.querySelector("#restart-sequence-button");
  assert.equal(doc.activeElement, restart);
  assert.equal(press("Enter", { repeat: true }).defaultPrevented, true);
  assert.equal(doc.querySelector("#prompt").textContent, "本轮检验完成");
  [...doc.querySelectorAll("#reveal-actions button")].find((button) => button.textContent === "切换随机模式").click();
  assert.equal(doc.querySelector("#practice-order input:checked").value, "random");
  assert.equal(doc.querySelector("#sequence-progress").hidden, true);
  assert.equal(doc.querySelector("#prompt").textContent, word.meaning);
  assert.equal(progress().totalAnswered, 1);
});

test("changing units resets sequential progress and an empty unit stays an empty unit", async () => {
  const nextLesson = { id: "lesson-2", name: "第二课", kind: "vocabulary", words: [thirdWord] };
  const empty = { id: "lesson-empty", name: "空单元", kind: "vocabulary", words: [] };
  await useLibrary([{ ...lesson, words: [word, secondWord] }, nextLesson, empty]);
  validationOn();
  chooseOrder("sequential");
  await submit(word.kana);
  doc.querySelector("#unit-select-trigger").click();
  [...doc.querySelectorAll("[role='option']")].find((option) => option.textContent === nextLesson.name).click();
  assert.equal(doc.querySelector("#prompt").textContent, thirdWord.meaning);
  assert.equal(doc.querySelector("#sequence-status").textContent, "已完成 0 / 1");
  doc.querySelector("#unit-select-trigger").click();
  [...doc.querySelectorAll("[role='option']")].find((option) => option.textContent === empty.name).click();
  assert.equal(doc.querySelector("#empty-unit-button").hidden, false);
  assert.equal(doc.querySelector("#restart-sequence-button"), null);
  assert.equal(doc.querySelector("#sequence-status").textContent, "已完成 0 / 0");
});

test("sequential review keeps a stable ordered pass when correct answers remove review items", async () => {
  await useLibrary([{ ...lesson, words: [word, secondWord, thirdWord] }]);
  dom.window.localStorage.setItem("kana-loop-unit-progress-v1:lesson-1", JSON.stringify({
    version: 1, review: { [word.id]: { correct: 1 }, [thirdWord.id]: { correct: 1 } },
  }));
  await useLibrary([{ ...lesson, words: [word, secondWord, thirdWord] }]);
  validationOn();
  doc.querySelector("#review-toggle").click();
  chooseOrder("sequential");
  assert.equal(doc.querySelector("#prompt").textContent, word.meaning);
  assert.equal(doc.querySelector("#sequence-progress").max, 2);
  await submit(word.kana);
  assert.equal(progress().review[word.id], undefined);
  press("Enter");
  assert.equal(doc.querySelector("#prompt").textContent, thirdWord.meaning);
  await submit(thirdWord.kana);
  press("Enter");
  assert.equal(doc.querySelector("#prompt").textContent, "本轮检验完成");
  assert.equal(progress().totalAnswered, 2);
  assert.deepEqual(progress().review, {});
});

test("Enter checks vocabulary, then a separate Enter advances once and focuses the next input", () => {
  validationOn();
  const input = doc.querySelector(".validation-field input");
  assert.equal(doc.activeElement, input);
  input.value = word.kana;
  assert.equal(press("Enter").defaultPrevented, true);
  assert.equal(progress().totalAnswered, 1);
  assert.equal(progress().totalForgot, 0);
  const next = doc.querySelector(".validation-next");
  assert.equal(doc.activeElement, next);
  assert.equal(press("Enter", { repeat: true }).defaultPrevented, true);
  press("Enter", { isComposing: true });
  press("Enter", { keyCode: 229 });
  assert.equal(doc.querySelector(".validation-next"), next);
  press("Enter");
  const nextInput = doc.querySelector(".validation-field input");
  assert.notEqual(nextInput, input);
  assert.equal(doc.activeElement, nextInput);
  assert.equal(doc.querySelector(".validation-next"), null);
  assert.equal(progress().totalAnswered, 1);
});

test("wrong and blank Enter submissions stay on the current vocabulary question", () => {
  validationOn();
  const input = doc.querySelector(".validation-field input");
  press("Enter");
  assert.equal(doc.querySelector(".validation-attempts").textContent, "0 / 3");
  input.value = "あ";
  press("Enter");
  assert.equal(doc.querySelector(".validation-attempts").textContent, "1 / 3");
  assert.equal(doc.querySelector(".validation-next"), null);
  assert.equal(progress(), null);
  input.value = word.kana;
  press("Enter");
  press("Enter", { target: doc.body });
  assert.notEqual(doc.querySelector(".validation-field input"), input);
  assert.equal(progress().totalAnswered, 1);
});

test("double Space clicks the skip action once, revealing the answer and recording a review item", () => {
  validationOn();
  let skipClicks = 0;
  doc.querySelector(".validation-abandon").addEventListener("click", () => { skipClicks += 1; });
  assert.equal(press(" ").defaultPrevented, true);
  assert.equal(progress(), null);
  press(" ");
  assert.equal(skipClicks, 1);
  assert.equal(progress().totalAnswered, 1);
  assert.equal(progress().totalForgot, 1);
  assert.deepEqual(progress().review[word.id], { correct: 0 });
  assert.equal(doc.querySelector("#answer-panel").hidden, false);
  assert.ok(doc.querySelector(".validation-next"));
  press(" ");
  assert.equal(progress().totalAnswered, 1);
  press("Enter");
  press(" ", { target: doc.body });
  assert.equal(progress().totalAnswered, 1);
  press(" ", { target: doc.body });
  assert.equal(progress().totalAnswered, 2);
});

test("slow, interrupted, held, modified and IME spaces do not skip", () => {
  validationOn();
  press(" ");
  press(" ", { elapsed: 351 });
  press("a");
  press(" ");
  assert.equal(press(" ", { repeat: true }).defaultPrevented, true);
  press(" ");
  press(" ", { isComposing: true });
  press(" ");
  press(" ", { keyCode: 229 });
  press(" ");
  press(" ", { ctrlKey: true });
  assert.equal(progress(), null);
  press(" ");
  press(" ");
  assert.equal(progress().totalForgot, 1);
});

test("vocabulary shortcuts leave other controls and open dialogs alone", () => {
  validationOn();
  const trigger = doc.querySelector("#unit-select-trigger");
  press(" ", { target: trigger });
  assert.equal(press(" ", { target: trigger }).defaultPrevented, false);
  doc.querySelector("#open-data-button").click();
  press(" ", { target: doc.body });
  press(" ", { target: doc.body });
  press("Enter", { target: doc.body });
  assert.equal(progress(), null);
});

test("normal flashcards and kana validation keep their original Space behavior", () => {
  press(" ", { target: doc.body });
  press(" ", { target: doc.body });
  assert.equal(doc.querySelector("#answer-panel").hidden, false);
  assert.equal(progress(), null);
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {} });
  doc.querySelector("#unit-select-trigger").click();
  [...doc.querySelectorAll("[role='option']")].find((option) => option.textContent === "假名练习单元").click();
  validationOn();
  assert.equal(doc.querySelectorAll(".validation-field").length, 2);
  assert.equal(press(" ", { target: doc.body }).defaultPrevented, false);
  press(" ", { target: doc.body });
  assert.equal(dom.window.localStorage.getItem("kana-loop-progress-v1"), null);
});

test("pronunciation is requested only on click after reveal and uses the stored Japanese reading", async () => {
  const button = doc.querySelector("#pronunciation-button");
  button.click();
  assert.equal(audioClips.length, 0);
  assert.equal(button.disabled, true);
  doc.querySelector("#reveal-actions button").click();
  assert.equal(button.disabled, false);
  assert.equal(audioClips.length, 0);
  button.click();
  await settle();
  const url = new URL(audioClips[0].src);
  assert.equal(url.searchParams.get("audio"), word.kana);
  assert.equal(url.searchParams.get("le"), "jap");
  assert.equal(button.dataset.state, "playing");
  assert.equal(progress(), null);
  audioClips[0].dispatchEvent(new dom.window.Event("ended"));
  assert.equal(button.dataset.state, "idle");
  button.click();
  await settle();
  assert.equal(audioClips.length, 2);
  button.click();
  assert.equal(button.dataset.state, "idle");
  assert.ok(audioClips[1].pauseCalls > 0);
});

test("completed vocabulary validation allows pronunciation and next question stops playback", async () => {
  validationOn();
  await submit(word.kana);
  const button = doc.querySelector("#pronunciation-button");
  button.click();
  await settle();
  assert.equal(button.dataset.state, "playing");
  assert.equal(progress().totalAnswered, 1);
  doc.querySelector(".validation-next").click();
  assert.ok(audioClips[0].pauseCalls > 0);
  assert.equal(button.dataset.state, "idle");
  assert.equal(button.disabled, true);
  assert.equal(doc.querySelector("#answer-panel").hidden, true);
});

test("changing modes or leaving practice cancels speech without recording an answer", async () => {
  doc.querySelector("#reveal-actions button").click();
  doc.querySelector("#pronunciation-button").click();
  await settle();
  validationOn();
  assert.ok(audioClips[0].pauseCalls > 0);
  assert.equal(doc.querySelector("#pronunciation-button").disabled, true);
  const toggle = doc.querySelector("#validation-mode");
  toggle.checked = false;
  toggle.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  doc.querySelector("#reveal-actions button").click();
  doc.querySelector("#pronunciation-button").click();
  await settle();
  doc.querySelector("#manage-nav").click();
  await settle();
  assert.ok(audioClips[1].pauseCalls > 0);
  assert.equal(doc.querySelector("#pronunciation-button").dataset.state, "idle");
  assert.equal(progress(), null);
});

test("vocabulary validation shows only Chinese and gives 3 attempts; a later correct answer records known once", async () => {
  validationOn();
  assert.equal(doc.querySelector("#validation-switch").hidden, false);
  assert.equal(doc.querySelector("#prompt").textContent, word.meaning);
  assert.equal(doc.querySelector("#answer-panel").hidden, true);
  assert.equal(doc.querySelector("#judgement-actions").hidden, true);
  assert.equal(doc.querySelector(".validation-attempts").textContent, "0 / 3");
  await submit("");
  assert.equal(doc.querySelector(".validation-attempts").textContent, "0 / 3");
  await submit("ちゅごくじん");
  assert.equal(doc.querySelector("#answer-panel").hidden, true);
  assert.equal(progress(), null);
  await submit("ちゅうごくじん");
  assert.equal(doc.querySelector("#answer-panel").hidden, false);
  assert.equal(doc.querySelector("#answer-value").textContent, word.japanese);
  assert.equal(progress().weights[word.id].weight, 0.72);
  assert.equal(progress().totalAnswered, 1);
  assert.equal(progress().totalForgot, 0);
  assert.deepEqual(progress().review[word.id], { correct: 0 });
  doc.querySelector(".button-check").click();
  assert.equal(progress().totalAnswered, 1);
  assert.ok(doc.querySelector(".validation-next"));
  doc.querySelector(".validation-next").click();
  assert.equal(doc.querySelector("#answer-panel").hidden, true);
  assert.equal(doc.querySelector(".validation-attempts").textContent, "0 / 3");
});

test("only the third failed attempt reveals kana and Japanese and increases the word's weight", async () => {
  validationOn();
  await submit("あ");
  await submit("い");
  assert.equal(progress(), null);
  assert.equal(doc.querySelector("#answer-panel").hidden, true);
  await submit("う");
  assert.equal(doc.querySelector("#answer-panel").hidden, false);
  assert.equal(doc.querySelector("#answer-value").textContent, word.japanese);
  assert.ok(doc.querySelector("#answer-detail").textContent.includes(word.kana));
  assert.equal(progress().weights[word.id].weight, 2.1);
  assert.equal(progress().totalForgot, 1);
  assert.equal(doc.querySelector(".validation-field input").disabled, true);
});

test("skipping records a review item and the following question restores the skip action", () => {
  validationOn();
  doc.querySelector(".validation-abandon").click();
  assert.deepEqual(progress().review[word.id], { correct: 0 });
  assert.ok(doc.querySelector(".validation-next"));
  doc.querySelector(".validation-next").click();
  assert.ok(doc.querySelector(".validation-abandon"));
  assert.equal(doc.querySelector(".validation-next"), null);
});

test("review mode removes a wrong item after two correct answers", async () => {
  validationOn();
  doc.querySelector(".validation-abandon").click();
  doc.querySelector(".validation-next").click();
  const reviewToggle = doc.querySelector("#review-toggle");
  assert.equal(reviewToggle.disabled, false);
  assert.equal(doc.querySelector("#review-count").textContent, "1");

  reviewToggle.click();
  assert.equal(reviewToggle.getAttribute("aria-pressed"), "true");
  assert.match(doc.querySelector("#mode-label").textContent, /^错题回顾/);
  await submit(word.kana);
  assert.deepEqual(progress().review[word.id], { correct: 1 });
  doc.querySelector(".validation-next").click();
  await submit(word.kana);
  assert.equal(progress().review[word.id], undefined);
  doc.querySelector(".validation-next").click();
  assert.equal(reviewToggle.getAttribute("aria-pressed"), "false");
  assert.equal(reviewToggle.disabled, true);
  assert.equal(doc.querySelector("#review-count").textContent, "0");
  assert.equal(doc.querySelector(".validation-abandon") !== null, true);
});

test("Japanese IME Enter cannot consume an attempt, and the global switch remains available in the manager", async () => {
  validationOn();
  const input = doc.querySelector(".validation-field input");
  input.value = word.kana;
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
  assert.equal(doc.querySelector(".validation-attempts").textContent, "0 / 3");
  doc.querySelector("#manage-nav").click();
  await settle();
  assert.equal(doc.querySelector("#validation-switch").hidden, false);
  assert.equal(doc.querySelector("#manage-page").hidden, false);
});

test("pending imports appear in the reused editor and confirmation sends the draft ID to file storage", async () => {
  const imported = { id: "import-test", status: "pending", source: "词表.png", notes: [{ row: 1, message: "核对声调" }], issues: [], unit: { ...structuredClone(lesson), id: "unit-import-test", name: "待审核课程" } };
  snapshot.imports.push(imported);
  doc.querySelector("#manage-nav").click();
  await settle();
  assert.equal(doc.querySelector("#imports-section").hidden, false);
  doc.querySelector("#import-list button").click();
  await settle();
  assert.equal(doc.querySelector("#unit-name").value, imported.unit.name);
  assert.equal(doc.querySelector("#save-unit-button").textContent, "确认并保存单元");
  assert.match(doc.querySelector("#import-review-info").textContent, /核对声调/);
  doc.querySelector("#save-unit-button").click();
  await settle();
  const saved = JSON.parse(requests.find((request) => request.options.method === "PUT").options.body);
  assert.equal(saved.importId, imported.id);
  assert.equal(saved.units.length, 2);
  assert.equal(snapshot.imports.length, 0);
  assert.equal(doc.querySelector("#imports-section").hidden, true);
});

test("the custom dropdown supports keyboard selection, Escape, and outside dismissal", () => {
  const trigger = doc.querySelector("#unit-select-trigger");
  trigger.focus();
  trigger.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(doc.activeElement.textContent, lesson.name);
  doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
  assert.equal(doc.activeElement.textContent, "假名练习单元");
  doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(doc.querySelector(".unit-select-value").textContent, "假名练习单元");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  trigger.click();
  doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(doc.activeElement, trigger);
  trigger.click();
  doc.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
});
