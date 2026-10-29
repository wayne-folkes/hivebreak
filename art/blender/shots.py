"""Shots: player bolt (thin, ~1.6 x 7) and alien diamond (~4). Two roots in one file."""
import common as C


def build():
    bolt_mat = C.material("glow", 0x9FFBFF, emissive=True)
    root_p = C.new_root("shot_player")
    bolt = C.loft([(2.3, C.ngon(4, 0.8, 0.8)), (-2.3, C.ngon(4, 0.8, 0.8))],
                  tip_start=(0, 0, 3.5), tip_end=(0, 0, -3.5))
    C.add_part(root_p, "bolt", [(bolt, bolt_mat)])
    C.recentre(root_p)

    root_a = C.new_root("shot_alien")
    gem = C.octa(2.0, 1.6, 2.4)
    mat_a = C.material("glow2", 0xFF4FD8, emissive=True)
    C.add_part(root_a, "diamond", [(gem, mat_a)])
    C.recentre(root_a)
    return [root_p, root_a]
