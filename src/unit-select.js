import { icon } from "./icons.js";

// A DOM listbox fits the existing vanilla application; no framework migration.
export function createUnitSelect({ root, onChange }) {
  const trigger = root.querySelector("[role='combobox']");
  const label = root.querySelector(".unit-select-value");
  const menu = root.querySelector("[role='listbox']");
  let items = [];
  let selectedId;
  let search = "";
  let searchTime = 0;
  const options = () => [...menu.children];
  function close(restoreFocus = false) {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  }
  function focus(index) {
    const option = options()[Math.max(0, Math.min(index, items.length - 1))];
    option?.focus();
    option?.scrollIntoView?.({ block: "nearest" });
  }
  function open(index = items.findIndex((item) => item.id === selectedId)) {
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    focus(index);
  }
  function choose(id) {
    close(true);
    if (id !== selectedId) onChange(id);
  }
  trigger.addEventListener("click", () => menu.hidden ? open() : close());
  trigger.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      open(event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : undefined);
    }
  });
  menu.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    const index = options().indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      focus(event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1));
    } else if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (items[index]) choose(items[index].id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") close();
    else if (event.key.length === 1) {
      event.stopPropagation();
      search = Date.now() - searchTime > 700 ? event.key : search + event.key;
      searchTime = Date.now();
      const match = items.findIndex((item) => item.name.toLowerCase().startsWith(search.toLowerCase()));
      if (match >= 0) focus(match);
    }
  });
  document.addEventListener("pointerdown", (event) => { if (!root.contains(event.target)) close(); });
  root.addEventListener("focusout", () => queueMicrotask(() => { if (!root.contains(document.activeElement)) close(); }));
  return {
    close,
    render(nextItems, activeId) {
      close();
      items = nextItems;
      selectedId = activeId;
      label.textContent = items.find((item) => item.id === activeId)?.name || "选择单元";
      menu.replaceChildren();
      items.forEach((item) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "unit-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(item.id === activeId));
        option.tabIndex = -1;
        // Safari does not always focus clicked options. Keep the list open until
        // the click selects a value instead of closing it on pointer blur.
        option.addEventListener("pointerdown", (event) => event.preventDefault());
        const copy = document.createElement("span");
        copy.textContent = item.name;
        option.append(copy);
        if (item.id === activeId) option.append(icon("check"));
        option.addEventListener("click", () => choose(item.id));
        menu.append(option);
      });
    },
  };
}
