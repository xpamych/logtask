import type { Component } from "solid-js";
import { onMount, createSignal } from "solid-js";
import { ping } from "~/lib/api";

const App: Component = () => {
  const [status, setStatus] = createSignal("…");

  onMount(async () => {
    try {
      setStatus(await ping());
    } catch (e) {
      setStatus(`ошибка: ${e}`);
    }
  });

  return (
    <div class="app">
      <aside class="sidebar">
        <div class="sidebar-search">
          <input type="search" placeholder="Поиск" />
        </div>
        <nav class="sidebar-section">
          <div class="sidebar-title">Избранное</div>
          <div class="sidebar-empty">—</div>
        </nav>
        <nav class="sidebar-section">
          <div class="sidebar-title">Страницы</div>
          <div class="sidebar-empty">—</div>
        </nav>
      </aside>
      <main class="journal">
        <section class="day">
          <h2 class="day-title">29 сен 2026</h2>
          <div class="placeholder">
            <p>Лента журнала появится в Фазе 2.</p>
            <p class="muted">Статус ядра: {status()}</p>
          </div>
        </section>
      </main>
      <aside class="taskpanel">
        <div class="tabs">
          <button class="tab active">Канбан</button>
          <button class="tab">Матрица</button>
          <button class="tab">Запросы</button>
        </div>
        <div class="taskpanel-body">
          <p class="muted">Панель задач — Фазы 3–4.</p>
        </div>
      </aside>
    </div>
  );
};

export default App;
