import { KANA_IDS } from "./kana.js";

export const APP_VERSION = 1;
export const MIN_WEIGHT = 0.15;
export const MAX_WEIGHT = 12;
export const KNOWN_FACTOR = 0.72;
export const FORGOT_FACTOR = 1.65;
export const FORGOT_ADD = 0.45;
export const RECENT_WINDOW = 6;

export function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createInitialProgress() {
  return {
    version: APP_VERSION,
    weights: {},
    daily: {},
    recent: [],
    totalAnswered: 0,
    totalForgot: 0,
  };
}

export function normalizeProgress(value) {
  const initial = createInitialProgress();
  if (!value || typeof value !== "object" || value.version !== APP_VERSION) return initial;

  return {
    ...initial,
    weights: value.weights && typeof value.weights === "object" ? value.weights : {},
    daily: value.daily && typeof value.daily === "object" ? value.daily : {},
    recent: Array.isArray(value.recent) ? value.recent.filter((id) => KANA_IDS.includes(id)) : [],
    totalAnswered: Number(value.totalAnswered) || 0,
    totalForgot: Number(value.totalForgot) || 0,
  };
}

export function weightFor(progress, id) {
  const weight = Number(progress.weights?.[id]?.weight);
  return Number.isFinite(weight) ? clamp(weight, MIN_WEIGHT, MAX_WEIGHT) : 1;
}

export function updateWeight(weight, result) {
  const next = result === "forgot"
    ? weight * FORGOT_FACTOR + FORGOT_ADD
    : weight * KNOWN_FACTOR;
  return Number(clamp(next, MIN_WEIGHT, MAX_WEIGHT).toFixed(3));
}

export function pickWeighted(ids, getWeight, random = Math.random) {
  const total = ids.reduce((sum, id) => sum + Math.max(0, getWeight(id)), 0);
  if (!total) return ids[Math.floor(random() * ids.length)];

  let cursor = random() * total;
  for (const id of ids) {
    cursor -= Math.max(0, getWeight(id));
    if (cursor <= 0) return id;
  }
  return ids[ids.length - 1];
}

export function pickNextItem(progress, random = Math.random) {
  const recent = new Set(progress.recent ?? []);
  const adjustedWeight = (id) => {
    const recencyFactor = recent.has(id) ? 0.18 : 1;
    return weightFor(progress, id) * recencyFactor;
  };
  return pickWeighted(KANA_IDS, adjustedWeight, random);
}

export function pickPrompt(random = Math.random) {
  const direction = random() < 0.52 ? "kanaToRomaji" : "romajiToKana";
  const script = random() < 0.5 ? "hiragana" : "katakana";
  return { direction, script };
}

export function recordAnswer(progress, itemId, result, date = new Date()) {
  const currentWeight = weightFor(progress, itemId);
  const nextWeight = updateWeight(currentWeight, result);
  const existingItem = progress.weights?.[itemId] ?? {
    weight: 1,
    known: 0,
    forgot: 0,
    seen: 0,
  };
  const dateKey = getDateKey(date);
  const existingDay = progress.daily?.[dateKey] ?? {
    answered: 0,
    forgot: 0,
    known: 0,
  };

  return {
    ...progress,
    weights: {
      ...progress.weights,
      [itemId]: {
        ...existingItem,
        weight: nextWeight,
        seen: existingItem.seen + 1,
        known: existingItem.known + (result === "known" ? 1 : 0),
        forgot: existingItem.forgot + (result === "forgot" ? 1 : 0),
      },
    },
    daily: {
      ...progress.daily,
      [dateKey]: {
        ...existingDay,
        answered: existingDay.answered + 1,
        known: existingDay.known + (result === "known" ? 1 : 0),
        forgot: existingDay.forgot + (result === "forgot" ? 1 : 0),
      },
    },
    recent: [itemId, ...(progress.recent ?? []).filter((id) => id !== itemId)].slice(0, RECENT_WINDOW),
    totalAnswered: progress.totalAnswered + 1,
    totalForgot: progress.totalForgot + (result === "forgot" ? 1 : 0),
  };
}

export function getDailyStats(progress, date = new Date()) {
  const day = progress.daily?.[getDateKey(date)] ?? { answered: 0, forgot: 0, known: 0 };
  return {
    answered: day.answered ?? 0,
    forgot: day.forgot ?? 0,
    known: day.known ?? 0,
    forgotRate: day.answered ? day.forgot / day.answered : null,
  };
}

export function getRecentDays(progress, days = 7, today = new Date()) {
  const result = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = getDateKey(date);
    const day = progress.daily?.[key] ?? { answered: 0, forgot: 0, known: 0 };
    result.push({ key, date, ...day });
  }
  return result;
}

export function getWeakItems(progress, limit = 5) {
  return KANA_IDS
    .map((id) => {
      const item = progress.weights?.[id] ?? {};
      return {
        id,
        weight: weightFor(progress, id),
        seen: item.seen ?? 0,
        forgot: item.forgot ?? 0,
        known: item.known ?? 0,
      };
    })
    .filter((item) => item.seen > 0 && (item.forgot > 0 || item.weight > 1.05))
    .sort((a, b) => b.weight - a.weight || b.forgot - a.forgot)
    .slice(0, limit);
}

export function getMasteredCount(progress) {
  return KANA_IDS.filter((id) => {
    const item = progress.weights?.[id];
    return item?.seen > 0 && weightFor(progress, id) <= 0.55;
  }).length;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
