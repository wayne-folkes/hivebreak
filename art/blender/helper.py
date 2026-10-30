"""Helper drone: the player's tiny escort, a rounded pod with a glowing eye. ~8 x 8 pixels."""
import common as C

PALETTE = {
    "hull": 0xD8F6FF,
    "accent": 0x2BB6D9,
    "accent2": 0xFFB04F,
    "dark": 0x2F5A80,
    "glow": 0x4FF0FF,
}


def build():
    m = {k: C.material(k, v, emissive=(k == "glow")) for k, v in PALETTE.items()}
    root = C.new_root("helper")

    # Rounded body (lofted capsule along Z), a dark visor plate for the eye, a nozzle below
    # and a small top bead.
    rings = [(-3.0, C.ngon(8, 1.7, 1.5, 0.3927)), (-1.9, C.ngon(8, 2.9, 2.5, 0.3927)),
             (0.3, C.ngon(8, 3.3, 2.8, 0.3927)), (2.0, C.ngon(8, 2.9, 2.5, 0.3927)),
             (3.0, C.ngon(8, 1.7, 1.5, 0.3927))]
    body = C.loft(rings)
    visor = C.extrude_poly([(-2.3, 1.7), (2.3, 1.7), (2.8, 0.0), (2.3, -1.7), (-2.3, -1.7), (-2.8, 0.0)],
                           0.8, y=-2.55, bevel=0.2)
    C.move(visor, (0, 0, 0.3))
    nozzle = C.box(2.2, 1.8, 1.0, (0, 0, -3.3))
    C.add_part(root, "body", [(body, m["hull"]), (visor, m["dark"]), (nozzle, m["dark"]),
                              (C.octa(0.8, 0.8, 0.9, (0, 0, 3.2)), m["accent2"])])

    eye = C.icosphere(1.5, 0.8, 1.1, (0, -3.0, 0.3))
    C.add_part(root, "eye", [(eye, m["glow"])], (0, -3.0, 0.3))

    for s, side in ((-1, "L"), (1, "R")):
        pivot = (s * 3.0, 0, 0.2)
        fin = C.extrude_poly([(s * 2.8, 1.2), (s * 4.0, 0.4), (s * 4.0, -1.9), (s * 2.8, -1.1)],
                             1.6, bevel=0.25)
        C.add_part(root, f"fin_{side}", [(fin, m["accent"])], pivot)

    C.recentre(root)
    return [root]
