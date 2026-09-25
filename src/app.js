import "./styles.css";
import { KANA_BY_ID } from "./kana.js";
import { recognizeKana } from "./ocr.js";
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
import {
  getValidationFields,
  matchesValidationAnswer,
  MAX_HANDWRITING_ATTEMPTS,
  MAX_ROMAJI_ATTEMPTS,
} from "./validation.js";

const elements = {
  practiceCard: document.querySelector("#practice-card"),
  validationMode: document.querySelector("#validation-mode"),
  modeLabel: document.querySelector("#mode-label"),
  scriptTag: document.querySelector("#script-tag"),
  prompt: document.querySelector("#prompt"),
  promptHint: document.querySelector("#prompt-hint"),
  answerPanel: document.querySelector("#answer-panel"),
  answerLabel: document.querySelector(".answer-label"),
  answerValue: document.querySelector("#answer-value"),
  answerDetail: document.querySelector("#answer-detail"),
  revealActions: document.querySelector("#reveal-actions"),
  validationArea: document.querySelector("#validation-area"),
  judgementActions: document.querySelector("#judgement-actions"),
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
  current = { item, ...prompt, validation: createValidationState(prompt, item) };
  renderQuestion();
}

function createValidationState(prompt, item) {
  return {
    fields: Object.fromEntries(
      getValidationFields(prompt, item).map((field) => [field.id, {
        ...field,
        attempts: 0,
        status: "pending",
        canvas: null,
        input: null,
        checkButton: null,
        statusNode: null,
      }]),
    ),
    hadMistake: false,
    busy: false,
  };
}

function renderQuestion() {
  const { item, direction, script } = current;
  const kana = script === "hiragana" ? item.hiragana : item.katakana;

  elements.answerPanel.hidden = true;
  elements.answerPanel.classList.remove("is-visible");
  elements.practiceCard.classList.remove("is-revealed", "is-forgot", "is-known");
  elements.validationArea.hidden = !elements.validationMode.checked;
  elements.revealActions.hidden = elements.validationMode.checked;
  elements.judgementActions.hidden = elements.validationMode.checked;
  if (elements.validationMode.checked) {
    renderValidationArea();
    return;
  }

  elements.validationArea.replaceChildren();
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

function renderValidationArea() {
  elements.validationArea.replaceChildren();
  const validation = current.validation;
  const fields = Object.values(validation.fields);
  const intro = document.createElement("div");
  intro.className = "validation-intro";
  intro.innerHTML = `
    <div>
      <span class="eyebrow">主动回忆</span>
      <strong>写出答案，再检查</strong>
    </div>
    <span class="validation-limit">手写最多 ${MAX_HANDWRITING_ATTEMPTS} 次 · 罗马音 1 次</span>
  `;
  elements.validationArea.append(intro);

  const fieldGrid = document.createElement("div");
  fieldGrid.className = `validation-fields validation-fields-${fields.length}`;
  fields.forEach((field) => fieldGrid.append(createValidationField(field)));
  elements.validationArea.append(fieldGrid);

  const abandon = document.createElement("button");
  abandon.type = "button";
  abandon.className = "text-button validation-abandon";
  abandon.textContent = "这题先跳过";
  abandon.addEventListener("click", () => finishValidation("forgot"));
  elements.validationArea.append(abandon);
}

function toggleValidationMode() {
  if (elements.validationMode.checked) {
    current.validation = createValidationState(current, current.item);
  }
  renderQuestion();
}

function createValidationField(field) {
  const article = document.createElement("article");
  article.className = "validation-field";
  article.dataset.field = field.id;

  const header = document.createElement("div");
  header.className = "validation-field-header";
  const label = document.createElement("strong");
  label.textContent = field.label;
  const attempts = document.createElement("span");
  attempts.className = "validation-attempts";
  attempts.textContent = `0 / ${field.kind === "handwriting" ? MAX_HANDWRITING_ATTEMPTS : MAX_ROMAJI_ATTEMPTS}`;
  header.append(label, attempts);
  article.append(header);

  if (field.kind === "handwriting") {
    const board = document.createElement("div");
    board.className = "draw-board";
    const canvas = document.createElement("canvas");
    canvas.className = "draw-canvas";
    canvas.width = 640;
    canvas.height = 360;
    canvas.setAttribute("aria-label", `手写${field.label}`);
    board.append(canvas);

    const placeholder = document.createElement("span");
    placeholder.className = "draw-placeholder";
    placeholder.textContent = `在这里写${field.label}`;
    board.append(placeholder);

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "canvas-clear";
    clearButton.textContent = "↺";
    clearButton.title = "清空笔迹";
    clearButton.setAttribute("aria-label", "清空笔迹");
    board.append(clearButton);
    article.append(board);

    const drawState = { drawing: false, hasInk: false };
    prepareCanvas(canvas);
    bindCanvas(canvas, drawState, placeholder);
    clearButton.addEventListener("click", () => clearCanvas(canvas, drawState, placeholder));
    field.canvas = canvas;
    field.drawState = drawState;
  } else {
    const inputWrap = document.createElement("label");
    inputWrap.className = "romaji-input-wrap";
    inputWrap.innerHTML = '<span class="input-prefix">↳</span>';
    const input = document.createElement("input");
    input.type = "text";
    input.className = "romaji-input";
    input.placeholder = "输入罗马音";
    input.autocomplete = "off";
    input.autocapitalize = "none";
    input.spellcheck = false;
    input.setAttribute("aria-label", "输入罗马音");
    inputWrap.append(input);
    article.append(inputWrap);
    field.input = input;
  }

  const footer = document.createElement("div");
  footer.className = "validation-field-footer";
  const status = document.createElement("span");
  status.className = "validation-status";
  status.textContent = field.kind === "handwriting" ? "等待识别" : "等待检查";
  const checkButton = document.createElement("button");
  checkButton.type = "button";
  checkButton.className = "button button-check";
  checkButton.textContent = field.kind === "handwriting" ? "识别并检查" : "检查";
  checkButton.addEventListener("click", () => submitValidationField(field));
  footer.append(status, checkButton);
  article.append(footer);
  field.statusNode = status;
  field.checkButton = checkButton;
  return article;
}

function prepareCanvas(canvas) {
  const context = canvas.getContext("2d");
  context.fillStyle = "#fffdf8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#202735";
  context.lineWidth = 18;
  context.lineCap = "round";
  context.lineJoin = "round";
}

function canvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function bindCanvas(canvas, drawState, placeholder) {
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const point = canvasPoint(canvas, event);
    const context = canvas.getContext("2d");
    drawState.drawing = true;
    drawState.hasInk = true;
    placeholder.hidden = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawState.drawing) return;
    event.preventDefault();
    const point = canvasPoint(canvas, event);
    const context = canvas.getContext("2d");
    context.lineTo(point.x, point.y);
    context.stroke();
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
    canvas.addEventListener(eventName, () => {
      drawState.drawing = false;
    });
  });
}

function clearCanvas(canvas, drawState, placeholder) {
  prepareCanvas(canvas);
  drawState.hasInk = false;
  drawState.drawing = false;
  placeholder.hidden = false;
}

async function submitValidationField(field) {
  if (!current || transitionLocked || current.validation.busy || field.status !== "pending") return;
  if (field.kind === "handwriting" && !field.drawState.hasInk) {
    setValidationStatus(field, "请先写一个假名", "error");
    return;
  }

  current.validation.busy = true;
  field.checkButton.disabled = true;
  setValidationStatus(field, field.kind === "handwriting" ? "正在识别…" : "正在检查…", "busy");

  try {
    const value = field.kind === "handwriting"
      ? (await recognizeKana(field.canvas, updateOcrStatus(field))).text
      : field.input.value;
    field.attempts += 1;
    updateValidationAttempts(field);
    const correct = matchesValidationAnswer(value, field);
    if (correct) {
      field.status = "correct";
      setValidationStatus(field, "正确", "correct");
      lockValidationField(field);
    } else {
      current.validation.hadMistake = true;
      if (field.attempts >= (field.kind === "handwriting" ? MAX_HANDWRITING_ATTEMPTS : MAX_ROMAJI_ATTEMPTS)) {
        field.status = "failed";
        setValidationStatus(field, `不对，答案是 ${field.expected}`, "error");
        lockValidationField(field);
      } else {
        setValidationStatus(field, "没识别对，再试一次", "error");
        field.checkButton.disabled = false;
        if (field.kind === "handwriting") clearCanvas(field.canvas, field.drawState, field.canvas.parentElement.querySelector(".draw-placeholder"));
        else field.input.select();
      }
    }
    maybeFinishValidation();
  } catch (error) {
    console.error("Kana OCR failed", error);
    setValidationStatus(field, "识别模型加载失败，请重试", "error");
    field.checkButton.disabled = false;
  } finally {
    current.validation.busy = false;
  }
}

function updateOcrStatus(field) {
  return (message) => {
    const percent = message.progress ? ` ${Math.round(message.progress * 100)}%` : "";
    if (message.status === "loading language traineddata") setValidationStatus(field, `下载日语模型…${percent}`, "busy");
    else if (message.status === "recognizing text") setValidationStatus(field, `识别中…${percent}`, "busy");
  };
}

function updateValidationAttempts(field) {
  const row = field.checkButton.closest(".validation-field");
  const attempts = row.querySelector(".validation-attempts");
  attempts.textContent = `${field.attempts} / ${field.kind === "handwriting" ? MAX_HANDWRITING_ATTEMPTS : MAX_ROMAJI_ATTEMPTS}`;
}

function setValidationStatus(field, text, state) {
  field.statusNode.textContent = text;
  field.statusNode.className = `validation-status ${state}`;
}

function lockValidationField(field) {
  field.checkButton.disabled = true;
  if (field.input) field.input.disabled = true;
  if (field.canvas) {
    field.canvas.classList.add("is-locked");
    field.canvas.style.pointerEvents = "none";
  }
  field.checkButton.closest(".validation-field").classList.add(`is-${field.status}`);
}

function maybeFinishValidation() {
  const fields = Object.values(current.validation.fields);
  if (fields.every((field) => field.status !== "pending")) {
    finishValidation(current.validation.hadMistake ? "forgot" : "known");
  }
}

function finishValidation(result) {
  if (!current || transitionLocked) return;
  answer(result);
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
  elements.validationMode.addEventListener("change", toggleValidationMode);

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

    if (elements.validationMode.checked) {
      if (event.key === "Enter" && event.target.closest(".validation-field")) {
        event.preventDefault();
        event.target.closest(".validation-field").querySelector(".button-check")?.click();
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
