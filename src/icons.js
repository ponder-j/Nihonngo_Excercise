import { BookOpenCheck, createElement, ChartNoAxesColumnIncreasing, Check, ChevronDown, RotateCcw, X } from "lucide";

const icons = { chart: ChartNoAxesColumnIncreasing, check: Check, "chevron-down": ChevronDown, reset: RotateCcw, close: X, review: BookOpenCheck };
export function icon(name) {
  return createElement(icons[name], { width: 18, height: 18, "stroke-width": 1.8, "aria-hidden": "true", focusable: "false" });
}
export function renderIcons() {
  document.querySelectorAll("[data-icon]").forEach((element) => element.replaceChildren(icon(element.dataset.icon)));
}
