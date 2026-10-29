"""Diver: arrowhead alien that points down and swoops at the player. ~14 x 14 pixels."""
import common as C

PALETTE = {
    "hull": 0xFF6A3D,
    "accent": 0xFFB04F,
    "dark": 0xA53A1E,
    "glow": 0xFFF27A,
}


def tri(r):
    """Triangle section with a vertex pointing at the camera (-Y)."""
    return [(0, -r), (r * 0.866, r * 0.5), (-r * 0.866, r * 0.5)]


def build():
    m = {k: C.material(k, v, emissive=(k == "glow")) for k, v in PALETTE.items()}
    root = C.new_root("diver")

    body = C.loft([(6.0, tri(3.3)), (2.0, tri(3.7))], tip_end=(0, 0, -7.5))
    collar = C.loft([(6.0, tri(3.35)), (4.8, tri(3.5))])
    C.add_part(root, "body", [(body, m["hull"]), (collar, m["dark"])])

    for s, side in ((-1, "L"), (1, "R")):
        # Swept-back wing blade (up on screen, since the diver points down).
        pts = [(s * 1.6, 1.4), (s * 6.9, 5.4), (s * 7.0, 6.6), (s * 1.6, 4.4)]
        wing = C.extrude_poly(pts, 1.8, bevel=0.3)
        C.add_part(root, f"wing_{side}", [(wing, m["accent"])], (s * 1.6, 0, 3.0))

    eye = C.octa(1.4, 1.0, 2.0, (0, -3.2, 2.2))
    C.add_part(root, "eye", [(eye, m["glow"])], (0, -3.2, 2.2))

    C.recentre(root)
    return [root]
