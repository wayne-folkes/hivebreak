"""Mine: slice 4a hazard, a spiky steel ball with a blinking red light. ~8 x 8 pixels.
Parts: `body` (ball and eight in-plane spikes), `light` (red `glow`, pivot at its centre so the
game can blink or tint it). Origin is the ball centre, so spinning the root about the screen axis
is clean."""
import math

import common as C

PALETTE = {
    "hull": 0xB4BCCB,
    "accent": 0x7A8396,    # spikes
    "dark": 0x323847,      # light collar
    "glow": 0xFF4040,
}


def build():
    m = {k: C.material(k, v, emissive=(k == "glow")) for k, v in PALETTE.items()}
    root = C.new_root("mine")

    ball = C.icosphere(3.0, 3.0, 3.0, subdiv=1)
    spikes = []
    for k in range(8):
        c, s = math.cos(k * math.pi / 4), math.sin(k * math.pi / 4)
        spikes.append(C.loft([(2.0, C.ngon(4, 1.4, 1.4, 0.785))], tip_end=(0, 0, 4.0),
                             mapf=lambda a, b, w, c=c, s=s: (w * c - a * s, b, w * s + a * c)))
    C.add_part(root, "body", [(ball, m["hull"])] + [(sp, m["accent"]) for sp in spikes])

    collar = C.extrude_poly(C.ngon(6, 1.5, 1.5), 0.6, y=-2.7)
    C.add_part(root, "collar", [(collar, m["dark"])], (0, -2.7, 0))
    light = C.octa(1.0, 0.8, 1.0, (0, -3.0, 0))
    C.add_part(root, "light", [(light, m["glow"])], (0, -3.0, 0))

    C.recentre(root)
    return [root]
