from __future__ import annotations

from pathlib import Path
import shutil

from PIL import Image


ROOT = Path(__file__).resolve().parents[4]
MASTER = Path(__file__).resolve().parent
WEB = ROOT / "apps/web/public"
APP_PUBLICS = [
    ROOT / "apps/gu/web/public",
    ROOT / "apps/gzh/web/public",
    ROOT / "apps/project/web/public",
    ROOT / "apps/me/web/public",
    ROOT / "apps/health/apps/web/public",
]


def crop_alpha(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    bounds = rgba.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("Cannot export an empty image")
    return rgba.crop(bounds)


def place(image: Image.Image, size: tuple[int, int], margin: int) -> Image.Image:
    artwork = crop_alpha(image)
    inner_width = size[0] - margin * 2
    inner_height = size[1] - margin * 2
    scale = min(inner_width / artwork.width, inner_height / artwork.height)
    artwork = artwork.resize(
        (round(artwork.width * scale), round(artwork.height * scale)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", size)
    canvas.alpha_composite(
        artwork,
        ((size[0] - artwork.width) // 2, (size[1] - artwork.height) // 2),
    )
    return canvas


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)


def save_webp(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="WEBP", lossless=True, method=6)


def main() -> None:
    nav_light = Image.open(MASTER / "codepi-nav-light-transparent.png")
    nav_dark = Image.open(MASTER / "codepi-nav-dark-transparent.png")
    symbol_light = Image.open(MASTER / "codepi-symbol-light-transparent.png")
    symbol_dark = Image.open(MASTER / "codepi-symbol-dark-transparent.png")

    logo_light = place(nav_light, (1288, 316), 28)
    logo_dark = place(nav_dark, (1288, 316), 28)
    symbol = place(symbol_light, (348, 316), 16)
    symbol_dark_runtime = place(symbol_dark, (348, 316), 16)
    symbol_square = place(symbol_light, (512, 512), 42)
    symbol_square_dark = place(symbol_dark, (512, 512), 42)

    brand = WEB / "brand"
    png_assets = {
        "codepi-logo.png": logo_light,
        "codepi-logo-light.png": logo_light,
        "wordmark-light.png": logo_light,
        "codepi-logo-dark.png": logo_dark,
        "wordmark-dark.png": logo_dark,
        "codepi-symbol.png": symbol,
        "codepi-symbol-dark.png": symbol_dark_runtime,
        "codepi-symbol-512.png": symbol_square,
        "codepi-symbol-dark-512.png": symbol_square_dark,
    }
    for name, image in png_assets.items():
        save_png(image, brand / name)

    for name, image in {
        "codepi-logo.webp": logo_light,
        "codepi-logo-dark.webp": logo_dark,
        "codepi-symbol.webp": symbol,
        "codepi-symbol-dark.webp": symbol_dark_runtime,
    }.items():
        save_webp(image, brand / name)

    for width in (450, 900):
        height = round(316 * width / 1288)
        for stem, image in (("codepi-logo", logo_light), ("codepi-logo-dark", logo_dark)):
            resized = image.resize((width, height), Image.Resampling.LANCZOS)
            save_png(resized, brand / f"{stem}-{width}w.png")
            save_webp(resized, brand / f"{stem}-{width}w.webp")

    icons: dict[int, Image.Image] = {}
    for size in (16, 32, 48, 64, 180):
        icons[size] = place(symbol_light, (size, size), 0)
        save_png(icons[size], WEB / f"favicon-{size}.png")
    save_png(icons[180], WEB / "apple-touch-icon.png")
    icons[180].save(WEB / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])

    for public in APP_PUBLICS:
        (public / "brand").mkdir(parents=True, exist_ok=True)
        for name in ("codepi-symbol.png", "codepi-symbol.webp"):
            shutil.copy2(brand / name, public / "brand" / name)
        if public == APP_PUBLICS[0]:
            for name in ("codepi-symbol-dark.png", "codepi-symbol-dark.webp"):
                shutil.copy2(brand / name, public / "brand" / name)
        for name in ("favicon-16.png", "favicon-32.png", "favicon.ico", "apple-touch-icon.png"):
            shutil.copy2(WEB / name, public / name)


if __name__ == "__main__":
    main()
