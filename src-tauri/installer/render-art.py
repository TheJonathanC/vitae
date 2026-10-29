"""Renders the installer artwork into src-tauri/icons/.

  installer-sidebar.bmp  NSIS welcome/finish sidebar   (164x314)
  installer-header.bmp   NSIS inner-page header image  (150x57)
  banner.png             WiX (MSI) dialog banner       (493x58)
  dialog.png             WiX (MSI) welcome background  (493x312)

Usage: python3 src-tauri/installer/render-art.py   (requires Pillow)
Colors must stay in sync with the VITAE_* defines in installer.nsi.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ICONS = Path(__file__).resolve().parent.parent / "icons"
SS = 4  # supersampling factor

BG = (24, 24, 27)  # zinc-900, matches VITAE_BG
TEXT = (244, 244, 245)
MUTED = (161, 161, 170)
FAINT = (63, 63, 70)
RULE = (39, 39, 42)
ACCENT = (14, 99, 156)
LIGHT = (250, 250, 250)

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


def mark(img, x, y, size):
    """App mark: rounded square with a sky-to-blue gradient and a serif V."""
    s = size * SS
    grad = Image.new("RGB", (s, s))
    top, bottom = (56, 189, 248), (14, 99, 156)
    gd = ImageDraw.Draw(grad)
    for i in range(s * 2):
        t = i / (s * 2 - 1)
        c = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
        gd.line([(i, 0), (0, i)], fill=c)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=s * 0.24, fill=255)
    img.paste(grad, (x * SS, y * SS), mask)
    d = ImageDraw.Draw(img)
    f = font("lmroman10-bold.otf", round(size * 0.72))
    d.text(((x + size / 2) * SS, (y + size * 0.53) * SS), "V", font=f, fill=(255, 255, 255), anchor="mm")


def save(img, name):
    w, h = img.width // SS, img.height // SS
    out = img.resize((w, h), Image.LANCZOS)
    path = ICONS / name
    out.save(path, format="BMP" if name.endswith(".bmp") else "PNG")
    print(f"{name}: {w}x{h}")


def brand_panel(img, width, height):
    """Dark branded panel shared by the NSIS sidebar and the WiX dialog."""
    glow(img, 30, 50, 70, (56, 189, 248), 60)
    glow(img, width, height, 90, ACCENT, 90)
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
    d.text((16 * SS, (h - 17) * SS), "offline  ·  native  ·  fast", font=font("lmroman10-regular.otf", 9), fill=(82, 82, 91), anchor="lm")
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
    img = wordmark_right(493, 58, LIGHT, BG, 32)
    ImageDraw.Draw(img).line((0, img.height - SS, img.width, img.height - SS), fill=(228, 228, 231), width=SS)
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
    sidebar()
    header()
    banner()
    dialog()
