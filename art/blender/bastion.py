"""Bastion: a wide, armoured, blocky ship with shield emitters on the wingtips. ~19 x 18 px."""
import common as C

PALETTE = {
    "hull": 0x9AA7C8,      # steel
    "accent": 0x3D4A7A,    # dark blue armour blocks
    "accent2": 0xFFB04F,   # orange emitter housings
    "dark": 0x1F2644,
    "glow": 0x4FFF9B,      # shield emitters, cockpit
    "glow2": 0xFFD36A,     # engine flames
}


def hexa(hw, d):
    return [(0, -d), (hw, -0.45 * d), (hw, 0.45 * d), (0, d), (-hw, 0.45 * d), (-hw, -0.45 * d)]


def build():
    m = {k: C.material(k, v, emissive=k.startswith("glow")) for k, v in PALETTE.items()}
    root = C.new_root("bastion")

    # Chunky hull: a fat hexagonal prism with a flat blunt nose, a dark prow plate and nozzles.
    body = C.loft([(-5.5, hexa(5.2, 3.0)), (3.0, hexa(5.0, 3.2)), (7.0, hexa(3.2, 2.2))],
                  tip_end=None)
    prow = C.box(4.4, 0.8, 2.0, (0, -2.2, 6.2))
    pieces = [(body, m["hull"]), (prow, m["dark"])]
    for s in (-1, 1):
        pieces.append((C.box(3.4, 3.0, 1.6, (s * 3.4, 0, -6.3)), m["dark"]))
    C.add_part(root, "hull", pieces)

    for s, side in ((-1, "L"), (1, "R")):
        pivot = (s * 5.2, 0, -1.0)
        # Armour pod: a thick block with a dark stripe.
        wing = C.extrude_poly([(s * 5.2, 4.0), (s * 7.6, 3.0), (s * 7.6, -5.6), (s * 5.2, -5.6)],
                              3.6, bevel=0.4)
        stripe = C.extrude_poly([(s * 5.8, 1.4), (s * 7.2, 1.4), (s * 7.2, 0.4), (s * 5.8, 0.4)],
                                0.3, y=-1.9)
        C.add_part(root, f"wing_{side}", [(wing, m["accent"]), (stripe, m["dark"])], pivot)
        # Emitter housing on the wing tip.
        tx = s * 8.3
        tip = C.extrude_poly([(tx - 1.1, -4.8), (tx + 1.1, -4.8), (tx + 1.1, 2.4), (tx - 1.1, 2.4)],
                             3.0, bevel=0.3)
        C.add_part(root, f"tip_{side}", [(tip, m["accent2"])], pivot)
        # Shield emitter: a glowing crystal standing proud on the housing's nose.
        em = C.octa(1.4, 1.2, 1.9, (tx, -1.9, 2.4))
        C.add_part(root, f"emitter_{side}", [(em, m["glow"])], (tx, -1.9, 2.4))
        fx = s * 3.4
        flame = C.loft([(-7.1, C.ngon(5, 1.7, 1.7))], tip_end=(0, 0, -11.0))
        C.move(flame, (fx, 0, 0))
        C.add_part(root, f"flame_{side}", [(flame, m["glow2"])], (fx, 0, -7.1))

    cockpit = C.icosphere(1.8, 1.4, 2.0, (0, -3.0, 2.0))
    C.add_part(root, "cockpit", [(cockpit, m["glow"])], (0, -3.0, 2.0))

    C.recentre(root)
    return [root]
