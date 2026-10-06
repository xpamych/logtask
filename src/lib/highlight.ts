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
  return lowlight.highlightAuto(code) as HastRoot;
}
