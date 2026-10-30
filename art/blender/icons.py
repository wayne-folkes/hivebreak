"""Ship icons for the UI: 32x32 transparent front-view renders of the four ships.

Run from client/:  npm run icons
  (= blender -b --factory-startup --python ../art/blender/icons.py)
Writes client/public/ships/<id>.png (no anti-aliasing; the UI shows them pixelated at 3x).
The ships share one scale (ICON_SCALE px per unit) so their relative sizes match the game.
"""
import importlib
import math
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common as C  # noqa: E402

SHIPS = [("breaker", "player"), ("interceptor", "interceptor"), ("lancer", "lancer"), ("bastion", "bastion")]
SIZE = 32
ICON_SCALE = 1.25  # pixels per model unit (the tallest ship, 23 units, fills 29 of 32 px)
OUT_DIR = C.REPO_DIR / "client" / "public" / "ships"


def hard_alpha(path):
    """Workbench still softens the silhouette edge a little; snap alpha to 0 or 1 for crisp pixels."""
    img = bpy.data.images.load(str(path))
    px = list(img.pixels)
    for i in range(3, len(px), 4):
        px[i] = 1.0 if px[i] >= 0.5 else 0.0
    img.pixels[:] = px
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def render_icon(root, path):
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    lo, hi = C.bounds(list(root.children))
    c = (lo + hi) / 2

    cam_data = bpy.data.cameras.new("icon_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = SIZE / ICON_SCALE
    cam = bpy.data.objects.new("icon_cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (c.x, -100, c.z)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam

    world = bpy.data.worlds.new("icon_world")
    scene.world = world
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.display.render_aa = "OFF"
    sh = scene.display.shading
    sh.light = "FLAT"
    sh.color_type = "MATERIAL"
    sh.show_specular_highlight = False
    sh.show_object_outline = True
    sh.object_outline_color = (0.03, 0.015, 0.06)
    scene.render.filepath = str(path)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)
    hard_alpha(path)

    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.cameras.remove(cam_data)


def main():
    for icon_id, modname in SHIPS:
        C.clear_scene()
        roots = importlib.import_module(modname).build()
        out = OUT_DIR / f"{icon_id}.png"
        render_icon(roots[0], out)
        print(f"[icons] {icon_id}: wrote {out.relative_to(C.REPO_DIR)}")


main()
