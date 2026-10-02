import test, { before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import { build } from "vite";

const word = { id: "word-1", japanese: "中国人", kana: "ちゅうごくじん", accent: 4, meaning: "中国人" };
const lesson = { id: "lesson-1", name: "第一课", kind: "vocabulary", words: [word] };
const settle = () => new Promise((resolve) => setImmediate(resolve));
let code, html, dom, doc, snapshot, requests, audioClips;

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
