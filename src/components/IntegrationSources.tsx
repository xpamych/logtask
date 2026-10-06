import { createSignal, Index, For, Show, onMount } from "solid-js";
import type { SourceConfig, SourceState } from "~/lib/api";
import {
  integrationsSetSecret,
  integrationsStates,
  integrationsSync,
  integrationsTest,
  newSourceConfig,
} from "~/lib/api";

const KIND_LABELS: Record<string, string> = {
  generic: "Произвольный API",
  gitea: "Gitea / Forgejo",
  github: "GitHub",
  gitlab: "GitLab",
};

const FIELD_KEYS: [string, string][] = [
  ["id", "id *"],
  ["title", "Название"],
  ["status", "Статус"],
  ["priority", "Приоритет"],
  ["assignee", "Исполнитель"],
  ["author", "Автор"],
  ["created", "Создана"],
  ["url", "URL"],
];

/** Редактор пар «ключ → значение» (маппинги/заголовки): черновик локально,
    коммит по blur, чтобы посимвольный ввод не дёргал конфиг и фокус */
function MapEditor(props: {
  title: string;
  rows: [string, string][];
  keyPlaceholder: string;
  valuePlaceholder: string;
  onCommit: (rows: [string, string][]) => void;
}) {
  const [draft, setDraft] = createSignal<[string, string][]>(
    props.rows.map(([k, v]) => [k, v] as [string, string]),
  );
  const cleaned = (rows: [string, string][]) =>
    rows.filter(([k]) => k.trim() !== "").map(([k, v]) => [k.trim(), v] as [string, string]);
  const commit = () => props.onCommit(cleaned(draft()));
  const setRow = (i: number, which: 0 | 1, val: string) =>
    setDraft((d) =>
      d.map((r, j) => (j === i ? (which === 0 ? [val, r[1]] : [r[0], val]) : r)),
    );
  return (
    <div class="map-editor">
      <div class="settings-section">{props.title}</div>
      <Index each={draft()}>
        {(row, i) => (
          <div class="map-row">
            <input
              class="settings-select"
              placeholder={props.keyPlaceholder}
              value={row()[0]}
              onInput={(e) => setRow(i, 0, e.currentTarget.value)}
              onBlur={commit}
            />
            <span class="map-arrow">→</span>
            <input
              class="settings-select"
              placeholder={props.valuePlaceholder}
              value={row()[1]}
              onInput={(e) => setRow(i, 1, e.currentTarget.value)}
              onBlur={commit}
            />
            <button
              class="status-move"
              title="Удалить"
              onClick={() => {
                const next = draft().filter((_, j) => j !== i);
                setDraft(next);
                props.onCommit(cleaned(next));
              }}
            >
              ✕
            </button>
          </div>
        )}
      </Index>
      <button class="btn" onClick={() => setDraft((d) => [...d, ["", ""]])}>
        + добавить
      </button>
    </div>
  );
}

/** Тело write-back как JSON: черновик локально, коммит по blur;
    невалидный JSON не сохраняется */
function PushBodyEditor(props: {
  value: unknown;
  onCommit: (v: unknown) => void;
  onError: (msg: string) => void;
}) {
  const serialize = (v: unknown) =>
    typeof v === "string" ? v : JSON.stringify(v ?? {}, null, 2);
  const [draft, setDraft] = createSignal<string | null>(null);
  return (
    <label class="settings-row">
      <span class="settings-label">Тело (JSON, {"{id}"}/{"{status}"})</span>
      <textarea
        class="settings-select push-body"
        rows={3}
        value={draft() ?? serialize(props.value)}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          const d = draft();
          setDraft(null);
          if (d === null) return;
          try {
            props.onCommit(JSON.parse(d));
          } catch {
            props.onError("Тело write-back: невалидный JSON — не сохранено");
          }
        }}
      />
    </label>
  );
}

/** Секция «Интеграции» настроек: список источников + форма редактирования */
export function IntegrationSources(props: {
  sources: SourceConfig[];
  onChange: (sources: SourceConfig[]) => void;
}) {
  const [states, setStates] = createSignal<SourceState[]>([]);
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [tokenDraft, setTokenDraft] = createSignal("");

  const refreshStates = async () => {
    try {
      setStates(await integrationsStates());
    } catch {
      /* вне Tauri / граф не загружен */
    }
  };
  onMount(refreshStates);

  const stateOf = (id: string) => states().find((s) => s.id === id);

  const update = (idx: number, patch: Partial<SourceConfig>) => {
    const next = props.sources.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    props.onChange(next);
  };

  const remove = (idx: number) => {
    props.onChange(props.sources.filter((_, i) => i !== idx));
  };

  const add = (kind: string) => {
    const s = newSourceConfig(kind);
    s.id = `${kind}-${Date.now().toString(36)}`;
    s.name = KIND_LABELS[kind] ?? kind;
    props.onChange([...props.sources, s]);
    setOpenId(s.id);
  };

  const testConnection = async (s: SourceConfig) => {
    setNotice("Проверка подключения…");
    try {
      const n = await integrationsTest(s);
      setNotice(`«${s.name}»: подключение ok, задач: ${n}`);
    } catch (e) {
      setNotice(`«${s.name}»: ошибка — ${e}`);
    }
  };

  const syncOne = async (s: SourceConfig) => {
    setNotice(`Синхронизация «${s.name}»…`);
    try {
      const reports = await integrationsSync(s.id);
      const r = reports[0];
      setNotice(
        r?.error
          ? `«${s.name}»: ошибка — ${r.error}`
          : `«${s.name}»: +${r?.added ?? 0} обновлено ${r?.updated ?? 0}, конфликтов ${r?.conflicts ?? 0}`,
      );
      await refreshStates();
    } catch (e) {
      setNotice(`«${s.name}»: ошибка — ${e}`);
    }
  };

  const saveToken = async (s: SourceConfig) => {
    const name = s.tokenRef?.trim();
    const value = tokenDraft().trim();
    if (!value) return;
    if (!name) {
      setNotice("Сначала укажите имя токена (tokenRef) — под ним он ляжет в хранилище");
      return;
    }
    try {
      await integrationsSetSecret(name, value);
      setTokenDraft("");
      setNotice(`Токен «${name}» сохранён в системном хранилище`);
      await refreshStates();
    } catch (e) {
      setNotice(`Токен не сохранён: ${e}`);
    }
  };

  return (
    <>
      <p class="integration-hint">
        Синхронизация задач из внешних источников на страницы графа. Токены
        хранятся в системном хранилище ключей, в настройках — только имена.
      </p>

      {/* Index, не For: иначе каждая правка (новые объекты источников)
          пересоздаёт DOM-узлы и сбивает фокус ввода */}
      <Index each={props.sources}>
        {(s, idx) => (
          <div class="integration">
            <div class="integration-head">
              <input
                type="checkbox"
                checked={s().enabled}
                title="Включён"
                onChange={(e) => update(idx, { enabled: e.currentTarget.checked })}
              />
              <button
                class="integration-title"
                onClick={() => {
                  setTokenDraft("");
                  setOpenId(openId() === s().id ? null : s().id);
                }}
              >
                {s().name || s().id} <span class="integration-kind">{KIND_LABELS[s().type] ?? s().type}</span>
              </button>
              <Show when={stateOf(s().id)?.lastError}>
                <span class="integration-error" title={stateOf(s().id)?.lastError ?? ""}>
                  ошибка
                </span>
              </Show>
              <span class="integration-last">
                {stateOf(s().id)?.lastSync
                  ? new Date(stateOf(s().id)!.lastSync!).toLocaleString("ru-RU")
                  : "ещё не синхронизирован"}
              </span>
            </div>

            <Show when={openId() === s().id}>
              <div class="integration-form">
                <label class="settings-row">
                  <span class="settings-label">Название</span>
                  <input
                    class="settings-select"
                    value={s().name}
                    onInput={(e) => update(idx, { name: e.currentTarget.value })}
                  />
                </label>

                <Show when={s().type === "generic"}>
                  <label class="settings-row">
                    <span class="settings-label">Страница</span>
                    <input
                      class="settings-select"
                      placeholder="PPDB - TODO"
                      value={s().page}
                      onInput={(e) => update(idx, { page: e.currentTarget.value })}
                    />
                  </label>
                  <label class="settings-row">
                    <span class="settings-label">URL задач</span>
                    <input
                      class="settings-select"
                      placeholder="https://…/api/tasks"
                      value={s().url}
                      onInput={(e) => update(idx, { url: e.currentTarget.value })}
                    />
                  </label>
                  <label class="settings-row">
                    <span class="settings-label">JSONPath массива</span>
                    <input
                      class="settings-select"
                      placeholder="$.tasks[*]"
                      value={s().itemsPath}
                      onInput={(e) => update(idx, { itemsPath: e.currentTarget.value })}
                    />
                  </label>

                  <div class="settings-section">Поля (JSONPath)</div>
                  <For each={FIELD_KEYS}>
                    {([key, label]) => (
                      <label class="settings-row">
                        <span class="settings-label">{label}</span>
                        <input
                          class="settings-select"
                          placeholder={`$.${key}`}
                          value={s().fields[key] ?? ""}
                          onInput={(e) => {
                            const fields = { ...s().fields };
                            const v = e.currentTarget.value.trim();
                            if (v) fields[key] = v;
                            else delete fields[key];
                            update(idx, { fields });
                          }}
                        />
                      </label>
                    )}
                  </For>

                  <MapEditor
                    title="Маппинг статусов (сервер → маркер; готовые TODO/DOING/… проходят и без таблицы)"
                    rows={Object.entries(s().statusMap)}
                    keyPlaceholder="new"
                    valuePlaceholder="TODO"
                    onCommit={(rows) => update(idx, { statusMap: Object.fromEntries(rows) })}
                  />
                  <MapEditor
                    title="Маппинг приоритетов (сервер → A/B/C; готовые буквы проходят и без таблицы)"
                    rows={Object.entries(s().priorityMap)}
                    keyPlaceholder="high"
                    valuePlaceholder="A"
                    onCommit={(rows) => update(idx, { priorityMap: Object.fromEntries(rows) })}
                  />
                  <MapEditor
                    title="Заголовки запроса (можно ${secret:имя})"
                    rows={Object.entries(s().headers)}
                    keyPlaceholder="Authorization"
                    valuePlaceholder="Bearer ${secret:lg-tasks}"
                    onCommit={(rows) => update(idx, { headers: Object.fromEntries(rows) })}
                  />

                  <label class="settings-row">
                    <span class="settings-label">Отправлять статус на сервер</span>
                    <input
                      type="checkbox"
                      checked={s().push !== null}
                      onChange={(e) =>
                        update(idx, {
                          push: e.currentTarget.checked
                            ? { url: "", method: "PUT", bodyTemplate: {}, statusMapOut: {} }
                            : null,
                        })
                      }
                    />
                  </label>
                  <Show when={s().push}>
                    {(p) => (
                      <>
                        <label class="settings-row">
                          <span class="settings-label">URL write-back</span>
                          <input
                            class="settings-select"
                            placeholder="https://…/tasks/{id}/status?status={status}"
                            value={p().url}
                            onInput={(e) =>
                              update(idx, { push: { ...p(), url: e.currentTarget.value } })
                            }
                          />
                        </label>
                        <label class="settings-row">
                          <span class="settings-label">Метод write-back</span>
                          <select
                            class="settings-select"
                            value={p().method}
                            onChange={(e) =>
                              update(idx, { push: { ...p(), method: e.currentTarget.value } })
                            }
                          >
                            <For each={["PUT", "POST", "PATCH", "GET"]}>
                              {(m) => <option value={m}>{m}</option>}
                            </For>
                          </select>
                        </label>
                        <PushBodyEditor
                          value={p().bodyTemplate}
                          onCommit={(v) => update(idx, { push: { ...p(), bodyTemplate: v } })}
                          onError={(msg) => setNotice(msg)}
                        />
                        <MapEditor
                          title="Маркер → значение сервера (statusMapOut)"
                          rows={Object.entries(p().statusMapOut)}
                          keyPlaceholder="DONE"
                          valuePlaceholder="completed"
                          onCommit={(rows) =>
                            update(idx, {
                              push: { ...p(), statusMapOut: Object.fromEntries(rows) },
                            })
                          }
                        />
                      </>
                    )}
                  </Show>
                </Show>

                <Show when={s().type !== "generic"}>
                  <label class="settings-row">
                    <span class="settings-label">Адрес сервера</span>
                    <input
                      class="settings-select"
                      placeholder={s().type === "github" ? "https://api.github.com" : "https://git.example.com"}
                      value={s().baseUrl}
                      onInput={(e) => update(idx, { baseUrl: e.currentTarget.value })}
                    />
                  </label>
                  <label class="settings-row">
                    <span class="settings-label">Репозитории (owner/repo, через запятую)</span>
                    <input
                      class="settings-select"
                      value={s().repos.join(", ")}
                      onInput={(e) =>
                        update(idx, {
                          repos: e.currentTarget.value
                            .split(",")
                            .map((r) => r.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                </Show>

                {/* токен — для всех типов: в generic имя подставляется
                    в url/headers как ${{secret:имя}} */}
                <label class="settings-row">
                  <span class="settings-label">Имя токена (tokenRef)</span>
                  <input
                    class="settings-select"
                    placeholder="lg-tasks"
                    value={s().tokenRef ?? ""}
                    onInput={(e) => update(idx, { tokenRef: e.currentTarget.value || null })}
                  />
                </label>
                <label class="settings-row">
                  <span class="settings-label">
                    Токен {stateOf(s().id)?.secretSet ? "(задан)" : "(не задан)"}
                  </span>
                  {/* автосохранение в keyring по Enter/blur — без кнопки;
                      по каждому символу не сохраняем, чтобы не писать
                      недопечатанный секрет */}
                  <input
                    class="settings-select"
                    type="password"
                    placeholder="введите новый токен"
                    value={tokenDraft()}
                    onInput={(e) => setTokenDraft(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveToken(s());
                      }
                    }}
                    onBlur={() => void saveToken(s())}
                  />
                </label>

                <label class="settings-row">
                  <span class="settings-label">Интервал синка, мин (0 — выкл)</span>
                  <input
                    class="settings-select"
                    type="number"
                    min="0"
                    value={s().syncIntervalMin}
                    onInput={(e) =>
                      update(idx, { syncIntervalMin: Number(e.currentTarget.value) || 0 })
                    }
                  />
                </label>

                <div class="integration-actions">
                  <button class="btn" onClick={() => testConnection(s())}>
                    Проверить подключение
                  </button>
                  <button class="btn" onClick={() => syncOne(s())}>
                    Синхронизировать
                  </button>
                  <button class="btn integration-delete" onClick={() => remove(idx)}>
                    Удалить
                  </button>
                </div>
              </div>
            </Show>
          </div>
        )}
      </Index>

      <div class="integration-add">
        <For each={Object.entries(KIND_LABELS)}>
          {([kind, label]) => (
            <button class="btn" onClick={() => add(kind)}>
              + {label}
            </button>
          )}
        </For>
      </div>

      <Show when={notice()}>
        <p class="integration-notice">{notice()}</p>
      </Show>
    </>
  );
}
