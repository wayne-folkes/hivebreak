"""Power-up pickups: four 10 x 10 capsules, each a dark ring around a glowing icon.
Four roots in one file (like shots.glb). Each icon has its own glow role so the game can recolour it."""
import math

import common as C

ICONS = {  # name: glow colour
    "spread": 0xFFB04F,
    "laser": 0x4FF0FF,
    "slow": 0x9B7BFF,
    "helper": 0x4FFF9B,
}
DARK = 0x2C2450

PREVIEW = {"size": 640, "spacing": 12}


def bar(cx, cz, ang, length, width, tip=None):
    """Ray from (cx, cz) pointing `ang` radians clockwise from straight up; it widens from a
    narrow root (0.5) to `width` at the tip."""
    tip = width if tip is None else tip
    r0 = 0.25
    dx, dz = math.sin(ang), math.cos(ang)
    px, pz = dz, -dx
    hw = tip / 2
    return [(cx + px * r0, cz + pz * r0), (cx + dx * length + px * hw, cz + dz * length + pz * hw),
            (cx + dx * length - px * hw, cz + dz * length - pz * hw), (cx - px * r0, cz - pz * r0)]


def icon_shape(name):
    if name == "spread":   # a fan of three
        return [bar(0, -3.3, a, n, 1.9) for a, n in ((-0.85, 5.6), (0.0, 5.0), (0.85, 5.6))]
    if name == "laser":    # a vertical bar with pointed ends
        return [[(0, 3.5), (1.0, 2.4), (1.0, -2.4), (0, -3.5), (-1.0, -2.4), (-1.0, 2.4)]]
    if name == "slow":     # hourglass
        return [[(-2.7, 3.2), (2.7, 3.2), (0.5, 0.0), (2.7, -3.2), (-2.7, -3.2), (-0.5, 0.0)]]
    # helper: a tiny ship, nose up
    right = [(0, 3.6), (1.0, 1.3), (3.1, -1.4), (3.1, -3.0), (1.2, -2.0)]
    return [right + [(0, -3.0)] + [(-x, z) for x, z in reversed(right[1:])]]


def build():
    ring_m = C.material("dark", DARK)
    roots = []
    for name, col in ICONS.items():
        glow = C.material(f"glow_{name}", col, emissive=True)
        root = C.new_root(f"pickup_{name}")
        outer = C.ngon(12, 5.0, 5.0, math.pi / 12)
        inner = C.ngon(12, 3.7, 3.7, math.pi / 12)
        ring = C.extrude_ring(outer, inner, 2.4)
        back = C.extrude_poly(C.ngon(12, 3.9, 3.9, math.pi / 12), 0.5, y=0.9)
        C.add_part(root, f"{name}_ring", [(ring, ring_m), (back, ring_m)])
        pieces = [(C.extrude_poly(pts, 1.5, y=-0.3), glow) for pts in icon_shape(name)]
        C.add_part(root, f"{name}_icon", pieces)
        C.recentre(root)
        roots.append(root)
    return roots
