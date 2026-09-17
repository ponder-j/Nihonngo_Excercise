import { createInitialProgress, normalizeProgress } from "./engine.js";

const STORAGE_KEY = "kana-loop-progress-v1";

export function loadProgress() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeProgress(JSON.parse(raw)) : createInitialProgress();
  } catch (error) {
    console.warn("Unable to read local progress", error);
    return createInitialProgress();
  }
}

export function saveProgress(progress) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch (error) {
    console.warn("Unable to save local progress", error);
    return false;
  }
}

export function clearProgress() {
  window.localStorage.removeItem(STORAGE_KEY);
}
