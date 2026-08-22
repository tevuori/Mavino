#!/usr/bin/env python3
"""Regenerate every Mavino icon/splash asset from the master logo.

Source of truth: assets/logo.png (transparent-background rounded tile artwork).

Usage:
    python3 scripts/generate-icons.py

Writes:
    client/public/{favicon-16,favicon-32,apple-touch-icon,icon-192,icon-512,icon-maskable-512}.png
    android/app/src/main/res/mipmap-*/{ic_launcher,ic_launcher_round,ic_launcher_foreground}.png
    android/app/src/main/res/drawable*/splash.png
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "logo.png"
PUBLIC = ROOT / "client" / "public"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

BRAND_BG = (12, 11, 32, 255)  # #0C0B20 — the deep navy behind the new Mavino "M" mark

LAUNCHER_DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND_DENSITIES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
SPLASH_SIZES = {
    "drawable": (480, 320),
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
}


def artwork() -> Image.Image:
    """The logo cropped to its visible bounds."""
    img = Image.open(SOURCE).convert("RGBA")
    return img.crop(img.getbbox())


def fitted(art: Image.Image, size: int, scale: float) -> Image.Image:
    """Center `art` on a transparent `size`×`size` canvas at `scale` of the canvas."""
    box = max(1, round(size * scale))
    resized = art.copy()
    resized.thumbnail((box, box), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2), resized)
    return canvas


def on_square(art: Image.Image, size: int, scale: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BRAND_BG)
    canvas.alpha_composite(fitted(art, size, scale))
    return canvas


def on_circle(art: Image.Image, size: int, scale: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).ellipse((0, 0, size - 1, size - 1), fill=BRAND_BG)
    canvas.alpha_composite(fitted(art, size, scale))
    return canvas


def save(img: Image.Image, path: Path, rgb: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    (img.convert("RGB") if rgb else img).save(path)
    print(f"wrote {path.relative_to(ROOT)} ({img.width}x{img.height})")


def main() -> None:
    art = artwork()

    # Web / PWA
    for name, size in (("favicon-16", 16), ("favicon-32", 32), ("icon-192", 192), ("icon-512", 512)):
        save(fitted(art, size, 0.96), PUBLIC / f"{name}.png")
    save(on_square(art, 180, 0.82), PUBLIC / "apple-touch-icon.png")
    save(on_square(art, 512, 0.62), PUBLIC / "icon-maskable-512.png")

    # Android launcher
    for density, size in LAUNCHER_DENSITIES.items():
        save(fitted(art, size, 0.96), RES / f"mipmap-{density}" / "ic_launcher.png")
        save(on_circle(art, size, 0.66), RES / f"mipmap-{density}" / "ic_launcher_round.png")
    for density, size in FOREGROUND_DENSITIES.items():
        save(fitted(art, size, 0.62), RES / f"mipmap-{density}" / "ic_launcher_foreground.png")

    # Android splash
    for folder, (width, height) in SPLASH_SIZES.items():
        canvas = Image.new("RGBA", (width, height), BRAND_BG)
        logo = fitted(art, round(min(width, height) * 0.4), 1.0)
        canvas.alpha_composite(logo, ((width - logo.width) // 2, (height - logo.height) // 2))
        save(canvas, RES / folder / "splash.png", rgb=True)


if __name__ == "__main__":
    main()
