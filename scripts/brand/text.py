"""Outline text to SVG path data: HarfBuzz shaping on a static instance of a variable font."""
import functools, io
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

@functools.lru_cache(maxsize=None)
def _instance(path, wght):
    font = TTFont(path)
    static = instancer.instantiateVariableFont(font, {"wght": wght})
    buf = io.BytesIO()
    static.save(buf)
    return static, buf.getvalue()

def outline(text, font_path, wght, size, x=0.0, y=0.0, tracking=0.0):
    """Return (path_d, advance_width) for `text` with its baseline at (x, y), font size `size`."""
    static, blob = _instance(font_path, wght)
    face = hb.Face(blob)
    font = hb.Font(face)
    upem = face.upem
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True})
    glyph_set = static.getGlyphSet()
    order = static.getGlyphOrder()
    scale = size / upem
    pen = SVGPathPen(glyph_set, lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
    cursor = 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        gx = x + (cursor + pos.x_offset) * scale
        gy = y - pos.y_offset * scale
        tpen = TransformPen(pen, (scale, 0, 0, -scale, gx, gy))
        glyph_set[name].draw(tpen)
        cursor += pos.x_advance + tracking * upem
    return pen.getCommands(), cursor * scale

def ink_bounds(text, font_path, wght, size, tracking=0.0):
    """(top, bottom) of the inked glyphs relative to the baseline (y grows down), so
    `top` is negative: the height of the tallest ascender/cap actually drawn."""
    static, blob = _instance(font_path, wght)
    face = hb.Face(blob)
    font = hb.Font(face)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True})
    glyph_set = static.getGlyphSet()
    order = static.getGlyphOrder()
    scale = size / face.upem
    pen = BoundsPen(glyph_set)
    cursor = 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        tpen = TransformPen(pen, (scale, 0, 0, -scale, (cursor + pos.x_offset) * scale, -pos.y_offset * scale))
        glyph_set[order[info.codepoint]].draw(tpen)
        cursor += pos.x_advance + tracking * face.upem
    xmin, ymin, xmax, ymax = pen.bounds
    return ymin, ymax

def x_height(font_path, wght):
    static, _ = _instance(font_path, wght)
    return static["OS/2"].sxHeight / static["head"].unitsPerEm


def cap_height(font_path, wght):
    """OS/2 sCapHeight as a fraction of the em."""
    static, _ = _instance(font_path, wght)
    return static["OS/2"].sCapHeight / static["head"].unitsPerEm
