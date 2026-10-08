"""
Tab Warden icon.

Two overlapping cards: the front one bright (the tab you keep), the back one
dimmed and offset (the duplicate). Reads as "dedupe" at 16px and still looks
deliberate at 128px.

Drawn at 512px and downsampled, because shape edges drawn straight at 16px come
out jagged. LANCZOS on the downscale is what gives clean antialiasing.
"""
from pathlib import Path

from PIL import Image, ImageDraw

BG = (15, 19, 26, 255)
KEEP = (91, 194, 255, 255)
DUP = (56, 68, 86, 255)
EDGE = (86, 91, 102, 255)

OUT = Path(__file__).resolve().parent.parent / "public" / "assets"
OUT.mkdir(parents=True, exist_ok=True)

SS = 4  # supersample factor


def rounded(draw, box, radius, fill, outline=None, width=0):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_at(scale):
    """Draw the mark at the given scale, in the 128-unit design grid."""
    im = Image.new("RGBA", (128 * scale, 128 * scale), BG)
    d = ImageDraw.Draw(im)

    def s(v):
        return v * scale

    # Back card: the duplicate. Offset up and right so both stay visible.
    rounded(
        d,
        [s(44), s(26), s(110), s(88)],
        radius=s(11),
        fill=DUP,
        outline=EDGE,
        width=max(1, s(2)),
    )

    # Front card: the tab you keep.
    rounded(d, [s(18), s(44), s(84), s(110)], radius=s(11), fill=KEEP)

    # One thick text line only. At 16px two lines turn to mush, and the single
    # bar still reads as a page.
    rounded(d, [s(31), s(70), s(71), s(79)], radius=s(4), fill=BG)

    return im


def main():
    big = draw_at(SS)

    for size in (128, 48, 16):
        out = big.resize((size, size), Image.LANCZOS)
        path = OUT / f"icon-{size}.png"
        out.save(path)
        print(f"icon-{size}.png  {size}x{size}  {out.size}")


if __name__ == "__main__":
    main()