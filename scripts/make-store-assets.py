"""
Chrome Web Store graphics for Tab Warden.

Takes the captured popup and builds the images the store asks for:

    docs/store/screenshot-1.png     1280x800   at least one is required
    docs/store/promo-440x280.png     440x280   small promo tile
    docs/store/marquee-1400x560.png 1400x560   optional marquee tile

The popup half of each image is the real PNG capture, so the listing shows the
actual UI. Runs on Pillow only, no other dependency. Re-run it after any popup
change: npm run store-assets
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = DOCS / "store"

BG = (15, 19, 26)
BG2 = (21, 26, 36)
PANEL = (23, 26, 33)
TEXT = (230, 232, 238)
MUTED = (154, 163, 178)
BORDER = (38, 43, 54)
ACCENT = (79, 140, 255)
WARN = (224, 163, 74)
HOT = (226, 114, 91)

REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def load_font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else REGULAR, size)


def backdrop(size):
    """Vertical gradient, barely visible, so the flat background is not dead."""
    width, height = size
    img = Image.new("RGB", size, BG)
    draw = ImageDraw.Draw(img)

    for y in range(height):
        t = y / max(height - 1, 1)
        color = tuple(round(a + (b - a) * t) for a, b in zip(BG, BG2))
        draw.line([(0, y), (width, y)], fill=color)

    return img


def wrap(draw, text, font, max_width):
    """Greedy word wrap. Returns a list of lines that fit max_width."""
    lines = []
    current = ""

    for word in text.split():
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word

    if current:
        lines.append(current)

    return lines


def paragraph(draw, xy, text, font, fill, max_width, line_gap=8):
    """Draws wrapped text and returns the y just below the last line."""
    x, y = xy
    step = font.size + line_gap

    for line in wrap(draw, text, font, max_width):
        draw.text((x, y), line, font=font, fill=fill)
        y += step

    return y


def bullets(draw, xy, items, font, fill, dot=ACCENT, gap=40, text_offset=26):
    x, y = xy

    for item in items:
        draw.ellipse([x, y + font.size // 2 - 3, x + 6, y + font.size // 2 + 3], fill=dot)
        draw.text((x + text_offset, y), item, font=font, fill=fill)
        y += gap

    return y


def rounded_panel(img, box, radius, fill, outline=None, width=1):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)
    img.alpha_composite(layer)


def drop_shadow(img, box, radius, blur=22, alpha=150, offset=(0, 12)):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    moved = [box[0] + offset[0], box[1] + offset[1], box[2] + offset[0], box[3] + offset[1]]
    ImageDraw.Draw(layer).rounded_rectangle(moved, radius=radius, fill=(0, 0, 0, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    img.alpha_composite(layer)


def popup_image(target_height):
    """Scales the popup capture to target_height, preferring the 2x capture."""
    source = DOCS / "screenshot@2x.png"
    if not source.exists():
        source = DOCS / "screenshot.png"

    shot = Image.open(source).convert("RGB")
    width = round(shot.width * target_height / shot.height)
    return shot.resize((width, target_height), Image.LANCZOS)


def popup_card(img, x, y, target_height, radius=18, pad=12):
    """Draws the popup on a rounded card with a soft shadow."""
    shot = popup_image(target_height)
    card = [x - pad, y - pad, x + shot.width + pad, y + shot.height + pad]

    drop_shadow(img, card, radius)
    rounded_panel(img, card, radius, PANEL + (255,), BORDER + (255,))

    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, shot.width - 1, shot.height - 1], radius=radius - 4, fill=255)
    img.paste(shot, (x, y), mask)

    return shot.size


def brand_row(img, x, y, icon_size, name_size, gap=16):
    icon = Image.open(ROOT / "public" / "assets" / "icon-128.png").convert("RGBA")
    icon = icon.resize((icon_size, icon_size), Image.LANCZOS)
    img.alpha_composite(icon, (x, y))

    draw = ImageDraw.Draw(img)
    draw.text((x + icon_size + gap, y + 2), "Tab Warden", font=load_font(name_size, True), fill=TEXT)

    return y + icon_size


def make_screenshot():
    img = backdrop((1280, 800)).convert("RGBA")
    draw = ImageDraw.Draw(img)

    left = 80
    brand_row(img, left, 62, 44, 24)

    headline = load_font(52, True)
    draw.text((left, 150), "Find the copies.", font=headline, fill=TEXT)
    draw.text((left, 212), "Unload the idle ones.", font=headline, fill=TEXT)

    body_end = paragraph(
        draw,
        (left, 312),
        "Tab Warden finds the same page opened from different links, lists every tab grouped "
        "by site, and frees the tabs you have not touched in days.",
        load_font(21),
        MUTED,
        600,
        line_gap=10,
    )

    bullets(
        draw,
        (left, body_end + 38),
        [
            "Finds copies even when the tracking links differ",
            "Shows the tabs that have been sitting idle",
            "Unloads them without closing them",
        ],
        load_font(20),
        TEXT,
    )

    draw.text((left, 700), "Runs on your device. No network calls, no analytics.", font=load_font(16), fill=MUTED)

    card_h = 744
    card_w = popup_image(card_h).width
    popup_card(img, 1280 - 80 - card_w, 28, card_h)

    img.convert("RGB").save(OUT / "screenshot-1.png")


def make_promo():
    img = backdrop((440, 280)).convert("RGBA")
    draw = ImageDraw.Draw(img)

    brand_row(img, 32, 34, 56, 27)
    draw.text((32, 146), "Find duplicates, free memory.", font=load_font(17), fill=TEXT)
    draw.text((32, 174), "Grouped by site. Pinned tabs kept.", font=load_font(17), fill=MUTED)

    img.convert("RGB").save(OUT / "promo-440x280.png")


def make_marquee():
    img = backdrop((1400, 560)).convert("RGBA")
    draw = ImageDraw.Draw(img)

    left = 90
    brand_row(img, left, 62, 48, 26)

    headline = load_font(54, True)
    draw.text((left, 176), "Find the copies.", font=headline, fill=TEXT)
    draw.text((left, 240), "Unload the idle ones.", font=headline, fill=TEXT)

    paragraph(
        draw,
        (left, 340),
        "Finds the same page opened from different links, groups every tab by site, and "
        "unloads the tabs you have not touched in days.",
        load_font(21),
        MUTED,
        640,
        line_gap=10,
    )

    card_h = 480
    card_w = popup_image(card_h).width
    popup_card(img, 1400 - 90 - card_w, 40, card_h)

    img.convert("RGB").save(OUT / "marquee-1400x560.png")


def main():
    if not (DOCS / "screenshot@2x.png").exists() and not (DOCS / "screenshot.png").exists():
        raise SystemExit("no popup capture found in docs/. Capture the popup first.")

    OUT.mkdir(parents=True, exist_ok=True)

    make_screenshot()
    make_promo()
    make_marquee()

    for name in ("screenshot-1.png", "promo-440x280.png", "marquee-1400x560.png"):
        path = OUT / name
        size = Image.open(path).size
        print(f"{path.relative_to(ROOT)}  {size[0]}x{size[1]}  {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
