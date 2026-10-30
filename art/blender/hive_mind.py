"""Hive Mind: sector 2 boss, a pulsing core inside a ring of eight armoured segments, with six
spikes outside the ring. ~84 pixels across. Ring layout (see README.md): segment i is an arc of
30 degrees centred at 45 * i degrees (counter-clockwise from +X as seen from the front), radius 26,
radial thickness 6; every segment (and spike) pivots at the boss centre (0, 0, 0)."""
import math

import bmesh

import common as C

PALETTE = {
    "hull": 0xD04A64,      # ring segments
    "accent": 0x8E2A3C,    # segment inlay, spikes
    "glow": 0xFF4FD8,      # core
    "glow3": 0xC41E8E,     # core, alternate facets
    "glow2": 0xFFE14F,     # core eye, segment vents
}

CORE_R = 11.0
RING_R = 26.0
RING_T = 6.0
SEG_SPAN = 30.0
SEG_COUNT = 8
SPIKE_COUNT = 6
SPIKE_START = 30.0  # degrees; spike i sits at SPIKE_START + 60 * i
SPIKE_IN, SPIKE_OUT = 29.8, 42.0

PREVIEW = {"size": 768}


def sweep(profile, a0, a1, steps, cx=0.0):
    """Sweep a (radius, y) cross-section about the Y axis from angle a0 to a1 (degrees, CCW
    from +X toward +Z), capped at both ends."""
    bm = C.new_bm()
    rings = []
    for k in range(steps + 1):
        th = math.radians(a0 + (a1 - a0) * k / steps)
        rings.append([bm.verts.new((r * math.cos(th), y, r * math.sin(th))) for r, y in profile])
    n = len(profile)
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(n):
            q = (j + 1) % n
            bm.faces.new((r0[j], r0[q], r1[q], r1[j]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])
    return bm


def split_faces(bm, pred):
    """Split a bmesh into two by a per-face predicate (index, face) -> bool; frees `bm`."""
    outs = []
    for want in (True, False):
        out = C.new_bm()
        vmap = {}
        for i, f in enumerate(bm.faces):
            if pred(i, f) != want:
                continue
            vs = [vmap.setdefault(v, out.verts.new(v.co)) for v in f.verts]
            out.faces.new(vs)
        outs.append(out)
    bm.free()
    return outs


def build():
    m = {k: C.material(k, v, emissive=k.startswith("glow")) for k, v in PALETTE.items()}
    root = C.new_root("hive_mind")

    # Core: faceted icosphere, two-tone so the facets read even though the glow is unlit.
    core = C.icosphere(CORE_R, CORE_R, CORE_R, subdiv=1)
    light, dark = split_faces(core, lambda i, f: (i % 3) != 0)
    C.add_part(root, "core", [(light, m["glow"]), (dark, m["glow3"])], (0, 0, 0))

    # Core eye: a bright flattened crystal poking out of the front of the core.
    eye = C.icosphere(5.0, 3.2, 5.0, (0, -9.0, 0), subdiv=1)
    C.add_part(root, "core_eye", [(eye, m["glow2"])], (0, -9.0, 0))

    # Ring segments: chunky octagonal section swept over 30 degrees, plus an inlay strip and an
    # orange vent in the middle (the weak-point cue). Pivot at the boss centre.
    r0, r1 = RING_R - RING_T / 2, RING_R + RING_T / 2
    prof = [(r0, -1.5), (r0 + 1.2, -3.0), (r1 - 1.2, -3.0), (r1, -1.5),
            (r1, 1.5), (r1 - 1.2, 3.0), (r0 + 1.2, 3.0), (r0, 1.5)]
    inlay_prof = [(RING_R - 1.5, -3.0), (RING_R + 1.5, -3.0), (RING_R + 1.5, -3.5), (RING_R - 1.5, -3.5)]
    vent_prof = [(RING_R - 0.7, -3.4), (RING_R + 0.7, -3.4), (RING_R + 0.7, -3.8), (RING_R - 0.7, -3.8)]
    half = SEG_SPAN / 2
    for i in range(SEG_COUNT):
        c = 360.0 / SEG_COUNT * i
        body = sweep(prof, c - half, c + half, 4)
        inlay = sweep(inlay_prof, c - half + 3.5, c + half - 3.5, 2)
        vent = sweep(vent_prof, c - 3.0, c + 3.0, 1)
        C.add_part(root, f"seg_{i}", [(body, m["hull"]), (inlay, m["accent"]), (vent, m["glow2"])], (0, 0, 0))

    # Spikes: four-sided thorns pointing outward from outside the ring. Pivot at the boss centre.
    for i in range(SPIKE_COUNT):
        th = math.radians(SPIKE_START + 60.0 * i)
        ct, st = math.cos(th), math.sin(th)
        mapf = lambda a, b, w, ct=ct, st=st: (ct * w - st * b, a, st * w + ct * b)
        thorn = C.loft([(SPIKE_IN, C.ngon(4, 2.8, 2.8, 0.785)), (35.5, C.ngon(4, 1.8, 1.8, 0.785))],
                       tip_end=(0, 0, SPIKE_OUT), mapf=mapf)
        C.add_part(root, f"spike_{i}", [(thorn, m["accent"])], (0, 0, 0))

    # Not recentred: x and z are symmetric already, so the boss centre is the origin.
    return [root]
