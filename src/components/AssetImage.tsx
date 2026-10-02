import { Show, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { assetDataUrl } from "~/lib/api";

/** Картинка из графа (или внешняя по http): грузится лениво через IPC */
export function AssetImage(props: { src: string; alt: string }): JSX.Element {
  const [url, setUrl] = createSignal<string | null>(null);
  const [failed, setFailed] = createSignal(false);

  onMount(async () => {
    if (/^https?:\/\//.test(props.src)) {
      setUrl(props.src);
      return;
    }
    try {
      setUrl(await assetDataUrl(props.src));
    } catch (e) {
      console.warn("картинка не загрузилась:", props.src, e);
      setFailed(true);
    }
  });

  return (
    <Show
      when={url()}
      fallback={
        <span class="md-image-placeholder">
          {failed() ? `🖼 ${props.alt || props.src}` : "🖼 …"}
        </span>
      }
    >
      {(u) => <img class="md-image" src={u()} alt={props.alt} />}
    </Show>
  );
}
