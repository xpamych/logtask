# Graph Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ускорить layout на 10 000 узлов без изменения алгоритма, функциональности и внешнего вида.

**Architecture:** Локально убираем дорогие вычисления расстояний и аллокации в двух доказанных горячих функциях. Изменения ограничены `src/lib/graph/layout.ts`, GitHub workflows оформляются отдельно.

**Tech Stack:** TypeScript, SolidJS, d3-force, Node test runner, Vite, Rust workspace.

**Spec:** `docs/superpowers/specs/2026-11-04-graph-performance-design.md`

## Global Constraints

- Не менять силы, порядок кадров, число итераций коллизий, DTO, настройки и внешний вид.
- Сохранить точные позиции hub и разведение коллизий относительно эталонной реализации.
- Не смешивать оптимизацию с добавлением GitHub workflows.
- Каждое изменение сначала проверяется failing test, затем полным frontend suite и повторным микробенчмарком.

## Review Focus

- Узлы с одинаковыми координатами не должны получать NaN при разведении.
- Закреплённые узлы не должны смещаться при hub gravity или коллизиях.
- Порядок выбора ближайшего hub и итоговые координаты должны совпасть с эталоном.
- Большая сцена не должна изменить число/порядок кадров и D3-физику.
- Оптимизация не должна затронуть round-trip Markdown или Rust-индексацию.

---

### Task 1: Оптимизация applyHubGravity и separateGraphNodes

**Files:**
- Modify: `src/lib/graph/layout.ts`
- Test: `src/lib/graph/layout.test.ts`
- Docs: `docs/superpowers/specs/2026-11-04-graph-performance-design.md`

**Interfaces:**
- Consumes: существующие `applyHubGravity(nodes, hubs, linkedIds, centerForce)` и `separateGraphNodes(nodes, radii, padding)`.
- Produces: те же сигнатуры и итоговые координаты, без изменения публичного API.

- [ ] **Step 1: Добавить failing эталонные тесты**

`optimized_hub_gravity_matches_reference`: неподвижные, закреплённые, связанные и изолированные узлы; выбор ближайшего hub и итоговые координаты сравниваются с эталоном.
`optimized_collision_separation_matches_reference`: пересекающиеся и совпадающие узлы, pinned и multi-radius; позиции после одинакового числа итераций сравниваются с эталоном. Эталоном служит текущая реализация до редактирования, зафиксированная в тесте без вызова новой реализации.

- [ ] **Step 2: Запустить RED**

Run: `node --conditions=browser --test src/lib/graph/layout.test.ts`
Expected: тесты падают из-за отсутствующего оптимизированного результата или расхождения реализации.

- [ ] **Step 3: Оптимизировать горячие вычисления**

В `applyHubGravity` использовать квадраты расстояний для выбора hub, не вызывая `Math.hypot` при сравнении. В `separateGraphNodes` использовать числовые ключи grid и прямое сравнение индексов пар вместо строковых ключей и Map-lookup для каждой пары. Не менять итерации, направление сдвигов и обработку pinned/zero-distance.

- [ ] **Step 4: Запустить GREEN и повторный микробенчмарк**

Run: `node --conditions=browser --test src/lib/graph/layout.test.ts` и микробенчмарк 10 000 узлов из дизайна.
Expected: эталонные тесты PASS; время не хуже исходного, горячие функции заметно быстрее.

- [ ] **Step 5: Полные проверки и визуальный smoke**

Run: полный frontend suite, `npm run build`, `npm audit --omit=dev`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`.
Expected: всё PASS; visual benchmark сохраняет раскладку и отсутствие пересечений.

- [ ] **Step 6: Коммит**

`Ускорена раскладка больших графов` + результаты до/после, сохранение поведения.

### Task 2: Добавление GitHub workflows отдельным коммитом

**Files:**
- Create: `.github/workflows/check.yml`
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Produces: независимый GitHub Actions CI/CD, существующие `.gitea/workflows/` не меняются.

- [ ] **Step 1: Проверить workflows**

Run: `python` с `yaml.safe_load` для двух GitHub и двух Gitea workflows, `git diff --check`.
Expected: YAML OK, whitespace чистый.

- [ ] **Step 2: Коммит**

`Добавлена сборка и публикация релизов через GitHub Actions`.
