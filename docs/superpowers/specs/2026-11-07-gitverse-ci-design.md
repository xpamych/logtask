# GitVerse CI/CD

## Цель
Запускать проверки и Linux-релизы Logtask на облачных раннерах GitVerse с меткой `ubuntu-latest`.

## Подходы
- **Выбрано: отдельные workflow в `.gitverse/workflows/`.** Проверки повторяют GitHub CI, релиз собирает те же пакеты и публикуется официальным `actions/create-release@v1`.
- Только проверки отклонены пользователем: релизы также нужны.
- Копирование GitHub release без адаптации невозможно: `gh`, `GH_TOKEN` и GitHub Releases API не работают с GitVerse.

## Реализация
- `check.yml`: push/pull_request, checkout, системные зависимости Tauri, Node 24, Rust stable, npm/Rust-тесты, аудит и сборка frontend.
- `release.yml`: push аннотированного тега, полный набор проверок, `npm run app:build`, tar.gz + доступные DEB/RPM/AppImage, создание или обновление релиза с текстом аннотированного тега.
- Оба job: `runs-on: ubuntu-latest`; релизному задаётся `timeout-minutes: 60`.
- Для публикации используется `${{ secrets.GITVERSE_API_KEY }}`; пользователь добавит одноимённый секрет с правом «Репозитории → Запись» в настройках GitVerse.
- Текущие `.github/` и `.gitea/` не изменяются.

## Проверка
Валидировать YAML, выполнить локально команды проверок и сравнить состав релизных файлов с GitHub workflow. Фактический запуск и публикация проверяются после push в GitVerse; до настройки секрета шаг релиза авторизации не пройдёт.
