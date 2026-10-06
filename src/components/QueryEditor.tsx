import { For, Show, createSignal } from "solid-js";
import { IconX } from "~/components/icons";
import type { JSX } from "solid-js";
import type { SavedQuery, Settings } from "~/lib/api";

const QUADRANTS = [
  { key: "do", label: "Сделать (срочно и важно)" },
  { key: "schedule", label: "Запланировать (важно, не срочно)" },
  { key: "delegate", label: "Делегировать (срочно, не важно)" },
  { key: "drop", label: "Отбросить (ни то, ни другое)" },
];

export function QueryEditor(props: {
  query: SavedQuery | null;
  settings?: Settings | null;
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
            open: true,
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

  // текстовое поле тегов ↔ массив фильтра
  const [tagsText, setTagsText] = createSignal(
    (props.query?.filter.tags ?? []).join(", "),
  );

  const statuses = () =>
    props.settings?.statuses.length
      ? props.settings.statuses
      : [
          { marker: "LATER", label: "Бэклог" },
          { marker: "TODO", label: "К выполнению" },
          { marker: "DOING", label: "В работе" },
          { marker: "REVIEW", label: "На проверке" },
          { marker: "DONE", label: "Выполнено" },
          { marker: "CANCELED", label: "Отменено" },
        ];

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
    const tags = tagsText()
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter(Boolean);
    // пустые строки → null
    const clean: SavedQuery = {
      ...q,
      filter: {
        ...q.filter,
        page: q.filter.page?.trim() || null,
        pagePrefix: q.filter.pagePrefix?.trim() || null,
        excludePage: q.filter.excludePage?.trim() || null,
        tags,
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
            {isNew() ? "Новая подборка" : `Подборка «${props.query!.title}»`}
          </span>
          <button class="modal-close" onClick={props.onClose}>
            <IconX />
          </button>
        </header>

        <div class="modal-body">
          <label class="settings-row">
            <span class="settings-label">Название</span>
            <input
              class="status-label-input"
              placeholder="Сейчас в работе"
              value={draft().title}
              onInput={(e) =>
                setDraft((d) => ({ ...d, title: e.currentTarget.value }))
              }
            />
          </label>

          <div class="settings-section">Какие задачи показывать</div>

          <label class="settings-row">
            <span class="settings-label">Только незавершённые</span>
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

          <div class="settings-section">Статусы (не выбрано — любые)</div>
          <div class="block-menu-row">
            <For each={statuses()}>
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
            <span class="settings-label">Со страницы</span>
            <input
              class="status-label-input"
              placeholder="точное название, например: Проект - TODO"
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
            <span class="settings-label">Название страницы начинается с…</span>
            <input
              class="status-label-input"
              placeholder="например: Проект -"
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
            <span class="settings-label">Скрыть страницу</span>
            <input
              class="status-label-input"
              placeholder="задачи этой страницы не попадут в подборку"
              value={draft().filter.excludePage ?? ""}
              onInput={(e) =>
                setDraft((d) => ({
                  ...d,
                  filter: { ...d.filter, excludePage: e.currentTarget.value },
                }))
              }
            />
          </label>

          <label class="settings-row">
            <span class="settings-label">Теги (через запятую)</span>
            <input
              class="status-label-input"
              placeholder="например: feature, lg"
              value={tagsText()}
              onInput={(e) => setTagsText(e.currentTarget.value)}
            />
          </label>

          <label class="settings-row">
            <span class="settings-label">Квадрант матрицы</span>
            <select
              class="status-label-input"
              value={draft().filter.quadrant ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  filter: {
                    ...d.filter,
                    quadrant: e.currentTarget.value || null,
                  },
                }))
              }
            >
              <option value="">любой</option>
              <For each={QUADRANTS}>
                {(q) => <option value={q.key}>{q.label}</option>}
              </For>
            </select>
          </label>

          <label class="settings-row">
            <span class="settings-label">Свёрнута по умолчанию</span>
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
                if (confirm(`Удалить подборку «${props.query!.title}»?`)) {
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
