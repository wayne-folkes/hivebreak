"""Warden: armoured two-hit alien with a glowing core and spikes. ~17 x 14 pixels."""
import common as C

PALETTE = {
    "hull": 0x6B56C2,
    "accent": 0xC9C2E8,
    "dark": 0x3D2F7A,
    "glow": 0xFF4FD8,
}


def build():
    m = {k: C.material(k, v, emissive=(k == "glow")) for k, v in PALETTE.items()}
    root = C.new_root("warden")

    # Chamfered body with a dark frame around the core.
    shell = C.extrude_poly([(-6.5, 2.5), (6.5, 2.5), (6.5, -2.0), (5.0, -4.0), (-5.0, -4.0), (-6.5, -2.0)],
                           6.0, bevel=0.6)
    frame = C.extrude_poly([(-1.5, 3.4), (1.5, 3.4), (3.4, 1.5), (3.4, -1.5), (1.5, -3.4), (-1.5, -3.4),
                            (-3.4, -1.5), (-3.4, 1.5)], 0.9, y=-3.2)
    C.move(frame, (0, 0, -0.8))
    C.add_part(root, "body", [(shell, m["hull"]), (frame, m["dark"])])

    # Top armour plate.
    plate = C.extrude_poly([(-8.3, 2.4), (8.3, 2.4), (7.0, 5.0), (-7.0, 5.0)], 7.6, bevel=0.6)
    C.add_part(root, "plate", [(plate, m["accent"])], (0, 0, 3.6))

    core = C.icosphere(2.3, 2.3, 2.3, (0, -3.6, -0.8))
    C.add_part(root, "core", [(core, m["glow"])], (0, -3.6, -0.8))

    for s, side in ((-1, "L"), (1, "R")):
        # Spike: 4-sided cone leaning outward, hinged at its base on the plate.
        spike = C.loft([(0.0, C.ngon(4, 1.6, 1.6, 0.785))], tip_end=(0, 0, 4.4))
        C.rotate_y(spike, s * 0.4)
        base = (s * 6.4, 0, 3.0)
        C.move(spike, base)
        C.add_part(root, f"spike_{side}", [(spike, m["accent"])], base)

        # Foot: flared dark leg hinged under the body.
        x = s * 4.0
        foot = C.extrude_poly([(x - 1.1, -3.4), (x + 1.1, -3.4), (x + 1.5, -6.2), (x + 1.2, -7.0),
                               (x - 1.2, -7.0), (x - 1.5, -6.2)], 2.4)
        C.add_part(root, f"foot_{side}", [(foot, m["dark"])], (x, 0, -3.4))

    C.recentre(root)
    return [root]
