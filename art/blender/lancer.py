"""Lancer: twin long prongs forward, a heavy wide rear block. ~17 x 22 px."""
import common as C

PALETTE = {
    "hull": 0xC9C2E8,      # lilac
    "accent": 0x6B56C2,    # purple barrels / wings
    "accent2": 0x2BB6D9,   # cyan wing blades
    "dark": 0x2C2450,
    "glow": 0x9FFBFF,      # muzzles, cockpit
    "glow2": 0xFFD36A,     # engine flames
}


def build():
    m = {k: C.material(k, v, emissive=k.startswith("glow")) for k, v in PALETTE.items()}
    root = C.new_root("lancer")

    # Heavy rear block and a tapering spine; twin prongs run forward on either side of the nose.
    rear = C.extrude_poly([(-5.5, -6.0), (5.5, -6.0), (5.5, -1.5), (3.2, 2.5), (-3.2, 2.5), (-5.5, -1.5)],
                          4.4, bevel=0.4)
    spine = C.loft([(-1.0, [(-3.0, -2.0), (3.0, -2.0), (3.0, 2.0), (-3.0, 2.0)]),
                    (5.0, [(-2.0, -1.8), (2.0, -1.8), (2.0, 1.6), (-2.0, 1.6)])],
                   tip_end=(0, 0, 8.0))
    pieces = [(rear, m["hull"]), (spine, m["hull"])]
    for s in (-1, 1):
        pieces.append((C.box(2.6, 2.6, 1.8, (s * 3.2, 0, -6.6)), m["dark"]))   # nozzles
        prong = C.box(2.0, 2.0, 15.0, (s * 4.9, 0, 2.0))                         # barrel
        pieces.append((prong, m["accent"]))
        pieces.append((C.box(2.5, 2.5, 1.4, (s * 4.9, 0, -1.0)), m["dark"]))     # breech band
        pieces.append((C.box(2.5, 2.5, 1.0, (s * 4.9, 0, 4.5)), m["dark"]))      # mid band
    C.add_part(root, "hull", pieces)

    for s, side in ((-1, "L"), (1, "R")):
        pivot = (s * 5.5, 0, -4.2)
        wing = C.extrude_poly([(s * 5.5, -1.4), (s * 7.3, -2.4), (s * 7.3, -6.0), (s * 5.5, -6.0)],
                              2.0, bevel=0.3)
        C.add_part(root, f"wing_{side}", [(wing, m["accent"])], pivot)
        tip = C.extrude_poly([(s * 7.6 - 0.9, -6.8), (s * 7.6 + 0.9, -6.8), (s * 7.6 + 0.9, -1.2),
                              (s * 7.6, 0.2), (s * 7.6 - 0.9, -1.2)], 2.4, bevel=0.2)
        C.add_part(root, f"tip_{side}", [(tip, m["accent2"])], pivot)
        # Glowing muzzle at each prong tip.
        mz = C.octa(1.2, 1.2, 1.5, (s * 4.9, 0, 10.3))
        C.add_part(root, f"muzzle_{side}", [(mz, m["glow"])], (s * 4.9, 0, 10.3))
        fx = s * 3.2
        flame = C.loft([(-7.5, C.ngon(5, 1.3, 1.3))], tip_end=(0, 0, -10.5))
        C.move(flame, (fx, 0, 0))
        C.add_part(root, f"flame_{side}", [(flame, m["glow2"])], (fx, 0, -7.5))

    cockpit = C.icosphere(1.5, 1.4, 2.2, (0, -2.0, 1.2))
    C.add_part(root, "cockpit", [(cockpit, m["glow"])], (0, -2.0, 1.2))

    C.recentre(root)
    return [root]
