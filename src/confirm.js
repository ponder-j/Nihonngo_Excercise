export function confirmAction(message, { title = "确认操作", confirmLabel = "确认" } = {}) {
  const dialog = document.querySelector("#confirm-dialog");
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  const accept = document.querySelector("#confirm-accept");
  const cancel = document.querySelector("#confirm-cancel");
  accept.textContent = confirmLabel;

  return new Promise((resolve) => {
    function finish(confirmed) {
      accept.removeEventListener("click", onAccept);
      cancel.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onEscape);
      dialog.close();
      resolve(confirmed);
    }
    function onAccept() { finish(true); }
    function onCancel() { finish(false); }
    function onEscape(event) {
      event.preventDefault();
      finish(false);
    }
    accept.addEventListener("click", onAccept);
    cancel.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onEscape);
    dialog.showModal();
    cancel.focus();
  });
}
