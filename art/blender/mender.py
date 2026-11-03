"""Mender: slice 4a sector 3 alien, a green medic disc with a raised white cross that pulses and
heals its neighbours. ~16 x 12 pixels. Parts: `body`, `cross` (white), `pod_L/R` (side lamps,
`glow2` green), `leg_L/R` (dark feet hinged under the body)."""
import common as C

PALETTE = {
    "hull": 0x38D98A,
    "accent": 0x1F8F5A,
    "dark": 0x145A3C,
    "glow": 0xFFFFFF,      # cross
    "glow2": 0x4FFF9B,     # side lamps
}


def build():
    m = {k: C.material(k, v, emissive=k.startswith("glow")) for k, v in PALETTE.items()}
    root = C.new_root("mender")

    to_xyz = lambda a, b, w: (a, w, b)  # a = x, b = z (height), w = Y depth (negative = front)
    body = C.loft([(1.8, C.ngon(10, 6.4, 4.0)), (0.0, C.ngon(10, 8.0, 4.9)), (-1.8, C.ngon(10, 6.9, 4.2))],
                  mapf=to_xyz)
    # Dark rim band round the middle so the disc reads as a plate, not a blob.
    rim = C.loft([(0.4, C.ngon(10, 8.05, 4.95)), (-0.4, C.ngon(10, 8.05, 4.95))], mapf=to_xyz)
    C.add_part(root, "body", [(body, m["hull"]), (rim, m["accent"])])

    arms = [C.box(6.4, 1.0, 2.0, (0, -2.3, 0.0)), C.box(2.0, 1.0, 6.4, (0, -2.3, 0.0))]
    C.add_part(root, "cross", [(a, m["glow"]) for a in arms], (0, -2.3, 0.0))

    for s, side in ((-1, "L"), (1, "R")):
        pod = C.octa(1.1, 1.0, 1.1, (s * 6.4, -2.0, 0.0))
        C.add_part(root, f"pod_{side}", [(pod, m["glow2"])], (s * 6.4, -2.0, 0.0))
        x = s * 3.4
        leg = C.extrude_poly([(x - 1.0, -4.0), (x + 1.0, -4.0), (x + 1.0, -5.5), (x + 0.4, -7.1),
                              (x - 0.4, -7.1), (x - 1.0, -5.5)], 1.6)
        C.add_part(root, f"leg_{side}", [(leg, m["dark"])], (x, 0, -4.0))

    C.recentre(root)
    return [root]
