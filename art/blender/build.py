"""Build every Hivebreak model: export .glb files and render preview PNGs.

Run from client/:  npm run models
  (= blender -b --factory-startup --python ../art/blender/build.py)
"""
import importlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common as C  # noqa: E402

# (output name, module). shots builds two roots into one file.
MODELS = [("player", "player"), ("drone", "drone"), ("warden", "warden"),
          ("diver", "diver"), ("shots", "shots"), ("carrier", "carrier"),
          ("brood_mother", "brood_mother"), ("pickups", "pickups"), ("helper", "helper"),
          ("splitter", "splitter"), ("mini", "mini"), ("hive_mind", "hive_mind"),
          ("interceptor", "interceptor"), ("lancer", "lancer"), ("bastion", "bastion"),
          ("missile", "missile"), ("well", "well"),
          ("warper", "warper"), ("mender", "mender"), ("mine", "mine"), ("acid_drop", "acid_drop")]


def main():
    for name, modname in MODELS:
        C.clear_scene()
        mod = importlib.import_module(modname)
        roots = mod.build()
        out = C.MODELS_DIR / f"{name}.glb"
        C.export_glb(out)
        C.render_preview(C.PREVIEW_DIR / f"{name}.png", roots, **getattr(mod, "PREVIEW", {}))
        print(f"[models] {name}: wrote {out.relative_to(C.REPO_DIR)}")

    import check
    check.run()


main()
