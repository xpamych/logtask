import { For, Show, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { InlineSegment } from "~/lib/text";
import { parseInline, splitMdBlocks } from "~/lib/text";
import { faviconDataUrl, openExternal, webTitle } from "~/lib/api";
import { AssetImage } from "./AssetImage";
import { CodeBlock } from "./CodeBlock";
import { IconLink } from "./icons";

/** Favicon домена ссылки: грузится в Rust (webview https не может);
 *  если иконки нет — запасной значок-цепочка */
function FavIcon(props: { url: string }): JSX.Element {
  const [src, setSrc] = createSignal<string | null>(null);
  onMount(async () => {
    try {
      setSrc(await faviconDataUrl(props.url));
    } catch {
      setSrc(null);
    }
  });
  return (
    <Show
      when={src()}
      fallback={
        <span class="extlink-icon">
          <IconLink size={12} />
        </span>
      }
    >
      {(s) => <img class="favicon" src={s()} alt="" />}
    </Show>
  );
}

/** Голый URL: показываем заголовок страницы (подтягивается из <title>),
 *  пока грузится или недоступен — сам URL */
function BareUrlText(props: { url: string }): JSX.Element {
  const [title, setTitle] = createSignal<string | null>(null);
  onMount(async () => {
    try {
      setTitle(await webTitle(props.url));
    } catch {
      /* фолбэк — сам URL */
    }
  });
  return <>{title() ?? props.url}</>;
}

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
          case "url":
            return (
              <span
                class="extlink"
                title={`Открыть в браузере: ${seg.target}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void openExternal(seg.target ?? "");
                }}
              >
                <FavIcon url={seg.target ?? ""} />
                {seg.text === seg.target ? (
                  <BareUrlText url={seg.target ?? ""} />
                ) : (
                  seg.text
                )}
              </span>
            );
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
