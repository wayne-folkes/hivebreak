"""Brood Mother: sector 1 boss, a wide armoured carrier with four shootable plates, a hidden core
and two drone bays. ~104 x 26 pixels. Part centres are listed in README.md."""
import math

import common as C

PALETTE = {
    "hull": 0x5A48A6,
    "accent": 0x6B56C2,    # dome, wings
    "accent2": 0xC9C2E8,   # armour plates
    "dark": 0x2C2450,
    "glow": 0xFF4FD8,      # core
    "glow2": 0xFFB04F,     # bay lights
}

PLATE_X = (-39, -13, 13, 39)
PLATE_Y = -9.0
CORE = (0.0, -4.0, 0.0)
BAY_X = 28
BAY_Z = -9.6
BAYGLOW_Z = -12.7

PREVIEW = {"size": 768}


def build():
    m = {k: C.material(k, v, emissive=k.startswith("glow")) for k, v in PALETTE.items()}
    root = C.new_root("brood_mother")

    # Hull: a wide chamfered slab. Dark struts fill the gaps between the plates; a dark socket
    # frames the core where it peeks out.
    slab = C.extrude_poly([(-50, -2.5), (-46, 7.0), (46, 7.0), (50, -2.5), (44, -7.5), (-44, -7.5)], 14.0, bevel=0.9)
    pieces = [(slab, m["hull"])]
    for x in (-26, 26):
        pieces.append((C.box(3.0, 1.0, 14.0, (x, -7.3, -0.25)), m["dark"]))
    for x in (-49, 49):
        pieces.append((C.box(2.2, 1.0, 9.5, (x, -7.3, -0.5)), m["dark"]))
    sock = C.extrude_poly([(-3.4, 6.0), (3.4, 6.0), (6.2, 2.8), (6.2, -2.8), (3.4, -6.0), (-3.4, -6.0),
                           (-6.2, -2.8), (-6.2, 2.8)], 1.0, y=-7.3)
    pieces.append((sock, m["dark"]))
    C.add_part(root, "hull", pieces)

    # Dome: faceted half-ellipsoid on top with a dark visor slit and a light spine.
    to_xyz = lambda a, b, w: (a, b, w)
    dome = C.loft([(6.5, C.ngon(10, 29, 9.0, 0.314)), (9.0, C.ngon(10, 23, 7.6, 0.314)),
                   (11.4, C.ngon(10, 13, 5.0, 0.314))], tip_end=(0, 0, 13.4), mapf=to_xyz)
    visor = C.extrude_poly([(-11.5, 7.6), (11.5, 7.6), (8.0, 10.4), (-8.0, 10.4)], 1.0, y=-7.4)
    spine = C.box(2.4, 1.0, 4.0, (0, -4.6, 11.6))
    C.add_part(root, "dome", [(dome, m["accent"]), (visor, m["dark"]), (spine, m["accent2"])])

    # Wings: swept fins rising off the shoulders, hinged at their roots.
    for s, side in ((-1, "L"), (1, "R")):
        pivot = (s * 41.0, 0, 6.0)
        fin = C.extrude_poly([(s * 38, 6.0), (s * 47, 7.0), (s * 52.5, 13.4), (s * 48.0, 13.4),
                              (s * 41, 11.4), (s * 38, 10.0)], 6.0, y=1.0, bevel=0.5)
        trim = C.extrude_poly([(s * 44, 8.0), (s * 48, 8.6), (s * 50.2, 11.8), (s * 48.6, 11.8),
                               (s * 44.2, 10.2)], 0.8, y=-2.2)
        C.add_part(root, f"wing_{side}", [(fin, m["accent"]), (trim, m["dark"])], pivot)

    # Armour plates across the front, each its own part pivoting about its centre.
    for i, x in enumerate(PLATE_X):
        plate = C.extrude_poly([(-11, 4), (-9, 6), (9, 6), (11, 4), (11, -4), (9, -6), (-9, -6), (-11, -4)],
                               4.0, bevel=0.55)
        slot = C.extrude_poly([(-7.0, 0.7), (7.0, 0.7), (7.0, -0.7), (-7.0, -0.7)], 0.7, y=-2.1)
        pip = C.box(1.6, 0.7, 1.6, (0, -2.1, 3.6))
        pip2 = C.box(1.6, 0.7, 1.6, (0, -2.1, -3.6))
        for bm in (plate, slot, pip, pip2):
            C.move(bm, (x, PLATE_Y, 0))
        C.add_part(root, f"plate_{i}", [(plate, m["accent2"]), (slot, m["dark"]), (pip, m["dark"]),
                                        (pip2, m["dark"])], (x, PLATE_Y, 0))

    # Core: glowing crystal sunk behind the middle plates.
    core = C.icosphere(5.4, 5.4, 5.4, CORE)
    C.add_part(root, "core", [(core, m["glow"])], CORE)

    # Drone bays underneath, each with its own light strip.
    for s, side in ((-1, "L"), (1, "R")):
        x = s * BAY_X
        bay = C.extrude_poly([(-7, 2.8), (7, 2.8), (6, -2.8), (-6, -2.8)], 10.0, y=-1.0, bevel=0.4)
        lip = C.extrude_poly([(-7.4, 3.0), (7.4, 3.0), (7.4, 1.6), (-7.4, 1.6)], 10.4, y=-1.0)
        C.move(bay, (x, 0, BAY_Z))
        C.move(lip, (x, 0, BAY_Z))
        C.add_part(root, f"bay_{side}", [(bay, m["dark"]), (lip, m["accent"])], (x, 0, BAY_Z))
        glow = C.extrude_poly([(-4.5, 0.8), (4.5, 0.8), (4.5, -0.8), (-4.5, -0.8)], 6.0, y=-3.0)
        C.move(glow, (x, 0, BAYGLOW_Z))
        C.add_part(root, f"bay_glow_{side}", [(glow, m["glow2"])], (x, -3.0, BAYGLOW_Z))

    C.recentre(root)
    return [root]
