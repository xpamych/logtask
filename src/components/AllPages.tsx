import { For } from "solid-js";
import type { JSX } from "solid-js";

/** Центральный вид «Все страницы»: список страниц графа со звёздочками */
export function AllPages(props: {
  pages: string[];
  favorites: string[];
  onOpenPage: (name: string) => void;
  onToggleFavorite: (name: string) => void;
}): JSX.Element {
  const isFav = (name: string) => props.favorites.includes(name);

  return (
    <main class="journal allpages">
      <h2 class="day-title">Все страницы ({props.pages.length})</h2>
      <div class="allpages-list">
        <For each={props.pages}>
          {(name) => (
            <div class="allpages-row">
              <button
                class="star-btn"
                classList={{ active: isFav(name) }}
                title={isFav(name) ? "Убрать из избранного" : "В избранное"}
                onClick={() => props.onToggleFavorite(name)}
              >
                {isFav(name) ? "★" : "☆"}
              </button>
              <button class="page-item allpages-link" onClick={() => props.onOpenPage(name)}>
                {name}
              </button>
            </div>
          )}
        </For>
      </div>
    </main>
  );
}
