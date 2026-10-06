# 05 — Интеграции (синхронизация задач)

Раздел «Интеграции» в настройках: двусторонняя синхронизация задач из внешних
источников — произвольных REST API (по аналогии с Logseq-плагином TE) и issues
git-форжей (Gitea/Forgejo, GitHub, GitLab, включая self-hosted).

## Источники

Конфигурация — в `.logtask/settings.json`, ключ `integrations.sources[]`.
Всё редактируется в UI (Настройки → Интеграции): поля, маппинги, заголовки
и write-back generic-источника тоже; ручная правка файла остаётся возможной.

Маппинги: если значения сервера нет в таблице, но оно само — валидный маркер
Logseq (`TODO`/`DOING`/…) или буква приоритета (`A`/`B`/`C`), оно проходит
как есть. Для API, отдающих Logseq-значения напрямую (например поля
`logseq_status`/`logseq_priority`), таблицы маппингов не нужны.

Поля источника (camelCase в JSON):

| Поле | Типы | Описание |
|---|---|---|
| `id` | все | стабильный id (латиница); пишется в свойство блока `source::` |
| `type` | все | `generic` / `gitea` / `github` / `gitlab` |
| `name` | все | отображаемое имя |
| `enabled` | все | вкл/выкл |
| `syncIntervalMin` | все | интервал фонового синка, мин; 0 — выкл |
| `page` | generic | страница задач, например `PPDB - TODO` |
| `pageTemplate` | форжи | шаблон страницы, `{repo}` = имя репозитория (по умолчанию `{repo} - TODO`) |
| `baseUrl` | форжи | адрес сервера (github может быть пустым = api.github.com) |
| `tokenRef` | форжи | имя токена в системном keyring |
| `repos` | форжи | `owner/repo` (gitlab: `group/project`); запись без `/` — владелец: подтягиваются все его неархивные репозитории (gitea/github: org → fallback user; gitlab: группа), задачи каждого раскладываются по страницам по шаблону |
| `state` | форжи | `open` / `closed` / `all` |
| `url`, `method`, `headers` | generic | запрос задач; значения могут содержать `${secret:имя}` |
| `itemsPath` | generic | JSONPath до массива задач |
| `fields` | generic | JSONPath до полей: `id/title/status/priority/assignee/author/created/url` |
| `statusMap` | generic | значение сервера → маркер Logseq |
| `priorityMap` | generic | значение сервера → буква A/B/C |
| `push` | generic | write-back: `url` (с `{id}` и `{status}`), `method`, `bodyTemplate` (с `{id}`/`{status}`), `statusMapOut` |

JSONPath — подмножество: `$.a.b`, `$.a[0]`, `$.a[*]`, `$.a[*].b`.

## Секреты

Токены — в системном хранилище ключей (Secret Service / Keychain / Credential
Manager), сервис `logtask`, ключ `<хэш пути графа>/<имя>`. В файлах графа
секретов нет. В generic-конфиге значение подставляется из `${secret:имя}`.
Для тестов/CI: переменные окружения `LOGTASK_SECRET_<ИМЯ>`.
Секреты в query URL в тексты ошибок не попадают (в ошибках URL обрезается
до `?`), но лучше передавать токены в заголовках, а не в URL.

## Страницы задач

Импорт пишет обычные Logseq-блоки (формат не меняется, docs/02-format.md):

```
- TODO [#B] Название задачи
  source:: ppdb
  source-id:: ppdb-347
  url:: https://…
  assignee:: xpamych
  created:: 2026-07-15
  synced-at:: 2026-10-04T12:00:00+03:00
```

Служебные пометки: `sync-conflict:: <дата>` (конфликт, сервер победил),
`sync-missing:: <дата>` (задача исчезла с сервера, локально изменена).
Обе находятся через Запросы по свойству.

## Синхронизация

Триггеры: при открытии графа, по интервалу (`syncIntervalMin`), кнопка ⟳ в
верхней полосе (и в секции Интеграций), мгновенный write-back при смене
статуса импортированной задачи.

Состояние — `.logtask/integrations-state.json` (по каждой задаче: серверный
статус и отпечаток блока на момент синка). Правила merge:

- менялся только сервер → блок обновляется;
- менялся только локально → статус отправляется на сервер;
- менялись оба → сервер побеждает + `sync-conflict::`;
- исчезла с сервера: не тронута → удаляется; изменена → `sync-missing::`.

Ошибка одного источника не прерывает остальные; страницы при неуспешном fetch
не трогаются. После синка — переиндексация и событие `graph-changed`; прогресс
— события `sync-started` / `sync-finished`.

## Маппинги по умолчанию (форжи)

Статус: open → `TODO`, closed → `DONE`. Приоритет из labels:
`critical`/`high` → `[#A]`, `normal`/`medium` → `[#B]`, `low` → `[#C]`.
Write-back: DONE/CANCELED закрывает issue, остальные статусы — открывает.

## IPC

`integrations_states`, `integrations_set_secret`, `integrations_test`,
`integrations_sync` (+ `settings_get`/`settings_save` для самих источников).
