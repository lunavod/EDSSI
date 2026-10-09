"""
Draws EDSSI's icon, a ship leaving an orange planet, into build/.

    python scripts/generate-icon.py

icon.ico is what electron-builder gives the installer and the exe (buildResources is build/);
icon.png is the window's own icon, which only shows while running from source, as a packaged
window takes the exe's. The shapes are laid out on a 64-unit grid and drawn 16 times larger, then
scaled down to each size, so small sizes are antialiased rather than drawn at that size.
Needs Pillow.
"""

from pathlib import Path

from PIL import Image, ImageDraw

BUILD = Path(__file__).resolve().parent.parent / 'build'

TILE = (20, 16, 12)
PLANET = (255, 113, 0)  # hud.css' --accent
SHIP = (255, 210, 168)

GRID = 64
SCALE = 16
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]


def draw() -> Image.Image:
    s = SCALE
    big = Image.new('RGB', (GRID * s, GRID * s), TILE)
    pen = ImageDraw.Draw(big)
    # The planet sits mostly below the tile, so only its top shows.
    pen.ellipse(((32 - 38) * s, (76 - 38) * s, (32 + 38) * s, (76 + 38) * s), fill=PLANET)

    # The ship: an arrowhead with a notched tail, its corners rounded by a stroke around it.
    ship = [(32, 12), (41, 32), (32, 27), (23, 32)]
    points = [(x * s, y * s) for x, y in ship]
    pen.polygon(points, fill=SHIP)
    width = 2 * s
    pen.line(points + [points[0]], fill=SHIP, width=width, joint='curve')
    for x, y in points:
        pen.ellipse((x - width / 2, y - width / 2, x + width / 2, y + width / 2), fill=SHIP)

    # The tile's rounded corners are transparent.
    tile = Image.new('L', big.size, 0)
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, GRID * s - 1, GRID * s - 1), radius=14 * s,
                                           fill=255)
    big.putalpha(tile)
    return big


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    big = draw()
    big.resize((512, 512), Image.LANCZOS).save(BUILD / 'icon.png')
    sizes = [big.resize((n, n), Image.LANCZOS) for n in ICO_SIZES]
    sizes[-1].save(BUILD / 'icon.ico', sizes=[(n, n) for n in ICO_SIZES],
                   append_images=sizes[:-1])


if __name__ == '__main__':
    main()
