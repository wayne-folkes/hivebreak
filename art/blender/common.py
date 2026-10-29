"""Shared helpers for the Hivebreak Blender model scripts.

Conventions (see README.md): 1 Blender unit = 1 art pixel, +Z up, the side the player sees
faces -Y (toward the front-view camera). Geometry helpers build bmeshes in *model space*;
`add_part` then moves each one into an object whose origin is the part's hinge (pivot).
"""
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

ART_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = ART_DIR.parent
MODELS_DIR = REPO_DIR / "client" / "public" / "models"
PREVIEW_DIR = ART_DIR / "previews"


# --- scene and materials ---------------------------------------------------------------

def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(coll):
            coll.remove(block)


def _linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(h):
    return tuple(_linear(((h >> s) & 255) / 255) for s in (16, 8, 0)) + (1.0,)


def material(role, color, emissive=False):
    """Simple flat material named after its role (hull, accent, dark, glow, ...)."""
    mat = bpy.data.materials.get(role) or bpy.data.materials.new(role)
    col = hex_to_linear(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = col
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
    if emissive:
        bsdf.inputs["Emission Color"].default_value = col
        bsdf.inputs["Emission Strength"].default_value = 1.0
    mat.diffuse_color = col  # what Workbench previews show
    return mat


# --- geometry builders (all return a BMesh in model space) -----------------------------

def new_bm():
    return bmesh.new()


def ngon(n, rx, ry, start=0.0):
    """Points of a regular (elliptical) n-gon; start=0 puts the first vertex on +a."""
    return [(rx * math.cos(start + 2 * math.pi * i / n), ry * math.sin(start + 2 * math.pi * i / n))
            for i in range(n)]


def box(sx, sy, sz, center=(0, 0, 0)):
    bm = new_bm()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = (v.co.x * sx + center[0], v.co.y * sy + center[1], v.co.z * sz + center[2])
    return bm


def extrude_poly(points_xz, depth, y=0.0, bevel=0.0):
    """Polygon in the XZ plane, extruded along Y (front cap faces -Y). Optional cap bevel."""
    bm = new_bm()
    y0, y1 = y - depth / 2, y + depth / 2
    front = [bm.verts.new((px, y0, pz)) for px, pz in points_xz]
    back = [bm.verts.new((px, y1, pz)) for px, pz in points_xz]
    caps = [bm.faces.new(front), bm.faces.new(back)]
    n = len(points_xz)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    if bevel > 0:
        edges = list({e for f in caps for e in f.edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, offset_type="OFFSET", segments=1,
                        profile=0.5, affect="EDGES")
    return bm


def loft(rings, tip_end=None, tip_start=None, mapf=None):
    """Skin consecutive rings. rings = [(w, [(a, b), ...]), ...]; mapf(a, b, w) -> (x, y, z).
    Ends are closed with a point (tip_*, given as (a, b, w)) or a flat cap."""
    mapf = mapf or (lambda a, b, w: (a, b, w))
    bm = new_bm()
    rv = [[bm.verts.new(mapf(a, b, w)) for a, b in pts] for w, pts in rings]
    n = len(rv[0])
    for r0, r1 in zip(rv, rv[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    for ring, tip in ((rv[-1], tip_end), (rv[0], tip_start)):
        if tip is None:
            bm.faces.new(ring)
        else:
            t = bm.verts.new(mapf(*tip))
            for i in range(n):
                bm.faces.new((ring[i], ring[(i + 1) % n], t))
    return bm


def octa(rx, ry, rz, center=(0, 0, 0)):
    bm = new_bm()
    cx, cy, cz = center
    px = [bm.verts.new((cx + rx, cy, cz)), bm.verts.new((cx - rx, cy, cz))]
    py = [bm.verts.new((cx, cy + ry, cz)), bm.verts.new((cx, cy - ry, cz))]
    pz = [bm.verts.new((cx, cy, cz + rz)), bm.verts.new((cx, cy, cz - rz))]
    for a in px:
        for b in py:
            for c in pz:
                bm.faces.new((a, b, c))
    return bm


def icosphere(rx, ry, rz, center=(0, 0, 0), subdiv=1):
    bm = new_bm()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        v.co = (v.co.x * rx + center[0], v.co.y * ry + center[1], v.co.z * rz + center[2])
    return bm


def move(bm, offset):
    bmesh.ops.translate(bm, vec=Vector(offset), verts=bm.verts)
    return bm


def rotate_y(bm, angle):
    """Rotate about the Y axis (tilts +Z toward +X for positive angles)."""
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(angle, 3, "Y"), verts=bm.verts)
    return bm


# --- parts and export -------------------------------------------------------------------

def new_root(name):
    root = bpy.data.objects.new(name, None)
    root.empty_display_type = "PLAIN_AXES"
    bpy.context.scene.collection.objects.link(root)
    return root


def add_part(root, name, pieces, pivot=(0, 0, 0)):
    """Merge `pieces` [(bmesh, material), ...] (model space) into one flat-shaded object named
    `name`, parented to `root`, whose origin sits at `pivot` (the hinge)."""
    combined = bmesh.new()
    mats = []
    for bm, mat in pieces:
        if mat not in mats:
            mats.append(mat)
        vmap = {v: combined.verts.new(Vector(v.co) - Vector(pivot)) for v in bm.verts}
        for f in bm.faces:
            nf = combined.faces.new([vmap[v] for v in f.verts])
            nf.material_index = mats.index(mat)
        bm.free()
    bmesh.ops.remove_doubles(combined, verts=combined.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(combined, faces=combined.faces)
    mesh = bpy.data.meshes.new(name)
    combined.to_mesh(mesh)
    combined.free()
    for m in mats:
        mesh.materials.append(m)
    for p in mesh.polygons:
        p.use_smooth = False
    obj = bpy.data.objects.new(name, mesh)
    obj.location = pivot
    obj.parent = root
    bpy.context.scene.collection.objects.link(obj)
    return obj


def bounds(objs):
    """World-space (min, max) over mesh objects (parts only have a location, no rot/scale)."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != "MESH":
            continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def recentre(root):
    """Shift the parts so the model's bounding-box centre sits on the root origin."""
    kids = list(root.children)
    bpy.context.view_layer.update()
    lo, hi = bounds(kids)
    c = (lo + hi) / 2
    for o in kids:
        o.location = o.location - c
    bpy.context.view_layer.update()


def export_glb(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_draco_mesh_compression_enable=False,
        export_materials="EXPORT",
        export_normals=True,
    )


def render_preview(path, roots, size=256, bg=(0.02, 0.012, 0.045)):
    """Orthographic front render (camera on -Y looking +Y, up = +Z), framed to `roots`."""
    scene = bpy.context.scene
    # Spread multiple roots (the two shots) sideways, just for the preview.
    if len(roots) > 1:
        for i, r in enumerate(roots):
            r.location.x = (i - (len(roots) - 1) / 2) * 8
    bpy.context.view_layer.update()
    lo, hi = bounds([o for r in roots for o in r.children])
    c = (lo + hi) / 2
    span = max(hi.x - lo.x, hi.z - lo.z)

    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = span * 1.3
    cam = bpy.data.objects.new("preview_cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (c.x, -100, c.z)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam

    world = bpy.data.worlds.new("preview_world")
    world.color = bg
    scene.world = world
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_specular_highlight = False
    sh.show_object_outline = True
    sh.object_outline_color = (0.03, 0.015, 0.06)
    scene.render.filepath = str(path)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)

    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.cameras.remove(cam_data)
    for r in roots:
        r.location = (0, 0, 0)
