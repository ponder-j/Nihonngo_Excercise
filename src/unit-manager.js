import { kanaItems } from "./kana.js";
import { KANA_UNIT_ID, WORD_FIELDS, createId, isBlankWord, validateUnit, validateWord } from "./units.js";
import { clearProgress, saveUnits } from "./store.js";
import { confirmAction } from "./confirm.js";

export function createUnitManager({ getUnits, onChange, onPractice, showToast, persistUnits = saveUnits, getImports = () => [], discardImport, savedMessage = "单元和词库已保存" }) {
  const list = document.querySelector("#unit-list");
  const form = document.querySelector("#unit-form");
  const title = document.querySelector("#unit-name");
  const rows = document.querySelector("#word-rows");
  const status = document.querySelector("#editor-status");
  const count = document.querySelector("#editor-word-count");
  const builtIn = document.querySelector("#builtin-unit-info");
  const deleteButton = document.querySelector("#delete-unit-button");
  const practiceButton = document.querySelector("#practice-unit-button");
  const saveButton = document.querySelector("#save-unit-button");
  const reviewInfo = document.querySelector("#import-review-info");
  let editingId = KANA_UNIT_ID;
  let editingImportId = null;
  let dirty = false;
  let saving = false;

  function setSaving(value) {
    saving = value;
    form.inert = value;
    saveButton.disabled = value;
    deleteButton.disabled = value;
    practiceButton.disabled = value;
    saveButton.textContent = value ? "正在保存…" : editingImportId ? "确认并保存单元" : "保存单元";
  }

  function setStatus(message = "", error = false) {
    status.textContent = message;
    status.classList.toggle("is-error", error);
  }

  function setDirty() {
    dirty = true;
    setStatus("有未保存的修改");
    updateCount();
  }

  function updateCount() {
    const total = [...rows.children].filter((row) => !isBlankWord(readRow(row))).length;
    count.textContent = `${total} 个单词`;
  }

  async function canLeave() {
    if (saving) return false;
    if (!dirty) return true;
    if (!(await confirmAction("当前词库有未保存的修改。离开后，这些修改不会保存。", { title: "放弃未保存的修改？", confirmLabel: "放弃修改" }))) return false;
    dirty = false;
    return true;
  }

  function renderList() {
    list.replaceChildren();
    getUnits().forEach((unit) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `unit-list-item${unit.id === editingId ? " is-selected" : ""}`;
      button.setAttribute("aria-current", unit.id === editingId ? "true" : "false");
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = unit.name;
      const detail = document.createElement("small");
      detail.textContent = unit.kind === "kana" ? "内置单元 · 71 个假名" : `${unit.words.length} 个单词`;
      copy.append(name, detail);
      button.append(copy);
      button.addEventListener("click", async () => {
        if (unit.id !== editingId && await canLeave()) edit(unit.id);
      });
      list.append(button);
    });
    const importList = document.querySelector("#import-list");
    importList.replaceChildren();
    const drafts = getImports();
    document.querySelector("#imports-section").hidden = drafts.length === 0;
    drafts.forEach((draft) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `unit-list-item${draft.id === editingImportId ? " is-selected" : ""}`;
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = draft.unit.name;
      const detail = document.createElement("small");
      detail.textContent = `${draft.unit.words.length} 个单词 · 待审核`;
      copy.append(name, detail);
      button.append(copy);
      button.addEventListener("click", async () => {
        if (draft.id !== editingImportId && await canLeave()) edit(draft.unit.id, draft.id);
      });
      importList.append(button);
    });
  }

  function readRow(row) {
    return { id: row.dataset.id, ...Object.fromEntries(WORD_FIELDS.map(({ key }) => [key, row.querySelector(`[data-field="${key}"]`).value])) };
  }

  function refreshNumbers() {
    [...rows.children].forEach((row, index) => {
      row.querySelector(".word-number").textContent = String(index + 1).padStart(2, "0");
      WORD_FIELDS.forEach(({ key, label }) => row.querySelector(`[data-field="${key}"]`).setAttribute("aria-label", `第 ${index + 1} 行${label}`));
    });
    updateCount();
  }

  function appendRow(word = {}, committed = false) {
    const row = document.createElement("div");
    row.className = `word-row${committed ? " is-committed" : ""}`;
    row.dataset.id = word.id || createId("word");
    const number = document.createElement("span");
    number.className = "word-number";
    number.title = committed ? "已保存" : "待录入";
    row.append(number);
    WORD_FIELDS.forEach(({ key, label, placeholder, lang, inputMode }) => {
      const wrap = document.createElement("label");
      wrap.className = `word-field word-field-${key}`;
      const caption = document.createElement("span");
      caption.className = "word-mobile-label";
      caption.textContent = label;
      const input = document.createElement("input");
      input.type = "text";
      input.dataset.field = key;
      input.placeholder = placeholder;
      input.value = word[key] ?? "";
      input.autocomplete = "off";
      input.spellcheck = false;
      if (lang) input.lang = lang;
      if (inputMode) input.inputMode = inputMode;
      input.addEventListener("input", () => {
        input.setCustomValidity("");
        row.classList.remove("is-committed", "has-error");
        number.title = "未保存";
        setDirty();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing || event.keyCode === 229 || event.repeat) return;
        event.preventDefault();
        confirmRow(row);
      });
      wrap.append(caption, input);
      row.append(wrap);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "word-delete";
    remove.textContent = "删除";
    remove.setAttribute("aria-label", "删除此单词");
    remove.addEventListener("click", () => {
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      if (!rows.children.length) appendRow();
      refreshNumbers();
      setDirty();
      (next || rows.firstElementChild).querySelector("input").focus();
    });
    row.append(remove);
    rows.append(row);
    refreshNumbers();
    return row;
  }

  function showRowError(row, result) {
    row.classList.add("has-error");
    setStatus(result.message, true);
    const input = row.querySelector(`[data-field="${result.field}"]`) || row.querySelector("input");
    input.setCustomValidity(result.message);
    input.focus();
    input.reportValidity();
  }

  function confirmRow(row) {
    const result = validateWord(readRow(row));
    if (!result.valid) return showRowError(row, result);
    WORD_FIELDS.forEach(({ key }) => {
      const input = row.querySelector(`[data-field="${key}"]`);
      input.value = result.word[key];
      input.setCustomValidity("");
    });
    row.classList.remove("has-error");
    row.classList.add("is-committed");
    row.querySelector(".word-number").title = "已确认，点击保存单元后写入词库";
    dirty = true;
    setStatus("此行已确认，继续输入。完成后点击「保存单元」。");
    const next = row.nextElementSibling || appendRow();
    next.querySelector("input").focus();
    updateCount();
  }

  function edit(unitId, importId = null) {
    const imported = importId ? getImports().find((draft) => draft.id === importId) : null;
    const unit = imported?.unit || getUnits().find((entry) => entry.id === unitId);
    const isKana = unit?.kind === "kana";
    editingId = unitId;
    editingImportId = imported?.id || null;
    dirty = false;
    setStatus();
    form.hidden = isKana;
    builtIn.hidden = !isKana;
    deleteButton.hidden = !unit || isKana;
    practiceButton.hidden = !unit || Boolean(imported);
    saveButton.textContent = imported ? "确认并保存单元" : "保存单元";
    document.querySelector("#editor-title").textContent = imported ? "审核导入词库" : isKana ? "假名练习单元" : unit ? "编辑课程词库" : "添加新单元";
    reviewInfo.hidden = !imported;
    reviewInfo.replaceChildren();
    if (imported) {
      const copy = document.createElement("p");
      copy.textContent = `请核对后保存。${imported.source ? `来源：${imported.source}` : ""}`;
      reviewInfo.append(copy);
      const notes = [...imported.notes, ...imported.issues];
      if (notes.length) {
        const items = document.createElement("ul");
        notes.forEach((note) => {
          const item = document.createElement("li");
          item.textContent = `第 ${note.row} 行：${note.message}`;
          items.append(item);
        });
        reviewInfo.append(items);
      }
    }
    rows.replaceChildren();
    title.value = unit?.name ?? "";
    title.setCustomValidity("");
    if (!isKana) {
      (unit?.words ?? []).forEach((word) => appendRow(word, !imported));
      appendRow();
    } else {
      count.textContent = "71 个假名";
    }
    renderList();
  }

  async function save() {
    if (saving) return false;
    const draft = { id: editingId, name: title.value, words: [...rows.children].map(readRow) };
    const result = validateUnit(draft);
    if (!result.valid) {
      if (result.field === "name") {
        setStatus(result.message, true);
        title.setCustomValidity(result.message);
        title.focus();
        title.reportValidity();
      } else {
        showRowError(rows.children[result.row], result);
      }
      return false;
    }
    const units = getUnits();
    const exists = units.some((unit) => unit.id === editingId);
    const next = exists ? units.map((unit) => unit.id === editingId ? result.unit : unit) : [...units, result.unit];
    setSaving(true);
    try {
      const saved = await persistUnits(next, { importId: editingImportId });
      if (!saved) throw new Error("浏览器存储不可用或空间不足");
      dirty = false;
      onChange(Array.isArray(saved) ? saved : next, editingId);
      edit(editingId);
      setStatus(`已保存 ${result.unit.words.length} 个单词`);
      showToast(savedMessage);
      return true;
    } catch (error) {
      setStatus(`保存失败：${error.message}。输入内容仍保留。`, true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  title.addEventListener("input", () => {
    title.setCustomValidity("");
    setDirty();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save();
  });
  form.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && event.target === title) {
      event.preventDefault();
      rows.querySelector("input")?.focus();
    }
  });
  document.querySelector("#new-unit-button").addEventListener("click", async () => {
    if (!(await canLeave())) return;
    edit(createId("unit"));
    title.focus();
  });
  document.querySelector("#add-word-button").addEventListener("click", () => {
    const last = rows.lastElementChild;
    const row = last && isBlankWord(readRow(last)) ? last : appendRow();
    row.querySelector("input").focus();
  });
  deleteButton.addEventListener("click", async () => {
    if (saving) return;
    if (editingImportId) {
      if (!(await confirmAction("丢弃后将移除这份待审核词库。", { title: "丢弃导入草稿？", confirmLabel: "丢弃草稿" }))) return;
      setSaving(true);
      try {
        const next = await discardImport(editingImportId);
        dirty = false;
        onChange(next, KANA_UNIT_ID);
        edit(KANA_UNIT_ID);
      } catch (error) { setStatus(error.message, true); }
      finally { setSaving(false); }
      return;
    }
    const unit = getUnits().find((entry) => entry.id === editingId);
    if (!unit || unit.kind === "kana") return;
    if (!(await confirmAction(`删除「${unit.name}」后，该单元的词库和练习记录将无法恢复。`, { title: "删除这个单元？", confirmLabel: "删除单元" }))) return;
    const next = getUnits().filter((entry) => entry.id !== editingId);
    setSaving(true);
    try {
      const saved = await persistUnits(next);
      if (!saved) throw new Error("存储不可用");
      clearProgress(editingId);
      dirty = false;
      onChange(Array.isArray(saved) ? saved : next, KANA_UNIT_ID);
      edit(KANA_UNIT_ID);
      showToast("单元已删除");
    } catch (error) { setStatus(`删除失败：${error.message}`, true); }
    finally { setSaving(false); }
  });
  practiceButton.addEventListener("click", async () => {
    if (saving || (dirty && !(await save()))) return;
    onPractice(editingId);
  });
  window.addEventListener("beforeunload", (event) => {
    if (!dirty && !saving) return;
    event.preventDefault();
    event.returnValue = "";
  });

  const kanaGrid = document.querySelector("#builtin-kana-grid");
  kanaItems.forEach((item) => {
    const chip = document.createElement("span");
    chip.textContent = `${item.hiragana} ${item.katakana}`;
    chip.title = item.romaji;
    kanaGrid.append(chip);
  });

  return { open: edit, canLeave };
}
