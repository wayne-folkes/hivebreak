"""Interceptor: a narrow, fast dart with sharply swept wings and one long engine flame. ~19 x 22 px."""
import common as C

PALETTE = {
    "hull": 0xFFE9F6,      # pale pink-white
    "accent": 0xFF4FD8,    # magenta wings
    "accent2": 0x8B3FD9,   # violet wing blades
    "dark": 0x5A2C6E,
    "glow": 0x4FF0FF,      # cockpit
    "glow2": 0xFFD36A,     # engine flame
}


def tri(hw, d):
    """Triangular-ish (kite) cross-section with a ridge facing the camera (-Y)."""
    return [(0, -d), (hw, 0.2 * d), (0, d), (-hw, 0.2 * d)]


def build():
    m = {k: C.material(k, v, emissive=k.startswith("glow")) for k, v in PALETTE.items()}
    root = C.new_root("interceptor")

    # Needle fuselage: slim, long nose, one fat nozzle.
    body = C.loft([(-5.0, tri(2.3, 2.2)), (0.0, tri(2.6, 2.5)), (5.0, tri(1.6, 1.6))],
                  tip_end=(0, 0, 11.5))
    nozzle = C.box(2.6, 2.4, 1.6, (0, 0, -5.4))
    # Small dark intakes either side of the cockpit.
    pieces = [(body, m["hull"]), (nozzle, m["dark"])]
    C.add_part(root, "hull", pieces)

    for s, side in ((-1, "L"), (1, "R")):
        pivot = (s * 2.3, 0, -1.5)
        # Sharply swept delta wing: long leading edge raking back to a wide, low tip.
        wing = C.extrude_poly([(s * 2.0, 3.5), (s * 8.6, -6.4), (s * 8.6, -8.0), (s * 2.0, -5.0)],
                              1.8, bevel=0.3)
        trim = C.extrude_poly([(s * 3.0, -1.2), (s * 7.6, -6.7), (s * 7.6, -7.4), (s * 3.0, -3.2)],
                              0.3, y=-0.95)
        C.add_part(root, f"wing_{side}", [(wing, m["accent"]), (trim, m["dark"])], pivot)
        # Wing tip blade: a thin violet fin raking backward off the tip.
        cx = s * 8.3
        tip = C.extrude_poly([(cx - 0.8, -4.2), (cx + 0.8, -4.9), (cx + 0.8, -9.0), (cx - 0.8, -9.4)],
                             2.4, bevel=0.2)
        C.add_part(root, f"tip_{side}", [(tip, m["accent2"])], pivot)
        # One long flame, drawn as two narrow cones side by side (the renderer flickers both).
        fx = s * 0.75
        flame = C.loft([(-6.2, C.ngon(5, 1.1, 1.1))], tip_end=(0, 0, -11.5))
        C.move(flame, (fx, 0, 0))
        C.add_part(root, f"flame_{side}", [(flame, m["glow2"])], (fx, 0, -6.2))

    cockpit = C.icosphere(1.1, 1.3, 2.4, (0, -1.5, 3.8))
    C.add_part(root, "cockpit", [(cockpit, m["glow"])], (0, -1.5, 3.8))

    C.recentre(root)
    return [root]
