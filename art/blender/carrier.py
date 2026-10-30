"""Carrier: slow power-up bearer, a squat teal saucer with a cargo ring and glowing pod. ~22 x 14 pixels."""
import common as C

PALETTE = {
    "hull": 0x3FD6A0,
    "accent": 0x1F7A66,    # cargo ring, hull band
    "dark": 0x14453A,
    "glow": 0xFFE14F,      # eyes
    "glow2": 0xFFB04F,     # the pod (the game tints it to the carried power-up)
}

POD = (0.0, -0.4, -2.0)


def build():
    m = {k: C.material(k, v, emissive=k.startswith("glow")) for k, v in PALETTE.items()}
    root = C.new_root("carrier")

    # Hull: flattened hexagon saucer, a dark belt across it and a small raised bridge on top.
    shell = C.extrude_poly([(-11, 2.0), (-6.5, 6.8), (6.5, 6.8), (11, 2.0), (6.5, -1.6), (-6.5, -1.6)],
                           7.0, bevel=0.7)
    belt = C.extrude_poly([(-11.4, 3.2), (11.4, 3.2), (11.4, 1.6), (-11.4, 1.6)], 7.4)
    bridge = C.extrude_poly([(-4.0, 6.4), (4.0, 6.4), (2.8, 7.6), (-2.8, 7.6)], 4.6, bevel=0.3)
    skirt = C.extrude_poly([(-5.0, -1.2), (5.0, -1.2), (3.6, -2.4), (-3.6, -2.4)], 5.0)
    C.add_part(root, "hull", [(shell, m["hull"]), (belt, m["accent"]), (bridge, m["accent"]),
                              (skirt, m["dark"])])

    # Cargo ring hanging under the hull, around the pod.
    ro, ri = 4.4, 2.9
    outer = C.ngon(10, ro, ro, 0.314)
    inner = C.ngon(10, ri, ri, 0.314)
    ring = C.extrude_ring(outer, inner, 2.2)
    C.move(ring, (POD[0], POD[1], POD[2] - 0.4))
    C.add_part(root, "ring", [(ring, m["accent"])], (POD[0], POD[1], POD[2] - 0.4))

    # Pod: glowing crystal; pivot at its centre so it can spin about the vertical axis.
    pod = C.octa(2.3, 2.3, 2.8, POD)
    C.add_part(root, "pod", [(pod, m["glow2"])], POD)

    # Slanted eyes on the front of the saucer.
    for s, side in ((-1, "L"), (1, "R")):
        cx, cy, cz = s * 3.6, -3.7, 4.2
        eye = C.extrude_poly([(cx - s * 1.5, cz + 1.0), (cx + s * 1.3, cz + 0.1),
                              (cx + s * 1.3, cz - 1.0), (cx - s * 1.5, cz - 1.0)], 1.0, y=cy)
        C.add_part(root, f"eye_{side}", [(eye, m["glow"])], (cx, cy, cz))

    C.recentre(root)
    return [root]
