# Дизайн: Интеграции (синхронизация задач из внешних источников)

Дата: 2026-10-04
Статус: утверждено пользователем

## Цель

Раздел «Интеграции» в настройках Logtask: синхронизация задач из произвольных
REST API (по аналогии с Logseq-плагином TE, https://git.alr-pkg.ru/Plemya-x/TE —
например PPDB) и забор issues из git-форжей (Gitea/Forgejo, GitHub, GitLab,
включая self-hosted). Синхронизация двусторонняя: смена статуса в Logtask
отправляется на сервер (закрытие/открытие issue, смена статуса задачи).

## Решения, принятые при обсуждении

- Синхронизация **двусторонняя** (как в TE).
- Произвольный API описывается **JSONPath-маппингом в конфиге** (без встроенного
  скриптинга).
- Конфликты: **сервер побеждает + пометка** `sync-conflict::` на блоке и счётчик
  в UI.
- Форжи: **Gitea/Forgejo, GitHub, GitLab** — встроенные адаптеры; «любой по
  шаблону URL» покрывается generic-адаптером.
- Триггеры: **кнопка, при запуске, по интервалу, мгновенный write-back при смене
  статуса**.
- Токены — в **системном хранилище ключей** (keyring-крейт); в конфиге только
  имена секретов.
- Архитектура: **синк-движок в Rust-ядре** (не fetch из WebView, не sidecar).

## Архитектура

Новый модуль `src-tauri/src/sync/`:

- `mod.rs` — оркестратор: `sync_source()`, `sync_all()`, `push_status()`,
  фоновый тикер интервалов.
- `adapter.rs` — trait `SourceAdapter`:
  - `fetch_tasks() -> Result<Vec<RemoteTask>>`
  - `push_status(remote_id, status) -> Result<()>`
  - фабрика адаптера по типу источника из конфига.
- `gitea.rs` — Gitea/Forgejo API (`/api/v1/repos/{owner}/{repo}/issues`,
  PATCH для закрытия/открытия).
- `github.rs` — GitHub API (`/repos/{owner}/{repo}/issues`, state open/closed).
- `gitlab.rs` — GitLab API (`/api/v4/projects/:id/issues`, state_event
  close/reopen), поддержка self-hosted через `base_url`.
- `generic.rs` — произвольный REST API по JSONPath-конфигу (PPDB и «любой
  по шаблону URL»). Write-back — по блоку `push` в конфиге; если блока нет —
  источник работает только на импорт.
- `jsonpath.rs` — выборка значений по JSONPath (крейт jsonpath_lib или аналог,
  версия фиксируется в плане реализации).
- `merge.rs` — чистая логика diff/merge без I/O (тестируется как core).
- `state.rs` — `.logtask/integrations-state.json`, атомарная запись
  (tmp + fsync + rename, как fswrite).
- `secrets.rs` — обёртка над keyring: сервис `logtask`,
  ключ `<хэш-пути-графа>/<имя-секрета>`.

HTTP — reqwest (async, таймауты). После каждого успешного синка — полная
переиндексация графа и событие `graph-changed` (как у watcher).

## Конфигурация

В `.logtask/settings.json` добавляется ключ `integrations`:

```json
{
  "integrations": {
    "sources": [
      {
        "id": "ppdb",
        "type": "generic",
        "name": "PPDB",
        "enabled": true,
        "page": "PPDB - TODO",
        "url": "https://ppdb.example/api/tasks",
        "method": "GET",
        "headers": { "Authorization": "Bearer ${secret:ppdb-token}" },
        "items_path": "$.tasks[*]",
        "fields": {
          "id": "$.id",
          "title": "$.title",
          "status": "$.state",
          "priority": "$.priority",
          "assignee": "$.assignee",
          "author": "$.author",
          "created": "$.created_at",
          "url": "$.url"
        },
        "status_map": {
          "new": "TODO",
          "in_progress": "DOING",
          "completed": "DONE",
          "rejected": "CANCELED"
        },
        "priority_map": { "critical": "A", "high": "A", "normal": "B", "low": "C" },
        "push": {
          "url": "https://ppdb.example/api/tasks/{id}/status",
          "method": "POST",
          "body_template": { "status": "{status}" },
          "status_map_out": { "TODO": "new", "DOING": "in_progress", "DONE": "completed", "CANCELED": "rejected" }
        },
        "sync_interval_min": 15
      },
      {
        "id": "alr-gitea",
        "type": "gitea",
        "name": "ALR Gitea",
        "enabled": true,
        "base_url": "https://git.alr-pkg.ru",
        "token_ref": "gitea-alr",
        "repos": ["xpamych/logtask"],
        "page_template": "Gitea - {repo} - TODO",
        "state": "open",
        "sync_interval_min": 15
      }
    ]
  }
}
```

- `${secret:имя}` в строковых значениях подставляется из keyring в момент
  запроса; токены в файл не пишутся.
- `sync_interval_min: 0` — интервальный синк выключен.
- Для forge-источников маппинг статусов/приоритетов встроен в адаптер
  (open→TODO, closed→DONE; labels приоритета при наличии).

## Формат страниц задач

По аналогии с TE; страницы полностью парсятся текущим ядром, формат
Logseq-совместимый (контракт docs/02-format.md не меняется):

```
- TODO [#B] Название задачи
  source:: ppdb
  source-id:: ppdb-347
  url:: https://…
  assignee:: xpamych
  author:: xpamych
  created:: 2026-07-15
  synced-at:: 2026-10-04T12:00:00
```

Идентичность задачи — свойство `source-id::` (плюс `source::` = id источника).
Страница пишется через существующий fswrite (целиком, атомарно, сверка mtime).

## Merge-логика

Состояние прошлого синка — `.logtask/integrations-state.json`: по каждому
`source-id` — серверный статус и хэш содержимого блока на момент синка.

При синке для каждой задачи:

- менялся только сервер → блок обновляется;
- менялся только локально → статус отправляется на сервер (push);
- менялись оба → сервер побеждает, блок получает `sync-conflict:: <дата>`,
  задача попадает в счётчик конфликтов;
- задача исчезла из ответа сервера: локально не изменена — удаляется со
  страницы; изменена — остаётся с пометкой `sync-missing:: <дата>`.

Мгновенный write-back: `set_status` в `commands.rs` проверяет у блока наличие
`source::`/`source-id::` и вызывает `sync::push_status` (fire-and-forget).
Ошибка push не откатывает локальный статус; источник помечается ошибкой и
расхождение разрешится при следующем синке по правилам merge.

## IPC и UI

Команды (по соглашению: `commands.rs` + `lib.rs` + `src/lib/api.ts`):

- `integrations_list() -> Vec<SourceInfoDto>` (включая последний синк/ошибку)
- `integrations_save(source)`
- `integrations_delete(id)`
- `integrations_set_secret(name, value)` — пишет только в keyring
- `integrations_test(source)` — проверка подключения без записи в граф
- `integrations_sync(source_id?)` — ручной синк одного или всех

События: `sync-started`, `sync-finished` (добавлено/обновлено/конфликтов или
ошибка по источнику).

UI:

- `SettingsModal` — вкладка «Интеграции»: список источников (тип, вкл/выкл,
  время последнего синка, ошибка), форма добавления/редактирования по типу,
  поле токена (не отображается обратно, только «задан/не задан»), кнопки
  «Проверить подключение» и «Синхронизировать».
- Кнопка «Синхронизировать» в сайдбаре со спиннером во время синка и бейджем
  числа конфликтов после.
- Конфликтные задачи находятся бесплатно через Запросы по `sync-conflict::`.

## Фон

- При открытии графа — синк всех `enabled` источников (async, не блокирует
  старт; UI узнаёт через `graph-changed` и `sync-*` события).
- Таймер tokio на каждый источник с `sync_interval_min > 0`.
- Параллельный синк одного источника защищается мьютексом (кнопка + таймер +
  запуск могут совпасть).

## Обработка ошибок

- Ошибка fetch/push одного источника не роняет остальные; источник помечается
  ошибкой (в state и в UI), страницы не трогаются.
- Сетевые ошибки — с таймаутом и одним повтором для идемпотентных GET.
- Ошибки IPC — `Result<T, String>`, как в остальных командах.

## Тестирование

- Unit: JSONPath-выборка полей, маппинги статусов/приоритетов (в обе стороны),
  все ветки merge (сервер / локально / конфликт / исчезнувшие / новые).
- Интеграционные (`src-tauri/tests/`): mock HTTP (wiremock) — gitea fetch,
  generic fetch, push_status, синк с записью страницы во временный граф
  (tempfile) и проверкой md-результата.
- Round-trip фикстур (`tests/roundtrip.rs`) не затрагивается — обязательная
  проверка `cargo test --workspace`.

## Документация

- Новый `docs/05-integrations.md` — формат конфига, маппинги, поведение merge.
- Дополняются `docs/01-architecture.md` (слой sync) и `AGENTS.md` (структура,
  новые IPC-команды) — в том же коммите, что и реализация.
