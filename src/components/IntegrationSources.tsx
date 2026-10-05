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
    if (!name || !value) return;
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
                  <p class="integration-hint">
                    Поля (fields), маппинги (statusMap/priorityMap), заголовки и
                    write-back (push) пока редактируются вручную в
                    .logtask/settings.json — формат: docs/05-integrations.md.
                  </p>
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
                  <input
                    class="settings-select"
                    type="password"
                    placeholder="введите новый токен"
                    value={tokenDraft()}
                    onInput={(e) => setTokenDraft(e.currentTarget.value)}
                  />
                </label>
                <div class="settings-row">
                  <span class="settings-label" />
                  <button class="btn" onClick={() => saveToken(s())}>
                    Сохранить токен
                  </button>
                </div>

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
