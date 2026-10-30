"""Mini: the small red drone a Splitter breaks into. ~9 x 7 pixels."""
import common as C

PALETTE = {
    "hull": 0xC0392B,
    "accent": 0xA32C3B,    # legs, antenna nubs
    "dark": 0x4A0F20,
    "glow": 0xFFE14F,
}


def build():
    m = {k: C.material(k, v, emissive=(k == "glow")) for k, v in PALETTE.items()}
    root = C.new_root("mini")

    # Body: small faceted gem lofted along X, pointed at both ends.
    to_xyz = lambda a, b, w: (w, a, b)
    rings = [(-2.0, C.ngon(8, 1.8, 2.2, 0.3927)), (0.0, C.ngon(8, 2.3, 3.1, 0.3927)),
             (2.0, C.ngon(8, 1.8, 2.2, 0.3927))]
    body = C.loft(rings, tip_start=(0, 0, -4.4), tip_end=(0, 0, 4.4), mapf=to_xyz)
    visor = C.box(4.2, 1.0, 1.6, (0, -2.1, 0.6))
    C.add_part(root, "body", [(body, m["hull"]), (visor, m["dark"])])

    # One slanted cyclops eye on the visor.
    eye = C.extrude_poly([(-1.3, 1.4), (1.3, 0.9), (1.3, 0.0), (-1.3, 0.5)], 0.9, y=-2.5)
    C.add_part(root, "eye", [(eye, m["glow"])], (0, -2.5, 0.6))

    # Two stubby legs hinged under the body.
    for i, x in enumerate((-2.0, 2.0)):
        leg = C.extrude_poly([(x - 0.8, -2.2), (x + 0.8, -2.2), (x + 0.8, -3.7), (x + 0.3, -4.6),
                              (x - 0.3, -4.6), (x - 0.8, -3.7)], 1.2)
        C.add_part(root, f"leg_{i}", [(leg, m["accent"])], (x, 0, -2.2))

    C.recentre(root)
    return [root]
