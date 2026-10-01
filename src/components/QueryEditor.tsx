import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { SavedQuery } from "~/lib/api";

const ALL_MARKERS = [
  { marker: "LATER", label: "Бэклог" },
  { marker: "TODO", label: "К выполнению" },
  { marker: "DOING", label: "В работе" },
  { marker: "REVIEW", label: "На проверке" },
  { marker: "DONE", label: "Выполнено" },
  { marker: "CANCELED", label: "Отменено" },
];

export function QueryEditor(props: {
  query: SavedQuery | null;
  onClose: () => void;
  onSave: (q: SavedQuery) => void;
  onDelete: (title: string) => void;
}): JSX.Element {
  const isNew = () => props.query === null;
  const [draft, setDraft] = createSignal<SavedQuery>(
    props.query
      ? JSON.parse(JSON.stringify(props.query))
      : {
          title: "",
          filter: {
            open: false,
            status: [],
            page: null,
            pagePrefix: null,
            excludePage: null,
            tags: [],
            quadrant: null,
          },
          sort: [],
          collapsed: false,
        },
  );

  const toggleStatus = (marker: string) => {
    setDraft((d) => {
      const status = d.filter.status.includes(marker)
        ? d.filter.status.filter((s) => s !== marker)
        : [...d.filter.status, marker];
      return { ...d, filter: { ...d.filter, status } };
    });
  };

  const save = () => {
    const q = draft();
    if (!q.title.trim()) return;
    // пустые строки → null
    const clean: SavedQuery = {
      ...q,
      filter: {
        ...q.filter,
        page: q.filter.page?.trim() || null,
        pagePrefix: q.filter.pagePrefix?.trim() || null,
        excludePage: q.filter.excludePage?.trim() || null,
      },
    };
    props.onSave(clean);
    props.onClose();
  };

  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <header class="modal-head">
          <span class="modal-title">
            {isNew() ? "Новый запрос" : `Запрос «${props.query!.title}»`}
          </span>
          <button class="modal-close" onClick={props.onClose}>
            ✕
          </button>
        </header>

        <div class="modal-body">
          <label class="settings-row">
            <span class="settings-label">Название</span>
            <input
              class="status-label-input"
              placeholder="Сейчас"
              value={draft().title}
              onInput={(e) =>
                setDraft((d) => ({ ...d, title: e.currentTarget.value }))
              }
            />
          </label>

          <label class="settings-row">
            <span class="settings-label">Только открытые</span>
            <input
              type="checkbox"
              checked={draft().filter.open}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  filter: { ...d.filter, open: e.currentTarget.checked },
                }))
              }
            />
          </label>

          <label class="settings-row">
            <span class="settings-label">Страница (точно)</span>
            <input
              class="status-label-input"
              placeholder="Пример - TODO"
              value={draft().filter.page ?? ""}
              onInput={(e) =>
                setDraft((d) => ({
                  ...d,
                  filter: { ...d.filter, page: e.currentTarget.value },
                }))
              }
            />
          </label>

          <label class="settings-row">
            <span class="settings-label">Префикс страницы</span>
            <input
              class="status-label-input"
              placeholder="Проект -"
              value={draft().filter.pagePrefix ?? ""}
              onInput={(e) =>
                setDraft((d) => ({
                  ...d,
                  filter: { ...d.filter, pagePrefix: e.currentTarget.value },
                }))
              }
            />
          </label>

          <label class="settings-row">
            <span class="settings-label">Кроме страницы</span>
            <input
              class="status-label-input"
              placeholder="Проекты - TODO"
              value={draft().filter.excludePage ?? ""}
              onInput={(e) =>
                setDraft((d) => ({
                  ...d,
                  filter: { ...d.filter, excludePage: e.currentTarget.value },
                }))
              }
            />
          </label>

          <div class="settings-section">Статусы</div>
          <div class="block-menu-row">
            <For each={ALL_MARKERS}>
              {(s) => (
                <button
                  class="block-menu-item"
                  classList={{
                    active: draft().filter.status.includes(s.marker),
                  }}
                  onClick={() => toggleStatus(s.marker)}
                >
                  {s.label}
                </button>
              )}
            </For>
          </div>

          <label class="settings-row">
            <span class="settings-label">Свёрнут по умолчанию</span>
            <input
              type="checkbox"
              checked={draft().collapsed}
              onChange={(e) =>
                setDraft((d) => ({ ...d, collapsed: e.currentTarget.checked }))
              }
            />
          </label>
        </div>

        <footer class="modal-foot">
          <Show when={!isNew()}>
            <button
              class="btn danger-btn"
              onClick={() => {
                if (confirm(`Удалить запрос «${props.query!.title}»?`)) {
                  props.onDelete(props.query!.title);
                  props.onClose();
                }
              }}
            >
              Удалить
            </button>
          </Show>
          <div class="modal-foot-spacer" />
          <button class="btn" onClick={props.onClose}>
            Отмена
          </button>
          <button
            class="btn primary"
            disabled={!draft().title.trim()}
            onClick={save}
          >
            {isNew() ? "Создать" : "Сохранить"}
          </button>
        </footer>
      </div>
    </div>
  );
}
