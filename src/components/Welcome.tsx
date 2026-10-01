interface Props {
  onPick: () => void;
}

export default function Welcome(props: Props) {
  return (
    <div class="welcome">
      <img class="welcome-logo" src="/icon.png" alt="" />
      <h1 class="welcome-title">Logtask</h1>
      <p class="welcome-text">
        Журнал и задачи прямо над вашими .md-файлами в формате Logseq. Без базы
        данных — файлы остаются источником истины.
      </p>
      <p class="welcome-text">
        Для начала выберите папку графа — каталог с файлами Logseq (внутри
        обычно есть journals/ и pages/).
      </p>
      <button class="welcome-pick" onClick={props.onPick}>
        Выбрать папку графа
      </button>
    </div>
  );
}
