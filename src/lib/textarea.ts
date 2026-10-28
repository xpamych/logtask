export function fitTextarea(el: HTMLTextAreaElement): void {
  el.style.overflow = "hidden";
  if (typeof CSS !== "undefined" && CSS.supports("field-sizing", "content")) {
    el.style.setProperty("field-sizing", "content");
    el.style.height = "auto";
    return;
  }
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export function setTextareaValue(el: HTMLTextAreaElement, value: string): void {
  el.value = value;
  fitTextarea(el);
}
