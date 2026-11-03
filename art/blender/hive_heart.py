"""Hive Heart: sector 3 boss (wave 15), a huge faceted heart in the hive's core, fed by four veins
that end in nodes. ~28 x 24 pixels for the heart, ~108 x 56 for the whole model. Part centres are
listed in README.md.

Not recentred: the heart is at the origin, the veins reach out symmetrically. `heart` and
`heart_core` pivot at (0, 0, 0) so the game can pulse them by scaling about the boss centre.
`vein_i` (0 = upper left, 1 = upper right, 2 = lower left, 3 = lower right) pivots where the vein
leaves the heart, so scaling it shrinks it back toward the heart."""
import math

import common as C

PALETTE = {
    "hull": 0xD8344F,      # heart body (blood)
    "accent": 0xFF7A7A,    # heart highlights
    "accent2": 0x9A2F5A,   # vein tubes
    "dark": 0x4A1030,      # heart rim, vein collars, node cages
    "glow": 0xFF4FD8,      # heart core (magenta)
    "glow2": 0xF5C542,     # vein nodes (gold)
    "glow3": 0xC6F23C,     # blood beads in the veins (acid green)
}

# Heart outline, scaled to ~28 x 24 pixels (the classic parametric heart).
SX, SZ = 0.875, 0.83
# Vein paths in the front view (x, z): quadratic bezier start (inside the heart), control, end.
# Index order: 0 upper left, 1 upper right, 2 lower left, 3 lower right.
VEINS = [
    ((-8.0, 6.0), (-30.0, 24.0), (-50.0, 16.0)),
    ((8.0, 6.0), (30.0, 24.0), (50.0, 16.0)),
    ((-8.0, -2.0), (-34.0, -6.0), (-50.0, -26.0)),
    ((8.0, -2.0), (34.0, -6.0), (50.0, -26.0)),
]
NODE_R = 4.6
VY = 2.5  # veins sit this far behind the heart's mid-plane, so the heart overlaps their roots

PREVIEW = {"size": 768}


def heart_pts(n=28, grow=1.0):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = 16 * math.sin(t) ** 3
        z = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((x * SX * grow, (z + 2.5) * SZ * grow))
    return pts


def bez(v, u):
    return tuple((1 - u) ** 2 * v[0][i] + 2 * (1 - u) * u * v[1][i] + u * u * v[2][i] for i in range(2))


def bez_tan(v, u):
    d = [2 * (1 - u) * (v[1][i] - v[0][i]) + 2 * u * (v[2][i] - v[1][i]) for i in range(2)]
    n = math.hypot(*d)
    return d[0] / n, d[1] / n


def tube(v, r0, r1, u0=0.0, u1=1.0, steps=10, sides=6):
    """Hexagonal tube along the vein path, tapering from r0 to r1, flat-capped at both ends."""
    bm = C.new_bm()
    rings = []
    for k in range(steps + 1):
        u = u0 + (u1 - u0) * k / steps
        px, pz = bez(v, u)
        tx, tz = bez_tan(v, u)
        nx, nz = -tz, tx  # in-plane normal
        r = r0 + (r1 - r0) * k / steps
        ring = []
        for a, b in C.ngon(sides, r, r, 0.5236):
            ring.append(bm.verts.new((px + nx * a, b + VY, pz + nz * a)))
        rings.append(ring)
    for r0_, r1_ in zip(rings, rings[1:]):
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((r0_[i], r0_[j], r1_[j], r1_[i]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])
    return bm


def collar(v, u, r):
    """A short dark band around the vein at path parameter u."""
    return tube(v, r, r, u - 0.03, u + 0.03, steps=1)


def build():
    m = {k: C.material(k, c, emissive=k.startswith("glow")) for k, c in PALETTE.items()}
    root = C.new_root("hive_heart")
    to_xyz = lambda a, b, w: (a, w, b)  # ring point (a = x, b = z), w = y depth

    # Heart: domed loft of the heart outline (flat-ish back, round front), a dark rim slab behind
    # it so the silhouette keeps an outline, and two highlight facets on the upper left lobe.
    prof = [(5.0, 0.62), (3.5, 0.9), (1.0, 1.0), (-2.0, 1.0), (-4.0, 0.84), (-5.6, 0.58)]
    base = heart_pts()
    rings = [(w, [(a * s, b * s) for a, b in base]) for w, s in prof]
    body = C.loft(rings, tip_end=(0, 0, -7.6), tip_start=(0, 0, 5.6), mapf=to_xyz)
    rim = C.loft([(2.4, [(a, b) for a, b in heart_pts(grow=1.1)]), (4.4, [(a, b) for a, b in heart_pts(grow=1.1)])],
                 mapf=to_xyz)
    hi1 = C.icosphere(4.4, 1.9, 3.0, (-6.0, -6.2, 5.0), subdiv=1)
    hi2 = C.icosphere(2.0, 1.2, 1.5, (-7.4, -6.6, 6.2), subdiv=1)
    # A dark groove running down the front from the cleft, so the two lobes read.
    groove = C.extrude_poly([(-0.5, 5.0), (0.5, 5.0), (0.5, 1.5), (-0.5, 1.5)], 1.0, y=-5.2)
    C.add_part(root, "heart", [(body, m["hull"]), (rim, m["dark"]), (hi1, m["accent"]), (hi2, m["accent"]),
                               (groove, m["dark"])], (0, 0, 0))

    # Core: a bright flattened crystal poking out of the front of the heart.
    core = C.octa(3.4, 2.4, 4.6, (0, -6.8, -0.5))
    C.add_part(root, "heart_core", [(core, m["glow"])], (0, 0, 0))

    # Veins: hexagonal tube, dark collars, acid beads, ending in a gold-cored node. Pivot at the
    # vein's start (hidden inside the heart).
    for i, v in enumerate(VEINS):
        pieces = [(tube(v, 3.8, 2.7), m["accent2"])]
        for u in (0.22, 0.62):
            pieces.append((collar(v, u, 3.9 - 1.0 * u), m["dark"]))
        for u in (0.40, 0.80):
            px, pz = bez(v, u)
            pieces.append((C.octa(1.4, 1.2, 1.4, (px, -3.2 + VY, pz)), m["glow3"]))
        ex, ez = v[2]
        pieces.append((C.icosphere(NODE_R, 3.4, NODE_R, (ex, VY, ez), subdiv=1), m["dark"]))
        pieces.append((C.icosphere(NODE_R - 1.5, 1.6, NODE_R - 1.5, (ex, -3.0 + VY, ez), subdiv=1), m["glow2"]))
        C.add_part(root, f"vein_{i}", pieces, (v[0][0], VY, v[0][1]))

    return [root]
