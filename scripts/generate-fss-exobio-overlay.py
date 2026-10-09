"""
Draws the FSS Exobio Overlay's texture, preview and thumbnail into resources/edhm.

    python scripts/generate-fss-exobio-overlay.py

Everything is drawn here, nothing is copied from the FSS-Overlay mod: only the positions of the
bands on the game's frequency bar are measured facts. The texture is laid over the FSS by the
FSS-Overlay mod's own shaders, which add its RGB onto the screen and ignore its alpha, so black
is transparent and "opacity" means scaling the colour down. Needs Pillow and Windows' Bahnschrift.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

MOD = Path(__file__).resolve().parent.parent / 'resources/edhm/3rdPartyMods/FSS-Overlay-Exobio'
SIZE = (3840, 2160)

# Where each body type sits on the frequency bar, in texture pixels, left to right. Only these
# can have life: Metal Rich, High Metal Content, Rocky, Icy, Rocky Ice.
BANDS = [('MR', 1706, 1748), ('HMC', 1748, 1802), ('R', 1802, 1855), ('I', 1855, 1892),
         ('RI', 1892, 1959)]
TOP, BOTTOM = 1620, 1769
LABEL_BASELINE = 1652

FILL = (40, 150, 95)
LINE = (70, 255, 170)
LABEL = (150, 255, 200)
OPACITY = 0.5

FONT = ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf', 21)


def draw() -> Image.Image:
    out = Image.new('RGB', SIZE, (0, 0, 0))
    pen = ImageDraw.Draw(out)

    for _, x0, x1 in BANDS:
        for y in range(TOP + 3, BOTTOM + 1):
            # Dark at the top, full strength ~115 px down, so the labels stay readable.
            t = min(1.0, max(0.0, (y - TOP) / 115)) ** 1.6
            pen.line([(x0 + 2, y), (x1 - 1, y)], fill=tuple(int(v * t) for v in FILL))

    for x in sorted({edge for _, x0, x1 in BANDS for edge in (x0, x1)}):
        pen.rectangle([x, TOP, x + 1, BOTTOM], fill=LINE)

    for name, x0, x1 in BANDS:
        pen.text(((x0 + x1) / 2 + 1, LABEL_BASELINE), name, fill=LABEL, font=FONT, anchor='ms')

    return out.point(lambda v: int(v * OPACITY))


def main() -> None:
    texture = draw()
    (MOD / 'Textures').mkdir(parents=True, exist_ok=True)
    (MOD / 'assets').mkdir(parents=True, exist_ok=True)
    texture.save(MOD / 'Textures/FSS-Overlay-Exobio.png', optimize=True)
    # The part of the screen the overlay covers, for EDHM-UI's read-me.
    texture.crop((1000, 1500, 2800, 2000)).save(MOD / 'assets/Overlay-Exobio.png', optimize=True)
    # EDHM-UI's mod list shows a 200x61 thumbnail, at full strength so it can be seen.
    thumb = texture.crop((1640, 1600, 2030, 1719)).point(lambda v: min(255, v * 2))
    thumb.resize((200, 61), Image.LANCZOS).save(MOD / 'FSS-Overlay-Exobio.png', optimize=True)


if __name__ == '__main__':
    main()
