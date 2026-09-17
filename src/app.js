import "./styles.css";
import { KANA_BY_ID } from "./kana.js";
import {
  getDailyStats,
  getMasteredCount,
  getRecentDays,
  getWeakItems,
  pickNextItem,
  pickPrompt,
  recordAnswer,
} from "./engine.js";
import { clearProgress, loadProgress, saveProgress } from "./store.js";

const elements = {
  practiceCard: document.querySelector("#practice-card"),
  modeLabel: document.querySelector("#mode-label"),
  scriptTag: document.querySelector("#script-tag"),
  prompt: document.querySelector("#prompt"),
  promptHint: document.querySelector("#prompt-hint"),
  answerPanel: document.querySelector("#answer-panel"),
  answerLabel: document.querySelector(".answer-label"),
  answerValue: document.querySelector("#answer-value"),
  answerDetail: document.querySelector("#answer-detail"),
  revealActions: document.querySelector("#reveal-actions"),
  knownButton: document.querySelector("#known-button"),
  forgotButton: document.querySelector("#forgot-button"),
  sessionCount: document.querySelector("#session-count"),
  headerToday: document.querySelector("#header-today"),
  headerForgotRate: document.querySelector("#header-forgot-rate"),
  goalBadge: document.querySelector("#goal-badge"),
  progressRing: document.querySelector("#progress-ring"),
  ringCount: document.querySelector("#ring-count"),
  knownToday: document.querySelector("#known-today"),
  forgotToday: document.querySelector("#forgot-today"),
  forgotRate: document.querySelector("#forgot-rate"),
  weekChart: document.querySelector("#week-chart"),
  weakList: document.querySelector("#weak-list"),
  feedbackFlash: document.querySelector("#feedback-flash"),
  toast: document.querySelector("#toast"),
  milestoneModal: document.querySelector("#milestone-modal"),
  milestoneTotal: document.querySelector("#milestone-total"),
  milestoneRate: document.querySelector("#milestone-rate"),
  summaryModal: document.querySelector("#summary-modal"),
  summaryTotal: document.querySelector("#summary-total"),
  summaryKnown: document.querySelector("#summary-known"),
  summaryRate: document.querySelector("#summary-rate"),
  dataModal: document.querySelector("#data-modal"),
  dataTotal: document.querySelector("#data-total"),
  dataForgot: document.querySelector("#data-forgot"),
  dataMastered: document.querySelector("#data-mastered"),
  dataTableBody: document.querySelector("#data-table-body"),
};

const QUESTIONS_PER_MILESTONE = 50;

let progress = loadProgress();
let current = null;
let sessionCount = 0;
let transitionLocked = false;
let milestoneShownFor = null;

function nextQuestion() {
  const id = pickNextItem(progress);
  const item = KANA_BY_ID[id];
  const prompt = pickPrompt();
  current = { item, ...prompt };
  renderQuestion();
}

function renderQuestion() {
  const { item, direction, script } = current;
  const kana = script === "hiragana" ? item.hiragana : item.katakana;

  elements.answerPanel.hidden = true;
  elements.answerPanel.classList.remove("is-visible");
  elements.practiceCard.classList.remove("is-revealed", "is-forgot", "is-known");
  elements.revealActions.classList.toggle("has-two-actions", direction === "romajiToKana");
  elements.revealActions.replaceChildren();

  if (direction === "kanaToRomaji") {
    elements.modeLabel.textContent = "看假名，回忆罗马音";
    elements.scriptTag.textContent = script === "hiragana" ? "平假名" : "片假名";
    elements.scriptTag.lang = "zh-CN";
    elements.prompt.textContent = kana;
    elements.prompt.lang = "ja";
    elements.prompt.classList.remove("is-romaji");
    elements.promptHint.textContent = "先在心里读出来，再决定要不要显示答案。";
    elements.answerLabel.textContent = "罗马音";
    elements.answerValue.textContent = item.romaji;
    elements.answerDetail.textContent = `${item.hiragana} · ${item.katakana}`;
    elements.revealActions.append(
      makeButton("显示罗马音", "button-reveal", (event) => revealAnswer(undefined, event.currentTarget), "space"),
    );
  } else {
    elements.modeLabel.textContent = "看罗马音，回忆两种假名";
    elements.scriptTag.textContent = "罗马音";
    elements.scriptTag.lang = "en";
    elements.prompt.textContent = item.romaji;
    elements.prompt.lang = "en";
    elements.prompt.classList.add("is-romaji");
    elements.promptHint.textContent = "在脑中写出两种写法，再显示答案。";
    elements.answerLabel.textContent = "假名";
    elements.answerValue.textContent = `${item.hiragana}　${item.katakana}`;
    elements.answerDetail.textContent = `平假名 ${item.hiragana} · 片假名 ${item.katakana}`;
    elements.revealActions.append(
      makeButton("显示平假名", "button-reveal", (event) => revealAnswer("hiragana", event.currentTarget), "space"),
    );
    elements.revealActions.append(
      makeButton("显示片假名", "button-reveal secondary-reveal", (event) => revealAnswer("katakana", event.currentTarget), "space"),
    );
  }

  elements.knownButton.disabled = false;
  elements.forgotButton.disabled = false;
  elements.knownButton.classList.remove("pulse");
  elements.forgotButton.classList.remove("pulse");
}

function makeButton(label, className, onClick, shortcut) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${className}`;
  button.textContent = label;
  if (shortcut) {
    const kbd = document.createElement("kbd");
    kbd.textContent = shortcut === "space" ? "空格" : shortcut;
    button.append(kbd);
  }
  button.addEventListener("click", onClick);
  if (label.includes("罗马音")) button.id = "romaji-button";
  if (label.includes("平假名")) button.id = "hiragana-button";
  if (label.includes("片假名")) button.id = "katakana-button";
  return button;
}

function revealAnswer(kanaOnly, clickedButton) {
  if (!current || transitionLocked) return;
  elements.answerPanel.hidden = false;
  elements.answerPanel.classList.add("is-visible");
  elements.practiceCard.classList.add("is-revealed");

  if (clickedButton) {
    clickedButton.disabled = true;
    clickedButton.classList.add("is-used");
    current.revealed ??= new Set();
    current.revealed.add(kanaOnly ?? "answer");
  }

  if (kanaOnly === "hiragana") {
    elements.answerValue.textContent = current.revealed?.has("katakana")
      ? `${current.item.hiragana}　${current.item.katakana}`
      : current.item.hiragana;
    elements.answerDetail.textContent = current.revealed?.has("katakana")
      ? "平假名 · 片假名"
      : "平假名 · 点击“显示片假名”查看另一种写法";
  } else if (kanaOnly === "katakana") {
    elements.answerValue.textContent = current.revealed?.has("hiragana")
      ? `${current.item.hiragana}　${current.item.katakana}`
      : current.item.katakana;
    elements.answerDetail.textContent = current.revealed?.has("hiragana")
      ? "平假名 · 片假名"
      : "片假名 · 点击“显示平假名”查看另一种写法";
  }
  elements.knownButton.classList.add("pulse");
  elements.forgotButton.classList.add("pulse");
}

function answer(result) {
  if (!current || transitionLocked) return;
  transitionLocked = true;
  elements.practiceCard.classList.add(result === "known" ? "is-known" : "is-forgot");
  elements.knownButton.disabled = true;
  elements.forgotButton.disabled = true;

  progress = recordAnswer(progress, current.item.id, result);
  saveProgress(progress);
  sessionCount += 1;
  elements.sessionCount.textContent = sessionCount;
  renderStats();
  showFeedback(result, current.item);

  window.setTimeout(() => {
    transitionLocked = false;
    nextQuestion();
  }, 260);

  const today = getDailyStats(progress);
  maybeShowMilestone(today);
}

function showFeedback(result, item) {
  elements.feedbackFlash.textContent = result === "known"
    ? `记住了 ${item.hiragana} · 出现概率已调低`
    : `${item.hiragana} 已记下 · 下次会更常出现`;
  elements.feedbackFlash.className = `feedback-flash show ${result}`;
  window.clearTimeout(showFeedback.timer);
  showFeedback.timer = window.setTimeout(() => {
    elements.feedbackFlash.className = "feedback-flash";
  }, 1300);
}

function maybeShowMilestone(today) {
  const shouldPrompt = today.answered > 0
    && today.answered % QUESTIONS_PER_MILESTONE === 0
    && milestoneShownFor !== today.answered;
  if (!shouldPrompt) return;
  milestoneShownFor = today.answered;
  elements.milestoneTotal.textContent = `${today.answered} 题`;
  elements.milestoneRate.textContent = formatRate(today.forgotRate);
  openModal(elements.milestoneModal);
}

function renderStats() {
  const today = getDailyStats(progress);
  const rate = formatRate(today.forgotRate);
  const cycleProgress = today.answered === 0
    ? 0
    : today.answered % QUESTIONS_PER_MILESTONE || QUESTIONS_PER_MILESTONE;

  elements.headerToday.textContent = `${today.answered} 题`;
  elements.headerForgotRate.textContent = rate;
  elements.ringCount.textContent = today.answered;
  elements.goalBadge.textContent = `${cycleProgress} / ${QUESTIONS_PER_MILESTONE}`;
  elements.knownToday.textContent = today.known;
  elements.forgotToday.textContent = today.forgot;
  elements.forgotRate.textContent = rate;
  elements.progressRing.style.setProperty("--progress", `${cycleProgress * (360 / QUESTIONS_PER_MILESTONE)}deg`);

  renderWeekChart();
  renderWeakList();
}

function renderWeekChart() {
  const days = getRecentDays(progress, 7);
  const max = Math.max(10, ...days.map((day) => day.answered));
  const weekday = ["日", "一", "二", "三", "四", "五", "六"];
  elements.weekChart.replaceChildren();

  days.forEach((day, index) => {
    const row = document.createElement("div");
    row.className = `week-row${index === days.length - 1 ? " is-today" : ""}`;
    const label = document.createElement("span");
    label.className = "week-label";
    label.textContent = index === days.length - 1 ? "今天" : `周${weekday[day.date.getDay()]}`;

    const bar = document.createElement("span");
    bar.className = "week-bar";
    const fill = document.createElement("span");
    fill.className = "week-bar-fill";
    fill.style.width = `${day.answered ? Math.max(10, (day.answered / max) * 100) : 0}%`;
    if (day.answered) fill.title = `${day.answered} 题，忘记 ${day.forgot} 题`;
    bar.append(fill);

    const count = document.createElement("strong");
    count.textContent = day.answered || "·";

    row.append(label, bar, count);
    elements.weekChart.append(row);
  });
}

function renderWeakList() {
  const weak = getWeakItems(progress, 5);
  elements.weakList.replaceChildren();
  if (!weak.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "练习几题后，这里会标出需要多看的假名。";
    elements.weakList.append(empty);
    return;
  }

  weak.forEach((entry, index) => {
    const item = KANA_BY_ID[entry.id];
    const row = document.createElement("div");
    row.className = "weak-row";
    row.innerHTML = `
      <span class="weak-rank">${String(index + 1).padStart(2, "0")}</span>
      <span class="weak-kana"><strong>${item.hiragana} · ${item.katakana}</strong><small>${item.romaji}</small></span>
      <span class="weak-count">忘 ${entry.forgot}<br>对 ${entry.known}</span>
    `;
    elements.weakList.append(row);
  });
}

function renderDataModal() {
  const days = Object.entries(progress.daily ?? {})
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 14);
  elements.dataTotal.textContent = progress.totalAnswered;
  elements.dataForgot.textContent = progress.totalForgot;
  elements.dataMastered.textContent = `${getMasteredCount(progress)}`;
  elements.dataTableBody.replaceChildren();

  if (!days.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="4" class="empty-table">还没有练习记录</td>';
    elements.dataTableBody.append(tr);
    return;
  }

  days.forEach(([key, day]) => {
    const tr = document.createElement("tr");
    const rate = day.answered ? Math.round((day.forgot / day.answered) * 100) : 0;
    tr.innerHTML = `<td>${key}</td><td>${day.answered}</td><td>${day.forgot}</td><td>${rate}%</td>`;
    elements.dataTableBody.append(tr);
  });
}

function formatRate(rate) {
  if (rate === null || rate === undefined) return "--";
  return `${Math.round(rate * 100)}%`;
}


function openModal(modal) {
  modal.hidden = false;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => {
    modal.classList.add("is-open");
    modal.querySelector("button")?.focus();
  });
}

function closeModal(modal, { keepBodyLock = false } = {}) {
  modal.classList.remove("is-open");
  window.setTimeout(() => {
    modal.hidden = true;
    if (!keepBodyLock) document.body.classList.remove("modal-open");
  }, 180);
}

function openSummary() {
  const today = getDailyStats(progress);
  elements.summaryTotal.textContent = `${today.answered} 题`;
  elements.summaryKnown.textContent = `${today.known} 题`;
  elements.summaryRate.textContent = formatRate(today.forgotRate);
  openModal(elements.summaryModal);
}

function openDataModal() {
  renderDataModal();
  openModal(elements.dataModal);
}

function bindEvents() {
  elements.knownButton.addEventListener("click", () => answer("known"));
  elements.forgotButton.addEventListener("click", () => answer("forgot"));

  document.querySelector("#continue-button").addEventListener("click", () => closeModal(elements.milestoneModal));
  document.querySelector("#finish-button").addEventListener("click", () => {
    closeModal(elements.milestoneModal, { keepBodyLock: true });
    window.setTimeout(openSummary, 190);
  });
  document.querySelector("#restart-button").addEventListener("click", () => closeModal(elements.summaryModal));
  document.querySelector("#close-summary-button").addEventListener("click", () => {
    closeModal(elements.summaryModal, { keepBodyLock: true });
    window.setTimeout(openDataModal, 190);
  });
  document.querySelector("#open-data-button").addEventListener("click", openDataModal);
  document.querySelector("#close-data-button").addEventListener("click", () => closeModal(elements.dataModal));
  document.querySelector("#close-data-footer-button").addEventListener("click", () => closeModal(elements.dataModal));
  document.querySelector("#reset-data-button").addEventListener("click", () => {
    if (!window.confirm("确定要清除全部练习记录和概率数据吗？此操作无法撤销。")) return;
    clearProgress();
    progress = loadProgress();
    sessionCount = 0;
    milestoneShownFor = null;
    elements.sessionCount.textContent = "0";
    renderStats();
    closeModal(elements.dataModal);
    showToast("学习数据已清除");
  });

  [elements.milestoneModal, elements.summaryModal, elements.dataModal].forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (elements.milestoneModal.hidden === false || elements.summaryModal.hidden === false || elements.dataModal.hidden === false) {
      if (event.key === "Escape") {
        if (!elements.milestoneModal.hidden) closeModal(elements.milestoneModal);
        if (!elements.summaryModal.hidden) closeModal(elements.summaryModal);
        if (!elements.dataModal.hidden) closeModal(elements.dataModal);
      }
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      const revealButton = elements.revealActions.querySelector("button:not(:disabled)");
      revealButton?.click();
    } else if (event.key === "1") {
      answer("forgot");
    } else if (event.key === "2") {
      answer("known");
    }
  });

  document.querySelector(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    nextQuestion();
  });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

bindEvents();
renderStats();
nextQuestion();
