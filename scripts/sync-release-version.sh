#!/usr/bin/env bash
# Обновляет версии манифестов и создаёт версионный коммит перед тегом.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1#v}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Ожидается версия вида vMAJOR.MINOR.PATCH" >&2
    exit 1
fi
for file in src-tauri/Cargo.toml package.json package-lock.json; do
    if [[ ! -f "$file" ]]; then
        echo "Синхронизация версий неприменима: нет $file" >&2
        exit 1
    fi
done
if [[ -n "$(git status --porcelain)" ]]; then
    echo "Рабочая директория должна быть чистой перед релизом" >&2
    exit 1
fi

python3 - "$VERSION" <<'PY'
from pathlib import Path
import re
import sys

path = Path("src-tauri/Cargo.toml")
text = path.read_text()
updated, count = re.subn(r'(?m)^version = "[^"]+"$', f'version = "{sys.argv[1]}"', text, count=1)
if count != 1:
    raise SystemExit("Не удалось обновить version в src-tauri/Cargo.toml")
path.write_text(updated)
PY
npm version "$VERSION" --no-git-tag-version
cargo check
cargo test --workspace
npm run build

git add src-tauri/Cargo.toml Cargo.lock package.json package-lock.json
git commit -m "Фаза 7: подготовлен релиз v${VERSION}"
