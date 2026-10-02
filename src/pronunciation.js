export function getPronunciationText(item) {
  return [item?.kana, item?.japanese, item?.hiragana, item?.katakana]
    .find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

export function getPronunciationUrl(text) {
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&le=jap&type=2`;
}

const FAILURE_MESSAGE = "暂时无法播放日语发音，请检查网络后重试，或在设备中安装日语语音。";

export function createPronunciationPlayer({
  onStateChange = () => {},
  onError = () => {},
  audioFactory = (url) => new globalThis.Audio(url),
  synthesis = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  schedule = globalThis.setTimeout.bind(globalThis),
  unschedule = globalThis.clearTimeout.bind(globalThis),
  timeoutMs = 8000,
  voicesTimeoutMs = 1500,
} = {}) {
  let active = null;
  let state = "idle";

  function setState(next) {
    if (state === next) return;
    state = next;
    onStateChange(next);
  }

  function clearTimer(run) {
    if (run.timer !== null) unschedule(run.timer);
    run.timer = null;
  }

  function releaseAudio(run) {
    if (!run.audio) return;
    const audio = run.audio;
    run.audio = null;
    audio.onplaying = audio.onended = audio.onerror = null;
    audio.pause();
    // Stop both playback and an in-flight download, including a pending play().
    audio.removeAttribute("src");
    audio.load();
  }

  function stop() {
    const run = active;
    active = null;
    if (run) {
      clearTimer(run);
      run.removeVoiceListener?.();
      releaseAudio(run);
      if (run.utterance) {
        run.utterance.onstart = run.utterance.onend = run.utterance.onerror = null;
        synthesis.cancel();
      }
    }
    setState("idle");
  }

  function fail(run) {
    if (active !== run) return;
    stop();
    onError(FAILURE_MESSAGE);
  }

  function armTimer(run, callback, duration = timeoutMs) {
    clearTimer(run);
    run.timer = schedule(() => {
      run.timer = null;
      if (active === run) callback();
    }, duration);
  }

  function playbackStarted(run) {
    if (active !== run) return;
    setState("playing");
    // Also recover if a browser never sends an ended/error event.
    armTimer(run, () => fail(run), Math.max(30000, run.text.length * 1000));
  }

  function useNativeVoice(run) {
    if (active !== run || run.phase !== "audio") return;
    run.phase = "voices";
    setState("loading");
    clearTimer(run);
    releaseAudio(run);
    if (!synthesis || !Utterance) return fail(run);

    function tryVoice() {
      if (active !== run || run.phase !== "voices") return false;
      const voice = synthesis.getVoices().find((candidate) => /^ja(?:[-_]|$)/i.test(candidate.lang));
      if (!voice) return false;
      run.phase = "speech";
      run.removeVoiceListener?.();
      clearTimer(run);
      const utterance = new Utterance(run.text);
      run.utterance = utterance;
      utterance.lang = "ja-JP";
      utterance.voice = voice;
      utterance.onstart = () => playbackStarted(run);
      utterance.onend = () => { if (active === run) stop(); };
      utterance.onerror = () => fail(run);
      armTimer(run, () => fail(run));
      synthesis.speak(utterance);
      return true;
    }

    function checkVoices() {
      try { return tryVoice(); } catch { fail(run); return true; }
    }

    if (checkVoices()) return;
    synthesis.addEventListener?.("voiceschanged", checkVoices);
    run.removeVoiceListener = () => synthesis.removeEventListener?.("voiceschanged", checkVoices);
    armTimer(run, () => { if (!checkVoices()) fail(run); }, voicesTimeoutMs);
  }

  function play(text) {
    stop();
    const normalized = typeof text === "string" ? text.trim() : "";
    if (!normalized) {
      onError("暂无可播放的日语文本。");
      return;
    }
    const run = { text: normalized, phase: "audio", timer: null, audio: null, utterance: null };
    active = run;
    setState("loading");
    try {
      const audio = audioFactory(getPronunciationUrl(normalized));
      run.audio = audio;
      audio.onplaying = () => {
        if (active === run && run.phase === "audio") playbackStarted(run);
      };
      audio.onended = () => { if (active === run && run.phase === "audio") stop(); };
      audio.onerror = () => useNativeVoice(run);
      armTimer(run, () => useNativeVoice(run));
      // Direct media playback works on static hosting without a CORS fetch proxy.
      // No crossOrigin is set, and audio is only requested following play().
      Promise.resolve(audio.play()).then(() => {
        if (active === run && run.phase === "audio") playbackStarted(run);
      }, () => useNativeVoice(run));
    } catch {
      useNativeVoice(run);
    }
  }

  return { play, stop };
}
