# План: настраиваемая сортировка подборок задач

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В подборках задач (SavedQuery) настраиваемая сортировка: цепочка полей (статус/приоритет/срочность/важность) с направлением у каждого поля.

**Architecture:** Ядро расширяется типом `SortRule { field, direction }` с обратно-совместимой десериализацией старого формата `sort: ["priority"]`; появляется IPC `tasks_by_query` (заменяет `tasks_by_filter`); фронтенд редактирует цепочку в QueryEditor и запрашивает задачи по всей подборке.

**Tech Stack:** Rust (serde, Tauri 2 commands), SolidJS + strict TS, CSS-переменные в global.css.

**Спека:** `docs/specs/2026-10-14-query-sort-design.md`

---

### Task 1: Ядро — SortRule с направлением и обратной совместимостью

**Files:**
- Modify: `src-tauri/src/core/query.rs`
- Test: unit-тесты в том же файле (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Написать падающие тесты**

Добавить в конец `src-tauri/src/core/query.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn rule(field: SortField, direction: SortDirection) -> SortRule {
        SortRule { field, direction }
    }

    #[test]
    fn sort_rule_legacy_format_deserializes_as_asc() {
        let q: SavedQuery = serde_json::from_str(
            r#"{"title":"t","sort":["priority","status"]}"#,
        )
        .unwrap();
        assert_eq!(
            q.sort,
            vec![
                rule(SortField::Priority, SortDirection::Asc),
                rule(SortField::Status, SortDirection::Asc),
            ]
        );
    }

    #[test]
    fn sort_rule_new_format_roundtrip() {
        let q = SavedQuery {
            title: "t".into(),
            filter: TaskFilter::default(),
            sort: vec![rule(SortField::Importance, SortDirection::Desc)],
            collapsed: false,
        };
        let json = serde_json::to_string(&q).unwrap();
        assert!(json.contains(r#""sort":[{"field":"importance","direction":"desc"}]"#));
        let back: SavedQuery = serde_json::from_str(&json).unwrap();
        assert_eq!(back.sort, q.sort);
    }

    #[test]
    fn sort_rule_default_direction_is_asc() {
        let r: SortRule = serde_json::from_str(r#"{"field":"urgency"}"#).unwrap();
        assert_eq!(r, rule(SortField::Urgency, SortDirection::Asc));
    }
}
```

(Поведенческие тесты компаратора — в Task 2, там же где сам компаратор.)

- [ ] **Step 2: Прогнать тесты — должны падать**

Run: `cargo test --workspace sort_rule`
Expected: FAIL (нет типов `SortRule`/`SortDirection`, тесты не компилируются)

- [ ] **Step 3: Реализовать типы**

В `src-tauri/src/core/query.rs` после `SortField` добавить `PartialEq, Eq` в derive `SortField` (нужно для assert_eq), затем заменить блок типов:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortField {
    Status,
    Priority,
    Urgency,
    Importance,
    CreatedAt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    #[default]
    Asc,
    Desc,
}

/// Правило сортировки подборки: поле + направление.
/// Принимает и старый формат (`"priority"` = Asc) для совместимости
/// со старыми `.logtask/queries.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SortRule {
    pub field: SortField,
    pub direction: SortDirection,
}

impl<'de> Deserialize<'de> for SortRule {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Legacy(SortField),
            Full {
                field: SortField,
                #[serde(default)]
                direction: SortDirection,
            },
        }
        Ok(match Repr::deserialize(deserializer)? {
            Repr::Legacy(field) => SortRule {
                field,
                direction: SortDirection::Asc,
            },
            Repr::Full { field, direction } => SortRule { field, direction },
        })
    }
}
```

И в `SavedQuery` сменить тип поля:

```rust
    #[serde(default)]
    pub sort: Vec<SortRule>,
```

- [ ] **Step 4: Прогнать тесты — должны пройти**

Run: `cargo test --workspace sort_rule`
Expected: PASS (3 теста)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/core/query.rs
git commit -m "Добавлен тип правила сортировки подборок с направлением

Добавлено:
- направление сортировки (по возрастанию/убыванию) у каждого поля подборки
- чтение старого формата сортировки из сохранённых подборок"
```

---

### Task 2: Ядро — компаратор с направлением, None всегда в конце

**Files:**
- Modify: `src-tauri/src/core/query.rs` (`Graph::query`, `priority_key`)

- [ ] **Step 1: Написать падающие тесты**

В `#[cfg(test)] mod tests` файла `query.rs` добавить (граф собирается из markdown-текста, как в `src-tauri/src/core.rs:130-146`; задача без статуса не бывает, поэтому None-случай проверяется на приоритете):

```rust
    use crate::core::index::IndexStats;
    use crate::core::model::PageKind;

    fn graph_from(content: &str) -> Graph {
        let mut g = Graph::default();
        let mut stats = IndexStats {
            pages: 0,
            journals: 0,
            blocks: 0,
            tasks: 0,
            links: 0,
        };
        g.index_file_content("тест", PageKind::Page, content, None, &mut stats, None);
        g
    }

    fn query_with(sort: Vec<SortRule>) -> SavedQuery {
        SavedQuery {
            title: "t".into(),
            filter: TaskFilter::default(),
            sort,
            collapsed: false,
        }
    }

    fn contents(g: &Graph, q: &SavedQuery) -> Vec<String> {
        g.query(q)
            .into_iter()
            .map(|(_, b)| b.content.clone())
            .collect()
    }

    #[test]
    fn query_sorts_by_priority_desc_with_none_last() {
        let g = graph_from("- TODO А [#A]\n- DOING Б [#C]\n- LATER В\n");
        let q = query_with(vec![rule(SortField::Priority, SortDirection::Desc)]);
        assert_eq!(contents(&g, &q), vec!["Б [#C]", "А [#A]", "В"]);
    }

    #[test]
    fn query_sort_none_last_also_when_asc() {
        let g = graph_from("- TODO А [#A]\n- LATER В\n");
        let q = query_with(vec![rule(SortField::Priority, SortDirection::Asc)]);
        assert_eq!(contents(&g, &q), vec!["А [#A]", "В"]);
    }

    #[test]
    fn query_sort_chain_uses_second_field_as_tiebreak() {
        // одинаковая важность (medium из [#B]) → решает статус asc: LATER раньше DOING
        let g = graph_from("- DOING Б [#B]\n- LATER В [#B]\n");
        let q = query_with(vec![
            rule(SortField::Importance, SortDirection::Desc),
            rule(SortField::Status, SortDirection::Asc),
        ]);
        assert_eq!(contents(&g, &q), vec!["В [#B]", "Б [#B]"]);
    }
```

Проверить точное содержимое `b.content` по парсеру (маркер статуса отрезается, приоритет остаётся в тексте — сверить с `src-tauri/src/core/parser.rs`, при расхождении поправить ожидаемые строки на реальный `content`).

- [ ] **Step 2: Прогнать — должны падать**

Run: `cargo test --workspace query_sort`
Expected: FAIL (текущий компаратор игнорирует направление)

- [ ] **Step 3: Реализовать компаратор**

В `query.rs` переписать `priority_key` и тело сортировки в `Graph::query`:

```rust
/// Ключ сортировки по маркеру приоритета; None — у блоков без приоритета
fn priority_key(block: &Block) -> Option<u8> {
    block.priority.map(|p| match p {
        super::model::Priority::A => 0,
        super::model::Priority::B => 1,
        super::model::Priority::C => 2,
    })
}
```

```rust
        out.sort_by(|(_, a), (_, b)| {
            for rule in &q.sort {
                let key = |blk: &Block| -> Option<u8> {
                    match rule.field {
                        SortField::Status => blk.status.map(|s| s.order()),
                        SortField::Priority => priority_key(blk),
                        SortField::Urgency => Some(level_key(blk.effective_urgency())),
                        SortField::Importance => Some(level_key(blk.effective_importance())),
                        SortField::CreatedAt => None, // no-op: created_at у блоков нет
                    }
                };
                // None (нет значения) — всегда в конце, при любом направлении
                let cmp = match (key(a), key(b)) {
                    (None, None) => std::cmp::Ordering::Equal,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (Some(x), Some(y)) => match rule.direction {
                        SortDirection::Asc => x.cmp(&y),
                        SortDirection::Desc => y.cmp(&x),
                    },
                };
                if cmp != std::cmp::Ordering::Equal {
                    return cmp;
                }
            }
            std::cmp::Ordering::Equal
        });
```

- [ ] **Step 4: Прогнать все тесты**

Run: `cargo test --workspace`
Expected: PASS (включая старые — `tests/index.rs` использует `sort: vec![]`, он совместим)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/core/query.rs
git commit -m "Добавлена сортировка подборок по цепочке полей с направлением

Добавлено:
- сортировка по возрастанию/убыванию для каждого поля цепочки
- задачи без значения поля всегда в конце списка"
```

---

### Task 3: IPC — команда `tasks_by_query` вместо `tasks_by_filter`

**Files:**
- Modify: `src-tauri/src/commands.rs:558-571`
- Modify: `src-tauri/src/lib.rs:45`
- Modify: `src/lib/api.ts:115-128`

- [ ] **Step 1: Заменить команду в `commands.rs`**

Удалить `tasks_by_filter`, добавить:

```rust
/// Задачи по сохранённой подборке (фильтр + сортировка)
#[tauri::command]
pub fn tasks_by_query(
    q: crate::core::query::SavedQuery,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TaskDto>, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;
    Ok(graph
        .query(&q)
        .into_iter()
        .map(|(id, block)| task_dto(graph, id, block))
        .collect())
}
```

- [ ] **Step 2: Обновить регистрацию в `lib.rs`**

Строку `commands::tasks_by_filter,` заменить на `commands::tasks_by_query,`.

- [ ] **Step 3: Обновить `src/lib/api.ts`**

```ts
export type SortDirection = "asc" | "desc";

export interface SortRule {
  field: string; // "status" | "priority" | "urgency" | "importance"
  direction: SortDirection;
}

export interface SavedQuery {
  title: string;
  filter: TaskFilter;
  sort: SortRule[];
  collapsed: boolean;
}

export async function tasksByQuery(q: SavedQuery): Promise<TaskDto[]> {
  return invoke<TaskDto[]>("tasks_by_query", { q });
}
```

Удалить `tasksByFilter`. Также добавить общие метаданные полей сортировки (используются в Queries.tsx и QueryEditor.tsx):

```ts
export const SORT_FIELDS: { key: string; label: string; defaultDir: SortDirection }[] = [
  { key: "status", label: "Статус", defaultDir: "asc" },
  { key: "priority", label: "Приоритет", defaultDir: "desc" },
  { key: "urgency", label: "Срочность", defaultDir: "desc" },
  { key: "importance", label: "Важность", defaultDir: "desc" },
];
```

- [ ] **Step 4: Проверка сборки**

Run: `cargo build --workspace && npm run typecheck`
Expected: успех; `Queries.tsx` пока не трогаем — typecheck покажет ошибку импорта `tasksByFilter` (это ожидаемо, чинится в Task 4), поэтому сначала `cargo build`, а typecheck прогнать после Task 4. Если хочется зелёного прогона сразу — временно не удалять `tasksByFilter` из api.ts до Task 4.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/api.ts
git commit -m "Добавлена команда получения задач по подборке с сортировкой

Изменено:
- список задач подборки формируется с учётом настроенной сортировки

Удалено:
- команда получения задач по фильтру без сортировки"
```

---

### Task 4: Queries.tsx — запрос по подборке, summary, шаблоны

**Files:**
- Modify: `src/components/Queries.tsx`

- [ ] **Step 1: Переключить загрузку на `tasksByQuery`**

Импорт: заменить `tasksByFilter` на `tasksByQuery` в импорте из `~/lib/api`. В `load()`:

```ts
      for (const q of qs) {
        const tasks = await tasksByQuery(q);
        setResults((prev) => ({ ...prev, [q.title]: tasks }));
```

- [ ] **Step 2: Сортировка в `filterSummary`**

В конец `filterSummary` перед `return parts.join(" · ")`:

```ts
  if (q.sort.length > 0) {
    const labelOf = (f: string) => SORT_FIELDS.find((s) => s.key === f)?.label ?? f;
    parts.push(
      "сортировка: " +
        q.sort.map((r) => `${labelOf(r.field)} ${r.direction === "desc" ? "↓" : "↑"}`).join(", "),
    );
  }
```

Импортировать `SORT_FIELDS` из `~/lib/api`.

- [ ] **Step 3: Дефолтная сортировка в шаблонах**

В `applyTemplate` заменить `sort: []` на:

```ts
      { title: t.title, filter: { ...t.filter }, sort: [{ field: "priority", direction: "desc" }], collapsed: false },
```

- [ ] **Step 4: Проверка**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/Queries.tsx
git commit -m "Подборки задач выводятся с учётом настроенной сортировки

Добавлено:
- отображение настроенной сортировки в описании подборки
- сортировка по приоритету в типовых шаблонах подборок"
```

---

### Task 5: QueryEditor — блок настройки сортировки

**Files:**
- Modify: `src/components/QueryEditor.tsx`
- Modify: `public/styles/global.css`

- [ ] **Step 1: Хелперы работы с цепочкой сортировки**

В `QueryEditor.tsx` импортировать `SORT_FIELDS` и тип `SortRule` из `~/lib/api`; добавить функции:

```tsx
  const addSortRule = () => {
    const used = draft().sort.map((r) => r.field);
    const next = SORT_FIELDS.find((f) => !used.includes(f.key)) ?? SORT_FIELDS[0];
    setDraft((d) => ({
      ...d,
      sort: [...d.sort, { field: next.key, direction: next.defaultDir }],
    }));
  };

  const updateSortRule = (i: number, patch: Partial<SortRule>) =>
    setDraft((d) => ({
      ...d,
      sort: d.sort.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    }));

  const moveSortRule = (i: number, delta: number) =>
    setDraft((d) => {
      const sort = [...d.sort];
      const [r] = sort.splice(i, 1);
      sort.splice(i + delta, 0, r);
      return { ...d, sort };
    });

  const removeSortRule = (i: number) =>
    setDraft((d) => ({ ...d, sort: d.sort.filter((_, j) => j !== i) }));
```

- [ ] **Step 2: Блок «Сортировка» в разметке**

Перед `<label class="settings-row">` с «Свёрнута по умолчанию» вставить:

```tsx
          <div class="settings-section">Сортировка (первое поле — главное)</div>
          <For each={draft().sort}>
            {(rule, i) => (
              <div class="sort-rule-row">
                <select
                  class="status-label-input"
                  value={rule.field}
                  onChange={(e) =>
                    updateSortRule(i(), { field: e.currentTarget.value })
                  }
                >
                  <For each={SORT_FIELDS}>
                    {(f) => <option value={f.key}>{f.label}</option>}
                  </For>
                </select>
                <select
                  class="status-label-input"
                  value={rule.direction}
                  onChange={(e) =>
                    updateSortRule(i(), {
                      direction: e.currentTarget.value as SortRule["direction"],
                    })
                  }
                >
                  <option value="asc">по возрастанию</option>
                  <option value="desc">по убыванию</option>
                </select>
                <button
                  class="btn"
                  disabled={i() === 0}
                  onClick={() => moveSortRule(i(), -1)}
                  title="Выше"
                >
                  ↑
                </button>
                <button
                  class="btn"
                  disabled={i() === draft().sort.length - 1}
                  onClick={() => moveSortRule(i(), 1)}
                  title="Ниже"
                >
                  ↓
                </button>
                <button class="btn" onClick={() => removeSortRule(i())} title="Убрать">
                  ✕
                </button>
              </div>
            )}
          </For>
          <button class="btn" onClick={addSortRule}>
            ＋ Добавить поле сортировки
          </button>
```

- [ ] **Step 3: Стили в `public/styles/global.css`**

```css
.sort-rule-row {
  display: flex;
  gap: var(--gap, 8px);
  align-items: center;
  margin-bottom: 6px;
}
.sort-rule-row select {
  flex: 1;
}
```

(Имя переменной gap сверить с существующими переменными в global.css; если есть `--space-*` — использовать их.)

- [ ] **Step 4: Проверка**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/QueryEditor.tsx public/styles/global.css
git commit -m "Добавлена настройка сортировки в редакторе подборки

Добавлено:
- список полей сортировки с направлением и порядком приоритета полей"
```

---

### Task 6: Документация и финальная проверка

**Files:**
- Modify: `docs/03-ui.md` (§4, строки 105-121)
- Modify: `docs/01-architecture.md:75`

- [ ] **Step 1: Обновить `docs/03-ui.md`**

Пример формата заменить на новый:

```json
[
  { "title": "Сейчас",
    "filter": { "status": ["DOING", "TODO"] },
    "sort": [{ "field": "priority", "direction": "desc" }], "collapsed": false },
  { "title": "Проекты", "filter": { "page": "Проекты - TODO" }, "collapsed": true }
]
```

И дополнить список после примера:

```markdown
- `sort` — цепочка правил `{field, direction}`: `field` =
  `status`/`priority`/`urgency`/`importance`, `direction` = `asc`/`desc`.
  Первое поле главное, остальные — при равенстве. Задачи без значения поля
  всегда в конце. Старый формат (`"sort": ["priority"]`) читается как `asc`.
- В редакторе подборки сортировка настраивается блоком «Сортировка»:
  добавление полей, направление, порядок стрелками.
```

И в строке про редактор (120-121) дописать «…квадрант матрицы, сортировка».

- [ ] **Step 2: Обновить `docs/01-architecture.md:75`**

`tasks_by_filter` → `tasks_by_query` в списке IPC.

- [ ] **Step 3: Полная проверка**

Run: `cargo fmt && cargo clippy --workspace -- -D warnings && cargo test --workspace && npm run typecheck`
Expected: PASS, 0 warnings

- [ ] **Step 4: Commit**

```bash
git add docs/03-ui.md docs/01-architecture.md
git commit -m "Обновлена документация по сортировке подборок

Изменено:
- формат сортировки подборок в описании интерфейса
- список команд IPC в описании архитектуры"
```

---

## Self-review notes

- Покрытие спеки: SortRule+serde (Task 1), компаратор/None-last (Task 2), IPC+api.ts (Task 3), Queries summary/шаблоны/tasksByQuery (Task 4), QueryEditor UI (Task 5), docs (Task 6). Не входит в объём — канбан/матрица, импорт sort-by из config.edn, created_at.
- Имена согласованы: `SortRule`, `SortDirection`, `tasks_by_query`/`tasksByQuery`, `SORT_FIELDS` используются одинаково во всех задачах.
