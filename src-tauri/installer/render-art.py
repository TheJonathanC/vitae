"""Renders the app icon master and the installer artwork into src-tauri/icons/.

  app-icon.png           1024px master for `npx tauri icon` (all platform icons)
  installer-sidebar.bmp  NSIS welcome/finish sidebar   (164x314)
  installer-header.bmp   NSIS inner-page header image  (150x57)
  banner.png             WiX (MSI) dialog banner       (493x58)
  dialog.png             WiX (MSI) welcome background  (493x312)

Usage: python3 src-tauri/installer/render-art.py   (requires Pillow)
       npx tauri icon src-tauri/icons/app-icon.png
Colors come from the app's dark theme (src/styles.css) and must stay in sync
with the VITAE_* defines in installer.nsi and with public/favicon.svg.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ICONS = Path(__file__).resolve().parent.parent / "icons"
SS = 4  # supersampling factor

BG = (20, 25, 28)  # --chrome (dark), matches VITAE_BG
TEXT = (228, 233, 230)  # --ink (dark)
MUTED = (141, 152, 147)  # --ink-3 (dark)
FAINT = (61, 72, 78)  # --rule-strong (dark)
RULE = (43, 52, 57)  # --rule (dark)
ACCENT = (120, 194, 164)  # --accent (dark), the mint cell
MAT = (30, 61, 51)  # --mat (dark), the icon tile
MAT_INK = (230, 239, 234)  # --mat-ink, the paper cell
LIGHT = (243, 245, 244)  # --chrome (light)
LIGHT_RULE = (221, 226, 223)  # --rule (light)
INK = (29, 39, 49)  # --ink (light)

FONT_DIRS = [
    Path("/usr/share/texmf/fonts/opentype/public/lm"),
    Path("/usr/share/texlive/texmf-dist/fonts/opentype/public/lm"),
    Path("/usr/share/fonts/opentype/lm"),
    Path("/Library/TeX/Root/texmf-dist/fonts/opentype/public/lm"),
    Path("C:/texlive/2024/texmf-dist/fonts/opentype/public/lm"),
]


def font(name, size):
    for d in FONT_DIRS:
        if (d / name).exists():
            return ImageFont.truetype(str(d / name), size * SS)
    raise SystemExit(f"Latin Modern font {name} not found; install TeX Live / lm fonts")


def canvas(w, h, color):
    return Image.new("RGB", (w * SS, h * SS), color)


def glow(img, cx, cy, radius, color, alpha):
    layer = Image.new("RGBA", img.size, color + (0,))
    d = ImageDraw.Draw(layer)
    r = radius * SS
    d.ellipse((cx * SS - r, cy * SS - r, cx * SS + r, cy * SS + r), fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(r * 0.6))
    img.paste(layer, (0, 0), layer)


def mark_image(px):
    """The app mark at px x px (RGBA): the cutting mat's 4x4 grid with two lit cells."""
    s = px * SS
    u = s / 64  # one unit of the 64-unit design grid
    tile = Image.new("RGB", (s, s), MAT)
    d = ImageDraw.Draw(tile, "RGBA")  # RGB base + RGBA draw blends the translucent grid
    for i in (16, 32, 48):
        d.rectangle((i * u - u / 2, 0, i * u + u / 2, s), fill=(255, 255, 255, 31))
        d.rectangle((0, i * u - u / 2, s, i * u + u / 2), fill=(255, 255, 255, 31))
    d.rectangle((32 * u, 16 * u, 48 * u, 32 * u), fill=ACCENT)
    d.rectangle((16 * u, 32 * u, 32 * u, 48 * u), fill=MAT_INK)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=14 * u, fill=255)
    tile = tile.convert("RGBA")
    tile.putalpha(mask)
    return tile


def mark(img, x, y, size):
    tile = mark_image(size)
    img.paste(tile, (round(x * SS), round(y * SS)), tile)


def app_icon():
    tile = mark_image(1024)
    tile.resize((1024, 1024), Image.LANCZOS).save(ICONS / "app-icon.png")
    print("app-icon.png: 1024x1024")


def save(img, name):
    w, h = img.width // SS, img.height // SS
    out = img.resize((w, h), Image.LANCZOS)
    path = ICONS / name
    out.save(path, format="BMP" if name.endswith(".bmp") else "PNG")
    print(f"{name}: {w}x{h}")


def brand_panel(img, width, height):
    """Dark branded panel shared by the NSIS sidebar and the WiX dialog."""
    glow(img, 30, 50, 70, ACCENT, 40)
    glow(img, width, height, 90, MAT, 160)
    d = ImageDraw.Draw(img)
    mark(img, 16, 28, 44)
    d.text((16 * SS, 84 * SS), "Vitae", font=font("lmroman10-regular.otf", 34), fill=TEXT, anchor="lt")
    d.text((17 * SS, 122 * SS), "LaTeX résumé editor", font=font("lmroman10-regular.otf", 11), fill=MUTED, anchor="lt")


def sidebar():
    w, h = 164, 314
    img = canvas(w, h, BG)
    brand_panel(img, w, h)
    d = ImageDraw.Draw(img)
    mono = font("lmmono10-regular.otf", 10)
    lines = [
        ("\\begin", "{document}", 0),
        ("\\section", "{Experience}", 1),
        ("\\textbf", "{Engineer}", 1),
        ("\\hfill", " 2024 -- now", 1),
        ("\\begin", "{itemize}", 1),
        ("\\item", " Shipped ...", 2),
        ("\\end", "{itemize}", 1),
        ("\\end", "{document}", 0),
    ]
    y = 160
    for cmd, rest, indent in lines:
        x = (16 + indent * 10) * SS
        d.text((x, y * SS), cmd, font=mono, fill=ACCENT, anchor="lt")
        x += d.textlength(cmd, font=mono)
        d.text((x, y * SS), rest, font=mono, fill=FAINT, anchor="lt")
        y += 15
    d.line((16 * SS, (h - 26) * SS, (w - 16) * SS, (h - 26) * SS), fill=RULE, width=SS)
    d.text((16 * SS, (h - 17) * SS), "offline  ·  native  ·  fast", font=font("lmroman10-regular.otf", 9), fill=MUTED, anchor="lm")
    save(img, "installer-sidebar.bmp")


def wordmark_right(w, h, bg, fg, size):
    img = canvas(w, h, bg)
    d = ImageDraw.Draw(img)
    x = w - 14 - size
    mark(img, x, (h - size) // 2, size)
    f = font("lmroman10-regular.otf", 22)
    d.text(((x - 9) * SS, (h / 2) * SS), "Vitae", font=f, fill=fg, anchor="rm")
    return img


def header():
    save(wordmark_right(150, 57, BG, TEXT, 30), "installer-header.bmp")


def banner():
    # WiX draws black title text on the left of the banner, so it stays light.
    img = wordmark_right(493, 58, LIGHT, INK, 32)
    ImageDraw.Draw(img).line((0, img.height - SS, img.width, img.height - SS), fill=LIGHT_RULE, width=SS)
    save(img, "banner.png")


def dialog():
    # WiX draws black text from x≈180px on the welcome/exit dialogs, so only the left panel is dark.
    w, h, panel = 493, 312, 164
    img = canvas(w, h, LIGHT)
    left = canvas(panel, h, BG)
    brand_panel(left, panel, h)
    img.paste(left, (0, 0))
    save(img, "dialog.png")


if __name__ == "__main__":
    app_icon()
    sidebar()
    header()
    banner()
    dialog()
