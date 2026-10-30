"""Re-import each exported .glb into a fresh scene and print its size and triangle count.

Standalone:  blender -b --factory-startup --python art/blender/check.py
"""
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common as C  # noqa: E402

NAMES = ["player", "drone", "warden", "diver", "shots", "carrier", "brood_mother", "pickups",
         "helper"]
TRI_LIMIT = 400
TRI_LIMITS = {"brood_mother": 1200, "pickups": 800}  # bigger models / several roots in one file


def run():
    ok = True
    for name in NAMES:
        path = C.MODELS_DIR / f"{name}.glb"
        C.clear_scene()
        bpy.ops.import_scene.gltf(filepath=str(path))
        bpy.context.view_layer.update()
        meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
        lo, hi = C.bounds(meshes)
        tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
        # Blender axes after import: X width, Z height, Y depth.
        size = hi - lo
        c = (lo + hi) / 2
        names = sorted(o.name for o in bpy.context.scene.objects)
        print(f"[check] {name}.glb  size W{size.x:.1f} x H{size.z:.1f} x D{size.y:.1f}  "
              f"centre ({c.x:.1f}, {c.y:.1f}, {c.z:.1f})  tris {tris}")
        print(f"[check]   nodes: {', '.join(names)}")
        limit = TRI_LIMITS.get(name, TRI_LIMIT)
        if tris >= limit and name != "shots":
            ok = False
            print(f"[check]   WARNING: over {limit} triangles")
    return ok


if __name__ == "__main__":
    run()
