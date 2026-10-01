#!/usr/bin/env bash
# Быстрая сборка git-версии Logtask для тестирования.
# Версия = <число коммитов>.0.0+<короткий хеш> (например 29.0.0+a1b2c3d) —
# tauri-build требует semver, поэтому хеш идёт в build-метаданные;
# незакоммиченные изменения добавляют суффикс -dirty.
#
# Использование:
#   ./build-git.sh           — быстрый release-бинарник (target/release/logtask)
#   ./build-git.sh --bundle  — полные пакеты (AppImage/rpm/deb в target/release/bundle)
#
# Версия подмешивается в конфиг Tauri через TAURI_CONFIG — tauri.conf.json
# при этом не меняется.
set -euo pipefail
cd "$(dirname "$0")"

COUNT=$(git rev-list --count HEAD)
HASH=$(git rev-parse --short HEAD)
VERSION="${COUNT}.0.0+${HASH}"
if ! git diff --quiet || ! git diff --cached --quiet; then
    VERSION="${VERSION}-dirty"
fi
export TAURI_CONFIG="{\"version\": \"${VERSION}\"}"

echo "▶ Сборка Logtask ${VERSION}"

if [ "${1:-}" = "--bundle" ]; then
    # tauri build сам соберёт фронтенд (beforeBuildCommand) и бинарник
    npx tauri build
    echo
    echo "✔ Пакеты готовы:"
    ls -1 target/release/bundle/appimage/ target/release/bundle/rpm/ target/release/bundle/deb/ 2>/dev/null || true
else
    npm run build
    cargo build --release
    echo
    echo "✔ Готово: target/release/logtask (версия ${VERSION})"
    echo "  Запуск: ./target/release/logtask"
fi
