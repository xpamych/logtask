interface Props {
  onPick: () => void;
}

export default function Welcome(props: Props) {
  return (
    <div class="welcome">
      <svg
        class="welcome-logo"
        viewBox="0 0 96 96"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id="welcome-logo-grad"
            x1="8"
            y1="8"
            x2="88"
            y2="88"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stop-color="#09bec8" />
            <stop offset="1" stop-color="#9b59b6" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="88" height="88" rx="24" fill="url(#welcome-logo-grad)" />
        <path
          d="M29 50.5 L42.5 64 L68 33"
          stroke="#ffffff"
          stroke-width="9"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
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
