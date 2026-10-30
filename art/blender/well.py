"""Gravity Well core: a glowing core in a dark shell with two spinning rings. ~18 px across."""
import math

import common as C

PALETTE = {
    "dark": 0x2A0F52,
    "accent": 0x6B3FD0,
    "glow": 0xB79BFF,      # core
    "glow2": 0xFF4FD8,     # inner ring
}


def arcs(n, r_out, r_in, gap_deg, depth, y=0.0, offset=0.0, steps=3):
    """n arc segments (separated by gap_deg) as a list of bmeshes in the XZ plane."""
    out = []
    span = 360.0 / n - gap_deg
    for k in range(n):
        a0 = math.radians(offset + k * 360.0 / n - span / 2)
        a1 = math.radians(offset + k * 360.0 / n + span / 2)
        pts = [(r_out * math.cos(a0 + (a1 - a0) * i / steps), r_out * math.sin(a0 + (a1 - a0) * i / steps))
               for i in range(steps + 1)]
        pts += [(r_in * math.cos(a1 - (a1 - a0) * i / steps), r_in * math.sin(a1 - (a1 - a0) * i / steps))
                for i in range(steps + 1)]
        out.append(C.extrude_poly(pts, depth, y=y))
    return out


def build():
    m = {k: C.material(k, v, emissive=k.startswith("glow")) for k, v in PALETTE.items()}
    root = C.new_root("well")

    # Everything is centred on the origin and pivots there, so the renderer can spin the rings.
    shell = C.icosphere(5.2, 3.0, 5.2, (0, 0.6, 0), subdiv=1)
    C.add_part(root, "shell", [(shell, m["dark"])])
    core = C.icosphere(3.6, 2.6, 3.6, (0, -1.4, 0), subdiv=1)
    C.add_part(root, "core", [(core, m["glow"])])

    C.add_part(root, "ring", [(a, m["accent"]) for a in arcs(3, 9.0, 7.2, 36, 1.8, y=0.0, offset=90)])
    C.add_part(root, "ring2", [(a, m["glow2"]) for a in arcs(2, 6.3, 5.2, 50, 1.4, y=-0.3, offset=0)])
    return [root]
