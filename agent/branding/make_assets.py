"""Rasterise the branding SVGs into the Windows assets installer.iss needs.

    py -3 branding/make_assets.py          (run from the agent directory)

Produces, next to the sources:

    deskwarrant.ico     app + setup icon, 16..256
    WizardLarge*.bmp    installer welcome banner, 164x314 and multiples
    WizardSmall*.bmp    installer header mark, 55x55 and multiples

Inno Setup takes BMP for wizard images and ICO for the setup icon; neither
understands SVG, so the raster files are committed alongside the sources. Rerun
this whenever an SVG changes.

There is no pure-Python SVG rasteriser here on purpose. cairosvg pulls a native
Cairo build that is painful to install on Windows, and the agent's requirements
are meant to stay installable from a clean machine with nothing but pip. Edge
ships with every supported Windows, renders the filters and gradients this
artwork uses correctly, and is already the reference renderer for the console —
so it is what draws these.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent

# 16-48 come from the simplified mark; the full seal's engraved legend and
# hairline rings become grey noise below about 64px.
ICO_FROM_MARK = (16, 20, 24, 32, 40, 48)
ICO_FROM_SEAL = (64, 96, 128, 256)

# Inno picks the variant closest to the current scaling factor and rescales it,
# so three cover the range: 100%, 150%, 200%. BMP is uncompressed and these are
# committed, so every extra scale is another megabyte in the repo for a
# difference nobody can see.
WIZARD_LARGE = (164, 314)
WIZARD_SMALL = (55, 55)
SCALES = (1.0, 1.5, 2.0)

BROWSER_CANDIDATES = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
)


def find_browser(override: str | None) -> str:
    if override:
        if not Path(override).exists():
            sys.exit(f"--browser does not exist: {override}")
        return override
    for candidate in BROWSER_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    found = shutil.which("msedge") or shutil.which("chrome")
    if found:
        return found
    sys.exit(
        "No Chromium browser found. Pass --browser with a path to msedge.exe "
        "or chrome.exe."
    )


def render(browser: str, svg: Path, width: int, height: int) -> Image.Image:
    """Screenshot one SVG at an exact pixel size, on a transparent ground.

    Headless Chromium on Windows refuses to open a window narrower than about
    500px and silently crops the screenshot instead — which looks like a broken
    layout rather than a clamped window. Anything narrower is therefore rendered
    oversized and scaled down here, which also gives cleaner edges than letting
    the browser rasterise at the final size.
    """
    scale = max(1, -(-500 // width))  # ceil, so width * scale >= 500
    shot_w, shot_h = width * scale, height * scale

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        page = tmp_path / "page.html"
        page.write_text(
            "<!doctype html><meta charset='utf-8'>"
            "<style>html,body{margin:0;padding:0;background:transparent;"
            f"width:{shot_w}px;height:{shot_h}px;overflow:hidden}}"
            "img{display:block;width:100%;height:100%}</style>"
            f"<img src='{svg.as_uri()}'>",
            encoding="utf-8",
        )
        out = tmp_path / "shot.png"

        subprocess.run(
            [
                browser,
                "--headless=new",
                "--disable-gpu",
                "--hide-scrollbars",
                "--force-device-scale-factor=1",
                "--default-background-color=00000000",
                f"--screenshot={out}",
                f"--window-size={shot_w},{shot_h}",
                "--virtual-time-budget=5000",
                page.as_uri(),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        if not out.exists():
            sys.exit(f"The browser produced no screenshot for {svg.name}.")

        image = Image.open(out).convert("RGBA")

    if image.size != (width, height):
        image = image.resize((width, height), Image.LANCZOS)
    return image


def flatten(image: Image.Image, background: tuple[int, int, int]) -> Image.Image:
    """BMP carries no usable alpha for Inno, so composite before saving."""
    ground = Image.new("RGB", image.size, background)
    ground.paste(image, mask=image.getchannel("A"))
    return ground


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", help="Path to msedge.exe or chrome.exe")
    args = parser.parse_args()

    browser = find_browser(args.browser)
    print(f"renderer: {browser}")

    seal = HERE / "logo.svg"
    mark = HERE / "logo-mark.svg"
    banner = HERE / "wizard-large.svg"
    for source in (seal, mark, banner):
        if not source.exists():
            sys.exit(f"Missing source: {source}")

    # ---- icon -----------------------------------------------------------
    frames = [render(browser, mark, size, size) for size in ICO_FROM_MARK]
    frames += [render(browser, seal, size, size) for size in ICO_FROM_SEAL]

    ico = HERE / "deskwarrant.ico"
    # Pillow builds the directory from `sizes`, downscaling the image it is
    # called on. Handing it the largest frame and letting it resize would throw
    # away the hand-tuned small mark, so each frame is appended as-is.
    #
    # bitmap_format="bmp" matters. Pillow defaults to PNG-compressing every
    # frame, which is legal in an .ico file but not what a Win32 RT_ICON
    # resource has historically accepted below 256px — and SetupIconFile ends up
    # as exactly that resource on Setup.exe. DIB frames cost a few hundred KB
    # against a ~60MB installer and remove the question entirely.
    frames[-1].save(
        ico,
        format="ICO",
        bitmap_format="bmp",
        sizes=[(f.width, f.height) for f in frames],
        append_images=frames[:-1],
    )
    print(f"wrote {ico.name} ({', '.join(str(f.width) for f in frames)})")

    # ---- wizard images --------------------------------------------------
    # The modern wizard draws these on the page's white ground.
    white = (255, 255, 255)

    for scale in SCALES:
        w = round(WIZARD_LARGE[0] * scale)
        h = round(WIZARD_LARGE[1] * scale)
        name = f"WizardLarge-{w}x{h}.bmp"
        flatten(render(browser, banner, w, h), white).save(HERE / name, format="BMP")
        print(f"wrote {name}")

    for scale in SCALES:
        w = round(WIZARD_SMALL[0] * scale)
        h = round(WIZARD_SMALL[1] * scale)
        name = f"WizardSmall-{w}x{h}.bmp"
        flatten(render(browser, mark, w, h), white).save(HERE / name, format="BMP")
        print(f"wrote {name}")

    print("done")


if __name__ == "__main__":
    if os.name != "nt":
        print("warning: written for Windows; paths and Inno assets assume it")
    main()
