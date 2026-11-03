"""Warper: slice 4a sector 3 alien, an angular violet delta with a teal core that blinks away
when hit. ~14 x 12 pixels. Parts: `body`, `core` (teal crystal), `eye` (white slit), `prong_L/R`
(teal fangs hinged at the notch under the body)."""
import common as C

PALETTE = {
    "hull": 0xA46BFF,
    "accent": 0x6B3FD0,    # chevron plate
    "dark": 0x3A2078,
    "glow": 0x3FE8D0,      # core, prongs
    "glow2": 0xFFFFFF,     # eye
}


def build():
    m = {k: C.material(k, v, emissive=k.startswith("glow")) for k, v in PALETTE.items()}
    root = C.new_root("warper")

    # Delta hull with a notch under it, bevelled so the edges catch the light.
    hull = C.extrude_poly([(0, 6.0), (-7.0, -3.0), (-5.4, -4.4), (-2.6, -2.8), (0, -3.8),
                           (2.6, -2.8), (5.4, -4.4), (7.0, -3.0)], 3.4, bevel=0.55)
    # Raised chevron plate on the front, and two dark shoulder slits.
    plate = C.extrude_poly([(0, 4.0), (-3.6, -1.4), (-2.2, -2.2), (0, -0.6), (2.2, -2.2), (3.6, -1.4)],
                           0.8, y=-1.9)
    slits = [C.extrude_poly([(s * 4.2, -0.6), (s * 5.6, -2.8), (s * 4.8, -2.9), (s * 3.6, -0.9)],
                            0.8, y=-1.9) for s in (-1, 1)]
    C.add_part(root, "body", [(hull, m["hull"]), (plate, m["accent"])] + [(s, m["dark"]) for s in slits])

    core = C.octa(2.1, 1.6, 2.7, (0, -1.7, 0.3))
    C.add_part(root, "core", [(core, m["glow"])], (0, -1.7, 0.3))
    eye = C.extrude_poly([(-1.3, 0.3), (0, 1.1), (1.3, 0.3), (0, -0.5)], 0.6, y=-3.4)
    C.add_part(root, "eye", [(eye, m["glow2"])], (0, -3.4, 0.3))

    for s, side in ((-1, "L"), (1, "R")):
        x = s * 2.0
        prong = C.extrude_poly([(x - 0.9, -3.0), (x + 0.9, -3.0), (x + s * 0.9, -6.0)], 1.5)
        C.add_part(root, f"prong_{side}", [(prong, m["glow"])], (x, 0, -3.0))

    C.recentre(root)
    return [root]
