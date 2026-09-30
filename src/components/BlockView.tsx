import type { JSX } from "solid-js";
import { parseSegments } from "~/lib/text";
import type { BlockDto } from "~/lib/api";

const STATUS_COLORS: Record<string, string> = {
  LATER: "#8ba8b5",
  TODO: "#106ba3",
  DOING: "#d9822b",
  REVIEW: "#8a6d3b",
  DONE: "#3d8a4e",
  CANCELED: "#a05252",
};

const QUADRANT_HINT: Record<string, string> = {
  high: "▲",
  medium: "◆",
  low: "·",
};

export function BlockView(props: {
  block: BlockDto;
  onOpenPage?: (name: string) => void;
}): JSX.Element {
  const b = props.block;
  const onOpen = props.onOpenPage;

  const segments = () => parseSegments(b.content.trim());

  return (
    <div
      class="block"
      classList={{ "block-task": b.task }}
      style={{ "padding-left": `${10 + b.indent * 22}px` }}
    >
      <span
        class="status-dot"
        style={{
          background: b.status ? (STATUS_COLORS[b.status] ?? "#666") : "transparent",
          visibility: b.status ? "visible" : "hidden",
        }}
        title={b.statusLabel ?? b.status ?? ""}
      />
      <div class="block-content">
        {segments().map((seg) => {
          if (seg.type === "link" || seg.type === "tag") {
            return (
              <button
                class={seg.type === "link" ? "wikilink" : "hashtag"}
                title={`Открыть «${seg.target}»`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen?.(seg.target ?? "");
                }}
              >
                {seg.type === "link" ? `[[${seg.text}]]` : seg.text}
              </button>
            );
          }
          return <span>{seg.text}</span>;
        })}
      </div>
      {(b.urgency || b.importance) && (
        <span class="quad-hint" title={`срочность: ${b.urgency ?? "-"}, важность: ${b.importance ?? "-"}`}>
          {b.urgency && QUADRANT_HINT[b.urgency]}{b.importance && QUADRANT_HINT[b.importance]}
        </span>
      )}
      {b.priority && <span class="priority-badge">{b.priority}</span>}
    </div>
  );
}
