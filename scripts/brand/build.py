"""Generate every SVG master in docs/assets/ (see docs/BRAND.md). Run via scripts/brand-assets.sh."""
import os, sys
from mark import *
from icon import icon
from text import cap_height, ink_bounds, outline, x_height

FONTS = os.environ["BRAND_FONTS"]
URBANIST = os.path.join(FONTS, "Urbanist.ttf")
MONO = os.path.join(FONTS, "JetBrainsMono.ttf")
OUT = sys.argv[1]

LIME_DARK_TEXT = [("0", "#D2F55A"), ("1", "#8CD11C")]   # "links" on dark
LIME_LIGHT_TEXT = [("0", "#79B713"), ("1", "#4C8A06")]  # "links" on light (contrast on white)
SLATE = "#8B939C"

def grad(id_, stops, y1, y2):
    s = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return f'<linearGradient id="{id_}" x1="0" y1="{y1:.1f}" x2="0" y2="{y2:.1f}" gradientUnits="userSpaceOnUse">{s}</linearGradient>'

def svg(w, h, body, defs="", label="xtandard-links"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.1f} {h:.1f}" width="{w:.1f}" height="{h:.1f}" '
            f'role="img" aria-label="{label}">\n<title>{label}</title>\n<defs>{defs}</defs>\n{body}\n</svg>\n')

def write(name, content):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(content)

bx0, by0, bx1, by1 = glyph_bbox()
GW, GH = bx1 - bx0, by1 - by0

def symbol_group(height, x, y, paint, uid):
    """The glyph scaled to `height`, top-left at (x, y)."""
    s = height / GH
    return f'<g transform="translate({x:.1f} {y:.1f}) scale({s:.5f}) translate({-bx0:.1f} {-by0:.1f})">{glyph(paint, uid=uid)}</g>', GW * s

# --- icon, favicon, symbol -------------------------------------------------
write("logo.svg", icon())

def favicon():
    # No orbit, no shadow, no brackets (they don't survive 16 px); the glyph fills more of the tile.
    s = 820 / max(GW, GH)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    body = ('<rect width="1024" height="1024" rx="224" fill="url(#bg)"/>'
            f'<g transform="translate(512 512) scale({s:.4f}) translate({-cx:.1f} {-cy:.1f})">{glyph("url(#lime)", uid="f", ring_stroke=44, link_gap=13)}</g>')
    defs = (lime_gradient("lime") +
            '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1A1C1F"/><stop offset="1" stop-color="#08090B"/></linearGradient>')
    return svg(1024, 1024, body, defs)
write("favicon.svg", favicon())

g, _ = symbol_group(GH, 0, 0, "url(#lime)", "s")
write("symbol.svg", svg(GW, GH, g, lime_gradient("lime")))

# symbol.svg: lime for dark surfaces; symbol-light.svg: the light lockups' deeper lime, so the
# bare symbol reads on white. The UI navbar shows one per theme (no tile anywhere on a page).
g_light, _ = symbol_group(GH, 0, 0, "url(#lime)", "sl")
write("symbol-light.svg", svg(GW, GH, g_light, lime_gradient("lime", stops=LIME_ON_LIGHT)))

# --- lockups -------------------------------------------------------------------
XH = x_height(URBANIST, 900)

def wordmark(size, x, baseline, prefix_fill, word_paint, stacked=False):
    d1, w1 = outline("xtandard-", URBANIST, 900, size, x, baseline, tracking=-0.012)
    if stacked:
        d2, w2 = outline("links", URBANIST, 900, size, x, baseline + size * 0.92, tracking=-0.012)
        return f'<path d="{d1}" fill="{prefix_fill}"/><path d="{d2}" fill="{word_paint}"/>', max(w1, w2)
    d2, w2 = outline("links", URBANIST, 900, size, x + w1, baseline, tracking=-0.012)
    return f'<path d="{d1}" fill="{prefix_fill}"/><path d="{d2}" fill="{word_paint}"/>', w1 + w2

def horizontal(theme, mono=None):
    sym_h = 96
    size = (sym_h * 0.5) / XH  # x-height = half the symbol height
    # Vertical centring — the shared xtandard rule (xtandard-flags#20): the symbol's centre (its
    # full bounds) sits on the wordmark's optical centre, baseline - capHeight/2, with Urbanist's
    # OS/2 sCapHeight (0.7 em); descenders ignored; canvas = max(symbol height, descender bottom).
    baseline = sym_h / 2 + cap_height(URBANIST, 900) * size / 2
    _top, bottom = ink_bounds("xtandard-links", URBANIST, 900, size, tracking=-0.012)
    canvas_h = max(sym_h, baseline + bottom)
    gap = 30
    if mono:
        sym, sw = symbol_group(sym_h, 0, 0, mono, f"h{mono[1:]}")
        word, ww = wordmark(size, sw + gap, baseline, mono, mono)
        return svg(sw + gap + ww, canvas_h, sym + word)
    prefix = PAPER if theme == "dark" else INK
    stops = LIME_DARK_TEXT if theme == "dark" else LIME_LIGHT_TEXT
    sym, sw = symbol_group(sym_h, 0, 0, "url(#lime)", f"h{theme}")
    word, ww = wordmark(size, sw + gap, baseline, prefix, "url(#word)")
    defs = lime_gradient("lime", stops=LIME if theme == "dark" else LIME_ON_LIGHT) + grad("word", stops, baseline - size * XH * 1.5, baseline + size * 0.2)
    return svg(sw + gap + ww, canvas_h, sym + word, defs)

def stacked(theme):
    sym_h = 160
    size = 64
    sym, sw = symbol_group(sym_h, 0, 0, "url(#lime)", f"v{theme}")
    gap = 28
    base1 = sym_h * 0.44
    word, ww = wordmark(size, sw + gap, base1, PAPER if theme == "dark" else INK, "url(#word)", stacked=True)
    stops = LIME_DARK_TEXT if theme == "dark" else LIME_LIGHT_TEXT
    base2 = base1 + size * 0.92
    defs = lime_gradient("lime", stops=LIME if theme == "dark" else LIME_ON_LIGHT) + grad("word", stops, base2 - size * 0.75, base2 + size * 0.2)
    return svg(sw + gap + ww, sym_h, sym + word, defs)

for theme in ("dark", "light"):
    write(f"lockup-horizontal-{theme}.svg", horizontal(theme))
    write(f"lockup-stacked-{theme}.svg", stacked(theme))
write("monochrome-white.svg", horizontal(None, mono="#FFFFFF"))
write("monochrome-black.svg", horizontal(None, mono="#000000"))

# --- social card (1280x640) ------------------------------------------------------
def social():
    W, H = 1280, 640
    icon_size = 290
    ix, iy = 130, (H - icon_size) / 2
    inner = icon().split("\n", 3)[3].rsplit("</svg>", 1)[0]  # body after <defs>
    icon_defs = icon().split("<defs>", 1)[1].split("</defs>", 1)[0]
    tx = ix + icon_size + 64
    size = 92
    word_d1, w1 = outline("xtandard-", URBANIST, 900, size, tx, 292, tracking=-0.012)
    word_d2, w2 = outline("links", URBANIST, 900, size, tx + w1, 292, tracking=-0.012)
    tag_d, _ = outline("Branded short links, click analytics & deep links", URBANIST, 600, 34, tx, 362)
    tag2_d, _ = outline("embedded in your own app", URBANIST, 600, 34, tx, 404)
    cmd_d, _ = outline("bun add @xtandard/links", MONO, 400, 26, tx, 462)
    body = (f'<rect width="{W}" height="{H}" fill="{INK}"/>'
            f'<g transform="translate({ix} {iy}) scale({icon_size/1024:.5f})">{inner}</g>'
            f'<path d="{word_d1}" fill="{PAPER}"/><path d="{word_d2}" fill="url(#word)"/>'
            f'<path d="{tag_d}" fill="#C4EE5C"/><path d="{tag2_d}" fill="#C4EE5C"/>'
            f'<path d="{cmd_d}" fill="{SLATE}"/>')
    defs = icon_defs + grad("word", LIME_DARK_TEXT, 220, 310)
    return svg(W, H, body, defs)
write("social.svg", social())
print("wrote SVG masters to", OUT)
