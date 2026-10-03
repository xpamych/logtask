#!/usr/bin/env python3
"""Генератор PNG-иконок для Tauri из SVG-мастера src-tauri/icons/icon.svg.

Нужен inkscape в PATH. Правьте icon.svg и перезапускайте скрипт.
"""
import os
import subprocess

ICONS = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
SRC = os.path.join(ICONS, "icon.svg")

# (выходной файл, размер стороны в px)
TARGETS = [
    ("32x32.png", 32),
    ("128x128.png", 128),
    ("128x128@2x.png", 256),
]


def make(size: int, path: str) -> None:
    subprocess.run(
        ["inkscape", SRC, "-w", str(size), "-h", str(size), "-o", path],
        check=True,
    )
    print(path)


def main() -> None:
    for name, size in TARGETS:
        make(size, os.path.join(ICONS, name))
    # иконка для фронтенда (index.html)
    make(128, os.path.join(os.path.dirname(__file__), "..", "public", "icon.png"))


if __name__ == "__main__":
    main()
