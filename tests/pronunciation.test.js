import test from "node:test";
import assert from "node:assert/strict";
import { createPronunciationPlayer, getPronunciationText, getPronunciationUrl } from "../src/pronunciation.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup({ voices = [{ lang: "ja-JP", name: "Japanese" }], native = true } = {}) {
  const states = [], errors = [], audios = [], spoken = [], listeners = new Set(), timers = new Map();
  let nextTimer = 0, now = 0, cancelCount = 0;
  const synthesis = {
    getVoices: () => voices,
    addEventListener: (_, handler) => listeners.add(handler),
    removeEventListener: (_, handler) => listeners.delete(handler),
    speak: (utterance) => spoken.push(utterance),
    cancel: () => { cancelCount += 1; },
  };
  const player = createPronunciationPlayer({
    onStateChange: (state) => states.push(state),
    onError: (error) => errors.push(error),
    audioFactory: (url) => {
      const pending = deferred();
      const audio = {
        url, pending, paused: false, unloaded: false,
        play: () => pending.promise,
        pause() { this.paused = true; },
        removeAttribute(name) { assert.equal(name, "src"); this.unloaded = true; },
        load() {},
      };
      audios.push(audio);
      return audio;
    },
    synthesis: native ? synthesis : null,
    Utterance: class { constructor(text) { this.text = text; } },
    schedule: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    unschedule: (id) => timers.delete(id),
  });
  function advance(duration) {
    now += duration;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }
  }
  return {
    player, states, errors, audios, spoken, timers, listeners, advance,
    cancellations: () => cancelCount,
    setVoices(next) { voices = next; for (const listener of [...listeners]) listener(); },
  };
}

test("pronunciation uses the vocabulary reading and Japanese kana, never romaji or meaning", () => {
  assert.equal(getPronunciationText({ japanese: "学生", kana: " がくせい ", meaning: "学生" }), "がくせい");
  assert.equal(getPronunciationText({ japanese: "学校", kana: " " }), "学校");
  assert.equal(getPronunciationText({ hiragana: "あ", katakana: "ア", romaji: "a" }), "あ");
  assert.equal(getPronunciationText({ katakana: "ア" }), "ア");
  assert.equal(getPronunciationText({ romaji: "a", meaning: "学校" }), "");
  assert.equal(getPronunciationText(null), "");
});

test("speech URL encodes Japanese and query metacharacters without adding parameters", () => {
  const text = "がくせい & ?/#";
  const url = new URL(getPronunciationUrl(text));
  assert.equal(url.origin, "https://dict.youdao.com");
  assert.equal(url.searchParams.get("audio"), text);
  assert.equal(url.searchParams.get("le"), "jap");
  assert.equal(url.searchParams.size, 3);
});

test("media is requested only on play and end returns to idle", async () => {
  const env = setup();
  assert.equal(env.audios.length, 0);
  env.player.play(" がくせい ");
  assert.deepEqual(env.states, ["loading"]);
  assert.equal(new URL(env.audios[0].url).searchParams.get("audio"), "がくせい");
  env.audios[0].pending.resolve();
  await Promise.resolve();
  assert.deepEqual(env.states, ["loading", "playing"]);
  env.audios[0].onended();
  assert.deepEqual(env.states, ["loading", "playing", "idle"]);
  assert.equal(env.audios[0].paused, true);
  assert.equal(env.audios[0].unloaded, true);
  assert.equal(env.timers.size, 0);
  assert.equal(env.spoken.length, 0);
});

test("a stopped download cannot restart or fall back when its play promise settles", async () => {
  const env = setup();
  env.player.play("あ");
  const oldPlaying = env.audios[0].onplaying, oldError = env.audios[0].onerror;
  env.player.stop();
  env.audios[0].pending.reject(new Error("aborted"));
  oldPlaying();
  oldError();
  await Promise.resolve();
  env.advance(60000);
  assert.deepEqual(env.states, ["loading", "idle"]);
  assert.equal(env.spoken.length, 0);
  assert.equal(env.errors.length, 0);
});

test("new playback cancels old media and ignores stale events and resolved promises", async () => {
  const env = setup();
  env.player.play("あ");
  const oldEnd = env.audios[0].onended;
  env.player.play("い");
  env.audios[0].pending.resolve();
  oldEnd();
  await Promise.resolve();
  assert.equal(env.audios[0].paused, true);
  assert.equal(env.states.at(-1), "loading");
  env.audios[1].onplaying();
  assert.equal(env.states.at(-1), "playing");
  env.player.stop();
});

test("network rejection falls back to a Japanese voice and unloads external audio", async () => {
  const env = setup({ voices: [{ lang: "en-US" }, { lang: "ja_JP", name: "日本語" }] });
  env.player.play("がくせい");
  env.audios[0].pending.reject(new Error("offline"));
  await Promise.resolve();
  assert.equal(env.audios[0].unloaded, true);
  assert.equal(env.spoken.length, 1);
  assert.equal(env.spoken[0].voice.name, "日本語");
  assert.equal(env.spoken[0].lang, "ja-JP");
  assert.equal(env.spoken[0].text, "がくせい");
  env.spoken[0].onstart();
  assert.equal(env.states.at(-1), "playing");
  env.spoken[0].onend();
  assert.equal(env.states.at(-1), "idle");
  assert.equal(env.errors.length, 0);
});

test("network timeout waits for delayed Japanese voice discovery", () => {
  const env = setup({ voices: [] });
  env.player.play("あ");
  env.advance(8000);
  assert.equal(env.listeners.size, 1);
  assert.equal(env.spoken.length, 0);
  env.setVoices([{ lang: "en-US" }]);
  assert.equal(env.spoken.length, 0);
  env.setVoices([{ lang: "ja-JP" }]);
  assert.equal(env.spoken.length, 1);
  assert.equal(env.listeners.size, 0);
  env.player.stop();
  assert.equal(env.cancellations(), 1);
  assert.equal(env.timers.size, 0);
});

test("a stream failure after playback starts shows loading while awaiting a native voice", () => {
  const env = setup({ voices: [] });
  env.player.play("あ");
  env.audios[0].onplaying();
  env.audios[0].onerror();
  assert.deepEqual(env.states, ["loading", "playing", "loading"]);
  env.setVoices([{ lang: "ja-JP" }]);
  env.spoken[0].onstart();
  assert.equal(env.states.at(-1), "playing");
  env.player.stop();
});

test("missing Japanese voices reports an actionable error and allows retry", () => {
  const env = setup({ voices: [{ lang: "en-US" }] });
  env.player.play("あ");
  env.audios[0].onerror();
  env.advance(1500);
  assert.equal(env.spoken.length, 0);
  assert.equal(env.states.at(-1), "idle");
  assert.match(env.errors[0], /网络.*日语语音/);
  assert.equal(env.listeners.size, 0);
  env.player.play("い");
  assert.equal(env.states.at(-1), "loading");
  env.audios[1].onplaying();
  assert.equal(env.states.at(-1), "playing");
  env.player.stop();
});

test("stopping voice discovery prevents delayed voices from speaking", () => {
  const env = setup({ voices: [] });
  env.player.play("あ");
  env.audios[0].onerror();
  env.player.stop();
  env.setVoices([{ lang: "ja-JP" }]);
  env.advance(8000);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.spoken.length, 0);
  assert.equal(env.errors.length, 0);
});

test("stale media completion cannot disturb native fallback and stopping cancels speech", async () => {
  const env = setup();
  env.player.play("あ");
  const staleEnd = env.audios[0].onended;
  env.audios[0].onerror();
  env.spoken[0].onstart();
  env.audios[0].pending.resolve();
  staleEnd();
  await Promise.resolve();
  assert.equal(env.states.at(-1), "playing");
  const staleSpeechStart = env.spoken[0].onstart;
  env.player.stop();
  staleSpeechStart();
  assert.equal(env.states.at(-1), "idle");
  assert.equal(env.cancellations(), 1);
});

test("unavailable native speech and stalled speech recover to idle", () => {
  const unavailable = setup({ native: false });
  unavailable.player.play("あ");
  unavailable.audios[0].onerror();
  assert.equal(unavailable.errors.length, 1);
  assert.equal(unavailable.states.at(-1), "idle");
  const stalled = setup();
  stalled.player.play("い");
  stalled.audios[0].onerror();
  stalled.advance(8000);
  assert.equal(stalled.errors.length, 1);
  assert.equal(stalled.states.at(-1), "idle");
  assert.equal(stalled.cancellations(), 1);
});
