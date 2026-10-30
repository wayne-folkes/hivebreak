"""Homing missile: nose up, ~3 x 7 px, with a glow2 exhaust."""
import common as C

PALETTE = {
    "hull": 0xFFE9F6,
    "accent": 0xFF4FD8,
    "dark": 0x5A2C6E,
    "glow2": 0xFFB04F,
}

PREVIEW = {"size": 256}


def build():
    m = {k: C.material(k, v, emissive=k.startswith("glow")) for k, v in PALETTE.items()}
    root = C.new_root("missile")

    body = C.loft([(-1.8, C.ngon(4, 0.95, 0.95, 0.785)), (1.2, C.ngon(4, 1.0, 1.0, 0.785))],
                  tip_end=(0, 0, 3.5))
    band = C.loft([(-0.1, C.ngon(4, 1.1, 1.1, 0.785)), (0.7, C.ngon(4, 1.1, 1.1, 0.785))])
    nozzle = C.box(1.3, 1.3, 0.6, (0, 0, -2.0))
    C.add_part(root, "body", [(body, m["hull"]), (band, m["accent"]), (nozzle, m["dark"])])

    # Two small fins (a flat cross, so they read from the front too).
    fins = C.extrude_poly([(-1.5, -2.3), (-0.4, -0.4), (0.4, -0.4), (1.5, -2.3)], 0.35)
    C.add_part(root, "fins", [(fins, m["accent"])])

    flame = C.loft([(-2.3, C.ngon(4, 0.75, 0.75, 0.785))], tip_end=(0, 0, -3.5))
    C.add_part(root, "exhaust", [(flame, m["glow2"])], (0, 0, -2.3))

    C.recentre(root)
    return [root]
