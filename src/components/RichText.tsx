import { For } from "solid-js";
import type { JSX } from "solid-js";
import type { InlineSegment } from "~/lib/text";
import { parseInline, splitMdBlocks } from "~/lib/text";
import { AssetImage } from "./AssetImage";
import { CodeBlock } from "./CodeBlock";

/** Текст блока без md-разметки: [[ссылки]], #теги, **жирный**, *курсив*,
 *  ~~зачёркнутый~~, `код`, ^^подсветка^^, заголовки и блоки кода.
 *  Разметка видна только в режиме редактирования. Рендер — только
 *  JSX-сегменты, никакого innerHTML. */
export function RichText(props: {
  text: string;
  onOpenPage?: (name: string) => void;
}): JSX.Element {
  const blocks = () => splitMdBlocks(props.text.trim());

  const link = (seg: InlineSegment) => (
    <span
      class={seg.type === "link" ? "wikilink" : "hashtag"}
      title={props.onOpenPage ? `Открыть «${seg.target}»` : undefined}
      onClick={(e) => {
        if (!props.onOpenPage) return;
        e.stopPropagation();
        props.onOpenPage(seg.target ?? "");
      }}
    >
      {seg.text}
    </span>
  );

  const renderSegments = (segs: InlineSegment[]): JSX.Element => (
    <For each={segs}>
      {(seg) => {
        switch (seg.type) {
          case "image":
            return <AssetImage src={seg.target ?? ""} alt={seg.text} />;
          case "link":
          case "tag":
            return link(seg);
          case "bold":
            return <strong>{renderSegments(seg.children ?? [])}</strong>;
          case "italic":
            return <em>{renderSegments(seg.children ?? [])}</em>;
          case "strike":
            return <s>{renderSegments(seg.children ?? [])}</s>;
          case "code":
            return <code class="md-code">{seg.text}</code>;
          case "highlight":
            return <mark class="md-highlight">{renderSegments(seg.children ?? [])}</mark>;
          default:
            return seg.text;
        }
      }}
    </For>
  );

  return (
    <For each={blocks()}>
      {(blk) => {
        if (blk.kind === "code") {
          return <CodeBlock text={blk.text} lang={blk.lang} />;
        }
        if (blk.kind === "heading") {
          return (
            <span class={`md-line md-h md-h${blk.level}`}>
              {renderSegments(parseInline(blk.text))}
            </span>
          );
        }
        return <span class="md-line">{renderSegments(parseInline(blk.text))}</span>;
      }}
    </For>
  );
}
