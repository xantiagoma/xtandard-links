"""Shared geometry for the @xtandard/links mark (1024-unit icon space)."""
import math

LIME = [("0", "#D2F55A"), (".5", "#A6E22A"), ("1", "#79BC12")]
# Light-background variant: starts deeper so the top-left does not melt into white.
LIME_ON_LIGHT = [("0", "#A9DE2C"), (".5", "#86C41A"), ("1", "#5E9E08")]
INK = "#0F1215"
PAPER = "#FAFAFA"
ORBIT = "#4E5459"

# The X: chevron ">" + two arms that continue its diagonals (see docs/BRAND.md "Geometry").
CHEVRON = [(292, 300), (400, 300), (588, 512), (400, 724), (292, 724), (480, 512)]
GAP = 62  # horizontal gap between the chevron and the arms
def _l1(t): return (292 + 188 * t, 300 + 212 * t)
def _l2(t): return (400 + 188 * t, 300 + 212 * t)
LOWER_ARM = [_l1((484 + GAP) / 376), _l2((376 + GAP) / 376), (776, 724), (668, 724)]
# The upper-right stroke of the X is a two-link chain running along the chevron's lower
# diagonal (direction (188,-212)), starting where an arm would start after the gap.
def _m1(u): return (480 + 188 * u, 512 - 212 * u)
def _m2(u): return (588 + 188 * u, 512 - 212 * u)
AXIS_DIR = (188 / math.hypot(188, 212), -212 / math.hypot(188, 212))
ANGLE = math.degrees(math.atan2(-212, 188))  # about -48.4
_a, _b = _m1((108 + GAP) / 376), _m2(GAP / 376)
CHAIN_START = ((_a[0] + _b[0]) / 2, (_a[1] + _b[1]) / 2)
def _along(p, d): return (p[0] + AXIS_DIR[0] * d, p[1] + AXIS_DIR[1] * d)
RING_LEN, RING_W, RING_STROKE = 178, 96, 33
LINK_GAP = 9  # gap cut around a ring where it passes under the other
RING_A = _along(CHAIN_START, RING_LEN / 2 + 4)
RING_B = _along(RING_A, RING_LEN * 0.6)

def poly(points):
    return "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in points) + "Z"

def _ring_local(cx, paint, width=RING_STROKE, ring_w=None):
    ring_w = RING_W if ring_w is None else ring_w
    return (f'<rect x="{cx - RING_LEN/2:.1f}" y="{-RING_W/2:.1f}" width="{RING_LEN}" height="{RING_W}" '
            f'rx="{RING_W/2}" fill="none" stroke="{paint}" stroke-width="{width}"/>')

def chain(paint, uid="c", stroke=RING_STROKE, gap=LINK_GAP):
    """Two interlocking rings along the diagonal, with over/under gaps at the crossings.

    Drawn in a local frame (x along the chain axis). Ring B passes under A on the +y
    side and over A on the -y side, so each ring is masked by the other's widened
    outline on one half.
    """
    a_x = RING_LEN / 2 + 4
    b_x = a_x + RING_LEN * 0.6
    wide = stroke + 2 * gap
    rw = RING_W + (stroke - RING_STROKE) * 0.6
    big = 400
    sx, sy = CHAIN_START
    return (f'<g transform="translate({sx:.1f} {sy:.1f}) rotate({ANGLE:.2f})">'
            f'<mask id="{uid}-ma" maskUnits="userSpaceOnUse" x="-50" y="-{big}" width="{big*2}" height="{big*2}">'
            f'<rect x="-50" y="-{big}" width="{big*2}" height="{big*2}" fill="#fff"/>'
            f'<g clip-path="url(#{uid}-neg)">{_ring_local(b_x, "#000", wide, rw)}</g></mask>'
            f'<mask id="{uid}-mb" maskUnits="userSpaceOnUse" x="-50" y="-{big}" width="{big*2}" height="{big*2}">'
            f'<rect x="-50" y="-{big}" width="{big*2}" height="{big*2}" fill="#fff"/>'
            f'<g clip-path="url(#{uid}-pos)">{_ring_local(a_x, "#000", wide, rw)}</g></mask>'
            f'<clipPath id="{uid}-pos"><rect x="-50" y="0" width="{big*2}" height="{big}"/></clipPath>'
            f'<clipPath id="{uid}-neg"><rect x="-50" y="-{big}" width="{big*2}" height="{big}"/></clipPath>'
            f'<g mask="url(#{uid}-ma)">{_ring_local(a_x, paint, stroke, rw)}</g>'
            f'<g mask="url(#{uid}-mb)">{_ring_local(b_x, paint, stroke, rw)}</g>'
            '</g>')

def glyph(fill, round_join=22, uid="c", ring_stroke=RING_STROKE, link_gap=LINK_GAP):
    """The X + chain, all one paint. Corners are rounded by a same-paint stroke."""
    s = f'stroke="{fill}" stroke-width="{round_join}" stroke-linejoin="round"'
    return "\n".join([
        f'<path d="{poly(CHEVRON)}" fill="{fill}" {s}/>',
        f'<path d="{poly(LOWER_ARM)}" fill="{fill}" {s}/>',
        chain(fill, uid, ring_stroke, link_gap),
    ])

def brackets(color):
    return (f'<g fill="none" stroke="{color}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="M232 440L168 512L232 584"/><path d="M856 440L920 512L856 584"/></g>')

def lime_gradient(id_, x1=292, y1=230, x2=776, y2=724, stops=None):
    stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in (stops or LIME))
    return f'<linearGradient id="{id_}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" gradientUnits="userSpaceOnUse">{stops}</linearGradient>'

# Glyph bounding box (for symbol / lockups), computed from the shapes above.
def glyph_bbox():
    xs, ys = [], []
    for pts in (CHEVRON, LOWER_ARM):
        for x, y in pts:
            xs.append(x); ys.append(y)
    a = math.radians(ANGLE)
    R = RING_W / 2 + RING_STROKE / 2
    half = (RING_LEN - RING_W) / 2
    ex, ey = abs(math.cos(a)) * half + R, abs(math.sin(a)) * half + R
    for c in (RING_A, RING_B):
        xs += [c[0] - ex, c[0] + ex]; ys += [c[1] - ey, c[1] + ey]
    pad = 12  # half the rounding stroke
    return min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad
