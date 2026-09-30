#!/usr/bin/env python3
"""Генератор PNG-иконок для Tauri (нужен PIL: pip install pillow)."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
os.makedirs(OUT, exist_ok=True)


def make(size: int, path: str) -> None:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = size // 6
    # корпус — тёмно-бирюзовый квадрат как у логсека, только проще
    d.rounded_rectangle([pad, pad, size - pad, size - pad],
                        radius=size // 7, fill=(2, 54, 67, 255))
    # «пуля» журнала и галка задачи
    bp = size // 3
    d.ellipse([bp - size // 14, bp + size // 24, bp + size // 14, bp + size // 8],
              fill=(232, 237, 242, 255))
    lw = max(2, size // 10)
    d.line([size // 3, size * 5 // 12, size * 9 // 20, size * 5 // 8],
           fill=(16, 107, 163, 255), width=lw)
    d.line([size * 9 // 20, size * 5 // 8, size * 5 // 6, size // 3],
           fill=(16, 107, 163, 255), width=lw)
    img.save(path)
    print(path)


for s in (32, 128):
    make(s, os.path.join(OUT, f"{s}x{s}.png"))
make(256, os.path.join(OUT, "128x128@2x.png"))
