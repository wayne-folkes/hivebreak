"""Acid drop: a falling acid-rain drop, pointed at the top, round at the bottom. ~3 x 6.5 pixels.
Parts: `drop` (`glow`, acid green), `core` (`glow2`, gold)."""
import common as C

PALETTE = {
    "glow": 0xC6F23C,
    "glow2": 0xF5C542,
}


def build():
    m = {k: C.material(k, v, emissive=True) for k, v in PALETTE.items()}
    root = C.new_root("acid_drop")

    drop = C.loft([(-2.4, C.ngon(6, 0.9, 0.9)), (-1.0, C.ngon(6, 1.6, 1.6)), (0.8, C.ngon(6, 1.2, 1.2))],
                  tip_start=(0, 0, -3.2), tip_end=(0, 0, 3.4))
    C.add_part(root, "drop", [(drop, m["glow"])])
    core = C.octa(0.6, 0.5, 0.9, (0, -1.5, -0.9))
    C.add_part(root, "core", [(core, m["glow2"])], (0, -1.5, -0.9))

    C.recentre(root)
    return [root]
