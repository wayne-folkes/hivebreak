"""Splitter: slice 2b formation alien, two crimson gem halves joined by a glowing seam. ~16 x 12 pixels.
`half_L` / `half_R` pivot at the seam (x = +-0.8) so they can spread apart when it dies."""
import common as C

PALETTE = {
    "hull": 0xC0392B,
    "accent": 0x7E1F2E,    # chevron plates, horns
    "dark": 0x4A0F20,
    "glow": 0xFFE14F,      # eyes
    "glow2": 0xFF8A3D,     # the seam
}

SEAM_X = 0.8      # half-gap each half pivots about
DEPTH = 3.8


def build():
    m = {k: C.material(k, v, emissive=k.startswith("glow")) for k, v in PALETTE.items()}
    root = C.new_root("splitter")
    to_xyz = lambda a, b, w: (w, a, b)  # a = depth (Y), b = height (Z), w = along X

    for s, side in ((-1, "L"), (1, "R")):
        # Half: a hexagonal gem lofted outward from the seam, pointed on the outside edge.
        rings = [(s * SEAM_X, C.ngon(6, 3.2, 6.0, 1.5708)),
                 (s * 4.4, C.ngon(6, DEPTH, 5.4, 1.5708))]
        gem = C.loft(rings, tip_end=(0, 0, s * 8.0), mapf=to_xyz)
        # Dark chevron brow across the front, and a jaw plate below it.
        brow = C.extrude_poly([(s * 1.6, 3.8), (s * 6.6, 1.2), (s * 6.6, 2.4), (s * 1.6, 5.0)], 0.9, y=-3.1)
        jaw = C.extrude_poly([(s * 1.6, -2.4), (s * 6.0, -1.3), (s * 4.4, -4.6), (s * 1.6, -5.0)], 0.9, y=-3.0)
        # Horn on the top outer shoulder.
        horn = C.loft([(5.0, C.ngon(4, 1.2, 1.0, 0.785))], tip_end=(0, 0, 6.5),
                      mapf=lambda a, b, w: (s * 3.6 + b, a, w))
        C.add_part(root, f"half_{side}", [(gem, m["hull"]), (brow, m["dark"]), (jaw, m["accent"]),
                                          (horn, m["accent"])], (s * SEAM_X, 0, 0))

        # Slanted eye on the brow.
        cx, cy, cz = s * 4.0, -3.6, 0.6
        eye = C.extrude_poly([(cx - s * 1.6, cz + 1.0), (cx + s * 1.3, cz + 0.1),
                              (cx + s * 1.3, cz - 1.0), (cx - s * 1.6, cz - 1.0)], 1.0, y=cy)
        C.add_part(root, f"eye_{side}", [(eye, m["glow"])], (cx, cy, cz))

    # Seam: a tall glowing lozenge with a bright core stripe, standing proud of the halves.
    seam = C.extrude_poly([(0, 6.4), (1.1, 4.6), (1.1, -4.6), (0, -6.4), (-1.1, -4.6), (-1.1, 4.6)], 6.6)
    C.add_part(root, "seam", [(seam, m["glow2"])], (0, 0, 0))

    C.recentre(root)
    return [root]
