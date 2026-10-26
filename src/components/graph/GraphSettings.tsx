import { For } from "solid-js";
import type { GraphColorGroup, GraphViewSettings } from "~/lib/api";

export function GraphSettings(props: {
  settings: GraphViewSettings;
  onChange: (settings: GraphViewSettings) => void;
  onRecalculate: () => void;
  onReset: () => void;
}) {
  const update = (patch: Partial<GraphViewSettings>) => {
    props.onChange({ ...props.settings, ...patch });
  };
  const updateGroup = (id: string, patch: Partial<GraphColorGroup>) => {
    update({ groups: props.settings.groups.map((group) => group.id === id ? { ...group, ...patch } : group) });
  };
  const moveGroup = (id: string, delta: number) => {
    const groups = [...props.settings.groups];
    const index = groups.findIndex((group) => group.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= groups.length) return;
    [groups[index], groups[target]] = [groups[target], groups[index]];
    update({ groups });
  };
  const toggle = (key: "showJournals" | "showTags" | "showAssets" | "onlyExisting" | "hideOrphans" | "arrows", label: string) => (
    <label class="graph-check">
      <input type="checkbox" checked={props.settings[key]} onChange={(event) => update({ [key]: event.currentTarget.checked })} />
      <span>{label}</span>
    </label>
  );
  const range = (
    key: "nodeScale" | "edgeScale" | "labelThreshold" | "centerForce" | "repelForce" | "linkForce" | "linkDistance" | "alphaDecay" | "clusterThreshold",
    label: string,
    min: number,
    max: number,
    step: number,
  ) => (
    <label class="graph-range">
      <span>{label}: <b>{props.settings[key]}</b></span>
      <input type="range" min={min} max={max} step={step} value={props.settings[key]} onInput={(event) => update({ [key]: Number(event.currentTarget.value) })} />
    </label>
  );

  return (
    <div class="graph-settings">
      <section>
        <h2>Фильтры</h2>
        <label class="graph-field">Поиск
          <input type="search" value={props.settings.search} onInput={(event) => update({ search: event.currentTarget.value })} placeholder="Название, тег или путь" />
        </label>
        {toggle("showJournals", "Показывать журналы")}
        {toggle("showTags", "Показывать теги")}
        {toggle("showAssets", "Показывать вложения")}
        {toggle("onlyExisting", "Только существующие страницы")}
        {toggle("hideOrphans", "Скрыть страницы без связей")}
        <label class="graph-field">Исключения (по одному паттерну на строку)
          <textarea rows={3} value={props.settings.exclusions.join("\n")} onInput={(event) => update({ exclusions: event.currentTarget.value.split("\n").filter(Boolean) })} />
        </label>
        <button type="button" onClick={() => update({ search: "", exclusions: [], showJournals: false, showTags: false, showAssets: false, onlyExisting: true, hideOrphans: false })}>Сбросить фильтры</button>
      </section>

      <section>
        <div class="graph-settings-title">
          <h2>Цветовые группы</h2>
          <button type="button" onClick={() => update({ groups: [...props.settings.groups, { id: crypto.randomUUID(), query: "", color: "#09bec8", enabled: true, clustered: false }] })}>Добавить</button>
        </div>
        <For each={props.settings.groups}>
          {(group, index) => (
            <div class="graph-group">
              <div class="graph-group-row">
                <input aria-label="Условие группы" value={group.query} placeholder="tag:active или name:Проект" onInput={(event) => updateGroup(group.id, { query: event.currentTarget.value })} />
                <input aria-label="Цвет группы" type="color" value={group.color} onInput={(event) => updateGroup(group.id, { color: event.currentTarget.value })} />
              </div>
              <div class="graph-group-row">
                <label><input type="checkbox" checked={group.enabled} onChange={(event) => updateGroup(group.id, { enabled: event.currentTarget.checked })} /> Включена</label>
                <label><input type="checkbox" checked={group.clustered} onChange={(event) => updateGroup(group.id, { clustered: event.currentTarget.checked })} /> Кластер</label>
                <button type="button" title="Выше" disabled={index() === 0} onClick={() => moveGroup(group.id, -1)}>↑</button>
                <button type="button" title="Ниже" disabled={index() === props.settings.groups.length - 1} onClick={() => moveGroup(group.id, 1)}>↓</button>
                <button type="button" title="Удалить" onClick={() => update({ groups: props.settings.groups.filter((item) => item.id !== group.id) })}>×</button>
              </div>
            </div>
          )}
        </For>
      </section>

      <section>
        <h2>Отображение</h2>
        {toggle("arrows", "Стрелки на связях")}
        {range("nodeScale", "Размер узлов", 0.5, 3, 0.1)}
        {range("edgeScale", "Толщина связей", 0.5, 3, 0.1)}
        {range("labelThreshold", "Порог подписей", 0.05, 2, 0.05)}
        <label class="graph-field">Агрегация журналов
          <select value={props.settings.journalAggregation} onChange={(event) => update({ journalAggregation: event.currentTarget.value })}>
            <option value="month">По месяцам</option>
            <option value="year">По годам</option>
          </select>
        </label>
        {range("clusterThreshold", "Порог кластера", 20, 50, 1)}
      </section>

      <section>
        <h2>Физика</h2>
        {range("centerForce", "Центрирование", 0, 1, 0.01)}
        {range("repelForce", "Отталкивание", 20, 400, 10)}
        {range("linkForce", "Притяжение", 0, 1, 0.05)}
        {range("linkDistance", "Длина связи", 20, 300, 5)}
        {range("alphaDecay", "Затухание", 0.005, 0.2, 0.005)}
      </section>

      <section class="graph-settings-actions">
        <button type="button" onClick={() => { if (confirm("Пересчитать раскладку? Ручные позиции будут сброшены.")) props.onRecalculate(); }}>Пересчитать раскладку</button>
        <button type="button" onClick={() => { if (confirm("Сбросить настройки графа?")) props.onReset(); }}>Сбросить настройки</button>
      </section>
    </div>
  );
}
