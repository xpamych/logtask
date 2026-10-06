import { For } from "solid-js";
import type { JSX } from "solid-js";
import { highlightCode } from "~/lib/highlight";
import type { HastElement, HastNode, HastText } from "~/lib/highlight";

/** Блок кода с подсветкой (highlight.js оффлайн): дерево hast → JSX-спаны,
 *  без innerHTML — пользовательский текст нигде не интерпретируется как HTML */
export function CodeBlock(props: { text: string; lang?: string }): JSX.Element {
  const tree = () => highlightCode(props.text, props.lang);

  const renderNode = (node: HastNode): JSX.Element => {
    if (node.type === "text") return (node as HastText).value;
    if (node.type === "element") {
      const el = node as HastElement;
      return (
        <span class={el.properties?.className?.join(" ") || undefined}>
          <For each={el.children}>{(c) => renderNode(c)}</For>
        </span>
      );
    }
    return null;
  };

  return (
    <span class="md-pre hljs">
      <For each={tree().children}>{(c) => renderNode(c)}</For>
    </span>
  );
}
