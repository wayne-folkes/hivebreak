"""Player ship: a swept, nose-up fighter. ~19 x 21 pixels."""
import common as C

PALETTE = {
    "hull": 0xD8F6FF,
    "accent": 0x2BB6D9,
    "accent2": 0xFFB04F,   # wing tips
    "dark": 0x2F5A80,
    "glow": 0x4FF0FF,      # cockpit
    "glow2": 0xFFD36A,     # engine flames
}


def hexa(hw, d):
    """Hexagon cross-section with a ridge facing the camera (-Y)."""
    return [(0, -d), (hw, -0.45 * d), (hw, 0.45 * d), (0, d), (-hw, 0.45 * d), (-hw, -0.45 * d)]


def build():
    m = {k: C.material(k, v, emissive=k.startswith("glow")) for k, v in PALETTE.items()}
    root = C.new_root("player")

    # Fuselage with dark engine nozzles.
    body = C.loft([(-5.5, hexa(3.4, 2.4)), (1.5, hexa(3.2, 2.7)), (7.0, hexa(1.3, 1.2))],
                  tip_end=(0, 0, 10.5))
    pieces = [(body, m["hull"])]
    for s in (-1, 1):
        pieces.append((C.box(2.8, 2.6, 1.4, (s * 3.0, 0, -6.2)), m["dark"]))
    C.add_part(root, "hull", pieces)

    for s, side in ((-1, "L"), (1, "R")):
        pivot = (s * 2.8, 0, -3.8)
        # Wing: swept trapezoid plate with a dark trim line.
        wing = C.extrude_poly([(s * 2.8, -1.4), (s * 8.0, -3.4), (s * 8.0, -6.1), (s * 2.8, -6.1)],
                              2.2, bevel=0.35)
        trim = C.extrude_poly([(s * 3.4, -4.9), (s * 7.6, -5.6), (s * 7.6, -4.7 - 0.0), (s * 3.4, -4.1)],
                              0.3, y=-1.15)
        C.add_part(root, f"wing_{side}", [(wing, m["accent"]), (trim, m["dark"])], pivot)
        # Wing tip blade (shares the wing pivot so both can flap together).
        cx, cz = s * 8.4, -3.9
        tip = C.extrude_poly([(cx - 1.2, cz - 3.5), (cx + 1.2, cz - 3.5), (cx + 1.2, cz + 2.0),
                              (cx, cz + 3.6), (cx - 1.2, cz + 2.0)], 2.6, bevel=0.3)
        C.add_part(root, f"tip_{side}", [(tip, m["accent2"])], pivot)
        # Engine flame: cone hinged at the nozzle, pointing down.
        fx = s * 3.2
        flame = C.loft([(-6.6, C.ngon(5, 1.5, 1.5))], tip_end=(0, 0, -10.5))
        C.move(flame, (fx, 0, 0))
        C.add_part(root, f"flame_{side}", [(flame, m["glow2"])], (fx, 0, -6.6))

    cockpit = C.icosphere(1.6, 1.5, 2.4, (0, -1.2, 3.2))
    C.add_part(root, "cockpit", [(cockpit, m["glow"])], (0, -1.2, 3.2))

    C.recentre(root)
    return [root]
