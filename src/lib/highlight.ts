import { createLowlight, common } from "lowlight";

/** Минимальные типы дерева hast (чтобы не тянуть типы транзитивного пакета) */
export type HastText = { type: "text"; value: string };
export type HastElement = {
  type: "element";
  tagName: string;
  properties?: { className?: string[] };
  children: HastNode[];
};
export type HastNode = HastText | HastElement | { type: string };
export type HastRoot = { children: HastNode[] };

const lowlight = createLowlight(common);

/** Подсветка кода: язык из ограждения, иначе автоопределение.
 *  Незнакомый язык — автоопределение, полностью оффлайн. */
export function highlightCode(code: string, lang?: string): HastRoot {
  if (lang && lowlight.registered(lang)) {
    try {
      return lowlight.highlight(lang, code) as HastRoot;
    } catch {
      // грамматика упала — пробуем автоопределение
    }
  }
  const auto = lowlight.highlightAuto(code) as HastRoot;
  // автоопределение может не распознать язык (relevance 0) и вернуть
  // пустое дерево — показываем код как есть, без подсветки,
  // иначе блок кода «исчезает» из рендера
  if (auto.children.length === 0 && code.trim()) {
    return { children: [{ type: "text", value: code }] };
  }
  return auto;
}
