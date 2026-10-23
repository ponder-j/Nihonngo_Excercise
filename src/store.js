import { createInitialProgress, normalizeProgress } from "./engine.js";
import { KANA_IDS } from "./kana.js";
import { KANA_UNIT_ID, LIBRARY_VERSION, normalizeLibrary } from "./units.js";

const STORAGE_KEY = "kana-loop-progress-v1";
const LIBRARY_KEY = "kana-loop-units-v1";
const ACTIVE_UNIT_KEY = "kana-loop-active-unit-v1";
const PRACTICE_SETTINGS_KEY = "kana-loop-practice-settings-v1";

function sequenceKey(unitId, reviewMode, mode = "sequential") {
  return `kana-loop-${mode === "dictation" ? "dictation" : "sequence"}-v1:${unitId}:${reviewMode ? "review" : "practice"}`;
}

export function loadSequentialProgress(unitId, reviewMode = false, mode = "sequential") {
  try {
    const saved = JSON.parse(window.localStorage.getItem(sequenceKey(unitId, reviewMode, mode)));
    if (saved?.version !== 1 || !saved.results || typeof saved.results !== "object" || Array.isArray(saved.results)) return {};
    return Object.fromEntries(Object.entries(saved.results).filter(([id, result]) => id && ["known", "forgot"].includes(result)));
  } catch (error) {
    console.warn("Unable to read sequential progress", error);
    return {};
  }
}

export function saveSequentialProgress(unitId, results, reviewMode = false, mode = "sequential") {
  try {
    window.localStorage.setItem(sequenceKey(unitId, reviewMode, mode), JSON.stringify({ version: 1, results }));
    return true;
  } catch (error) {
    console.warn("Unable to save sequential progress", error);
    return false;
  }
}

export function loadPracticeSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PRACTICE_SETTINGS_KEY));
    const validationMode = saved?.validationMode === true;
    return { validationMode, order: validationMode && ["sequential", "dictation"].includes(saved?.order) ? saved.order : "random", reviewMode: saved?.reviewMode === true };
  } catch (error) {
    console.warn("Unable to read practice settings", error);
    return { validationMode: false, order: "random", reviewMode: false };
  }
}

export function savePracticeSettings(settings) {
  try {
    window.localStorage.setItem(PRACTICE_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.warn("Unable to save practice settings", error);
    return false;
  }
}

function progressKey(unitId) {
  return unitId === KANA_UNIT_ID ? STORAGE_KEY : `kana-loop-unit-progress-v1:${unitId}`;
}

export function loadProgress(unitId = KANA_UNIT_ID, itemIds = KANA_IDS) {
  try {
    const raw = window.localStorage.getItem(progressKey(unitId));
    return raw ? normalizeProgress(JSON.parse(raw), itemIds) : createInitialProgress();
  } catch (error) {
    console.warn("Unable to read local progress", error);
    return createInitialProgress();
  }
}

export function saveProgress(progress, unitId = KANA_UNIT_ID) {
  try {
    window.localStorage.setItem(progressKey(unitId), JSON.stringify(progress));
    return true;
  } catch (error) {
    console.warn("Unable to save local progress", error);
    return false;
  }
}

export function clearProgress(unitId = KANA_UNIT_ID) {
  try {
    window.localStorage.removeItem(progressKey(unitId));
    for (const mode of ["sequential", "dictation"]) {
      window.localStorage.removeItem(sequenceKey(unitId, false, mode));
      window.localStorage.removeItem(sequenceKey(unitId, true, mode));
    }
    return true;
  } catch (error) {
    console.warn("Unable to clear local progress", error);
    return false;
  }
}

export function loadUnits() {
  try {
    return normalizeLibrary(JSON.parse(window.localStorage.getItem(LIBRARY_KEY)));
  } catch (error) {
    console.warn("Unable to read local units", error);
    return normalizeLibrary(null);
  }
}

export function saveUnits(units) {
  try {
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify({
      version: LIBRARY_VERSION,
      units: units.filter((unit) => unit.id !== KANA_UNIT_ID),
    }));
    return true;
  } catch (error) {
    console.warn("Unable to save local units", error);
    return false;
  }
}

export function loadActiveUnit() {
  try {
    return window.localStorage.getItem(ACTIVE_UNIT_KEY) || KANA_UNIT_ID;
  } catch {
    return KANA_UNIT_ID;
  }
}

export function saveActiveUnit(unitId) {
  try {
    window.localStorage.setItem(ACTIVE_UNIT_KEY, unitId);
  } catch (error) {
    console.warn("Unable to save selected unit", error);
  }
}
