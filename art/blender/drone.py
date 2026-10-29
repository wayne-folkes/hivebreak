"""Drone: the basic formation alien, a faceted gem with legs and antennae. ~15 x 12 pixels."""
import common as C

PALETTE = {
    "hull": 0xB04CFF,
    "accent": 0x6A2BB0,
    "dark": 0x4E2488,
    "glow": 0xFFE14F,
}


def build():
    m = {k: C.material(k, v, emissive=(k == "glow")) for k, v in PALETTE.items()}
    root = C.new_root("drone")

    # Body: lofted along X (octagonal sections), pointed at both ends.
    to_xyz = lambda a, b, w: (w, a, b)  # a = depth (Y), b = height (Z), w = along X
    rings = [(-3.6, C.ngon(8, 2.9, 2.5, 0.3927)), (0.0, C.ngon(8, 3.4, 3.8, 0.3927)),
             (3.6, C.ngon(8, 2.9, 2.5, 0.3927))]
    body = C.loft(rings, tip_start=(0, 0, -7.5), tip_end=(0, 0, 7.5), mapf=to_xyz)
    visor = C.box(8.6, 1.3, 2.6, (0, -3.2, 0.6))
    C.add_part(root, "body", [(body, m["hull"]), (visor, m["dark"])])

    for s, side in ((-1, "L"), (1, "R")):
        # Angry slanted eyes.
        cx, cy, cz = s * 2.4, -3.9, 0.6
        eye = C.extrude_poly([(cx - s * 1.4, cz + 1.0), (cx + s * 1.2, cz + 0.2),
                              (cx + s * 1.2, cz - 0.9), (cx - s * 1.4, cz - 0.9)], 1.0, y=cy)
        C.add_part(root, f"eye_{side}", [(eye, m["glow"])], (cx, cy, cz))

        # Antenna: tapered stalk with a glowing bulb, tilted outward, hinged at the base.
        stalk = C.loft([(0.0, C.ngon(4, 0.55, 0.55, 0.785)), (2.8, C.ngon(4, 0.35, 0.35, 0.785))])
        bulb = C.octa(0.7, 0.7, 0.9, (0, 0, 3.3))
        base = (s * 2.6, 0, 3.0)
        for bm in (stalk, bulb):
            C.rotate_y(bm, s * 0.5)
            C.move(bm, base)
        C.add_part(root, f"antenna_{side}", [(stalk, m["accent"]), (bulb, m["glow"])], base)

    # Three legs hinged under the body.
    for i, x in enumerate((-4.5, 0.0, 4.5)):
        leg = C.extrude_poly([(x - 0.8, -2.6), (x + 0.8, -2.6), (x + 0.8, -4.9), (x + 0.3, -6.0),
                              (x - 0.3, -6.0), (x - 0.8, -4.9)], 1.4)
        C.add_part(root, f"leg_{i}", [(leg, m["accent"])], (x, 0, -2.6))

    C.recentre(root)
    return [root]
