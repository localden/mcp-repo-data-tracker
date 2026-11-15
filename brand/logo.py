"""VISR brand mark, built entirely from code.

Run headless (CI does this, see .github/workflows/logo-render.yml):

    blender -b --factory-startup --python brand/logo.py -- \
        --out out/renders [--concepts a,b] [--samples 192] [--res 1024] \
        [--blend out/visr.blend]

Every concept is a function that builds a complete scene (geometry, materials,
lights, camera) with bpy only. One invocation renders every requested concept
to <out>/<concept>.png with a transparent background and writes
<out>/concepts.json for brand/post.py. The scene of FINAL is saved as a .blend.

Conventions: X is right, Z is up, the camera looks along +Y. The icon tile
spans -1..1 in X and Z and its front face sits at y = 0; relief grows toward
the camera (negative Y).
"""

import argparse
import json
import math
import os
import sys
import traceback

import bmesh
import bpy
from mathutils import Vector

# ----------------------------------------------------------------------------
# Palette (sRGB hex, taken from the product's tokens)
# ----------------------------------------------------------------------------

BLUE = "#2a78d6"
BLUE_HI = "#3987e5"
GRAPHITE = "#151518"
WHITE = "#f4f4f5"
SIGNAL = "#eb6834"

FINAL = "a"
DEFAULT_SET = ["a", "b", "c", "d", "e", "f", "a3"]


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hex_color, alpha=1.0):
    h = hex_color.lstrip("#")
    return (_lin(int(h[0:2], 16) / 255.0), _lin(int(h[2:4], 16) / 255.0), _lin(int(h[4:6], 16) / 255.0), alpha)


# ----------------------------------------------------------------------------
# Scene plumbing
# ----------------------------------------------------------------------------

def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def look_at(ob, target):
    direction = Vector(target) - Vector(ob.location)
    ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_render(scene, samples, res):
    scene.render.engine = "CYCLES"
    c = scene.cycles
    c.device = "CPU"
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.008
    c.use_denoising = True
    try:
        c.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        print("logo: OpenImageDenoise unavailable, using default denoiser")
    c.max_bounces = 8
    c.diffuse_bounces = 3
    c.glossy_bounces = 4
    c.transmission_bounces = 8
    c.transparent_max_bounces = 12
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.film_transparent_glass = False
    r = scene.render
    r.resolution_x = res
    r.resolution_y = res
    r.resolution_percentage = 100
    r.film_transparent = True
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    r.image_settings.color_depth = "8"
    r.image_settings.compression = 60
    vs = scene.view_settings
    vs.view_transform = "AgX"
    for look in ("AgX - Medium High Contrast", "Medium High Contrast", "AgX - Base Contrast"):
        try:
            vs.look = look
            break
        except Exception:
            continue
    vs.exposure = 0.0
    vs.gamma = 1.0


def setup_world(scene, strength=0.45, bottom=0.03, top=0.85):
    """Soft vertical gradient: dim floor, bright ceiling. Lights the bevels."""
    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mr = nt.nodes.new("ShaderNodeMapRange")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    bg = nt.nodes.new("ShaderNodeBackground")
    out = nt.nodes.new("ShaderNodeOutputWorld")
    mr.inputs[1].default_value = -1.0
    mr.inputs[2].default_value = 1.0
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[0].color = (bottom, bottom, bottom * 1.1, 1.0)
    ramp.color_ramp.elements[1].position = 0.9
    ramp.color_ramp.elements[1].color = (top, top, top * 1.04, 1.0)
    bg.inputs["Strength"].default_value = strength
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], mr.inputs[0])
    nt.links.new(mr.outputs[0], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    scene.world = world


def area_light(name, loc, target, energy, size, size_y=None, color=(1.0, 1.0, 1.0)):
    light = bpy.data.lights.new(name, "AREA")
    light.energy = energy
    light.color = color
    if size_y:
        light.shape = "RECTANGLE"
        light.size = size
        light.size_y = size_y
    else:
        light.shape = "DISK"
        light.size = size
    ob = link(bpy.data.objects.new(name, light))
    ob.location = loc
    look_at(ob, target)
    return ob


def studio(key=420.0, fill=110.0, rim=320.0, top=140.0):
    """Three-point area lighting plus a grazing top strip for the bevels."""
    area_light("Key", (-3.2, -5.2, 4.2), (0.0, 0.0, 0.0), key, 4.0, color=(1.0, 0.98, 0.96))
    area_light("Fill", (4.2, -4.5, -1.2), (0.0, 0.0, 0.0), fill, 6.0, color=(0.94, 0.97, 1.0))
    area_light("Rim", (3.0, 2.6, 3.8), (0.0, 0.0, 0.0), rim, 3.0)
    area_light("TopStrip", (0.0, -0.9, 4.6), (0.0, 0.0, 0.0), top, 5.0, 0.8)


def camera(scene, loc=(0.0, -10.0, 0.0), target=(0.0, 0.0, 0.0), ortho_scale=2.28):
    cam = bpy.data.cameras.new("Camera")
    cam.type = "ORTHO"
    cam.ortho_scale = ortho_scale
    cam.clip_start = 0.1
    cam.clip_end = 100.0
    ob = link(bpy.data.objects.new("Camera", cam))
    ob.location = loc
    look_at(ob, target)
    scene.camera = ob
    return ob


# ----------------------------------------------------------------------------
# Materials
# ----------------------------------------------------------------------------

def principled(name, color, rough=0.4, metallic=0.0, coat=0.0, coat_rough=0.08,
               emission=None, emission_strength=0.0, spec=0.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")

    def put(socket, value):
        if socket in bsdf.inputs:
            bsdf.inputs[socket].default_value = value

    put("Base Color", rgba(color) if isinstance(color, str) else color)
    put("Roughness", rough)
    put("Metallic", metallic)
    put("Specular IOR Level", spec)
    put("Coat Weight", coat)
    put("Coat Roughness", coat_rough)
    if emission is not None:
        put("Emission Color", rgba(emission) if isinstance(emission, str) else emission)
        put("Emission Strength", emission_strength)
    return mat


def glass(name, tint, body=0.12, body_color=None, rough=0.04, fresnel=0.35):
    """Thin tinted acrylic: coloured transparency, a little body, sharp reflections."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    transp.inputs["Color"].default_value = tint
    body_bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    body_bsdf.inputs["Base Color"].default_value = body_color or tint
    body_bsdf.inputs["Roughness"].default_value = 0.25
    gloss = nt.nodes.new("ShaderNodeBsdfPrincipled")
    gloss.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    gloss.inputs["Metallic"].default_value = 1.0
    gloss.inputs["Roughness"].default_value = rough
    mix_body = nt.nodes.new("ShaderNodeMixShader")
    mix_body.inputs[0].default_value = body
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = fresnel
    mix_refl = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(transp.outputs[0], mix_body.inputs[1])
    nt.links.new(body_bsdf.outputs[0], mix_body.inputs[2])
    nt.links.new(lw.outputs["Fresnel"], mix_refl.inputs[0])
    nt.links.new(mix_body.outputs[0], mix_refl.inputs[1])
    nt.links.new(gloss.outputs[0], mix_refl.inputs[2])
    nt.links.new(mix_refl.outputs[0], out.inputs["Surface"])
    return mat


def mat_graphite():
    return principled("Graphite", "#1d1d22", rough=0.42, coat=0.35, coat_rough=0.18)


def mat_blue(emit=0.0):
    return principled("Blue", BLUE, rough=0.3, coat=0.5, coat_rough=0.1,
                      emission=BLUE if emit else None, emission_strength=emit)


def mat_white(emit=0.0):
    return principled("White", WHITE, rough=0.38, coat=0.25,
                      emission=WHITE if emit else None, emission_strength=emit)


def mat_signal(emit=0.0):
    return principled("Signal", SIGNAL, rough=0.35, coat=0.4,
                      emission=SIGNAL if emit else None, emission_strength=emit)


# ----------------------------------------------------------------------------
# Outlines (2D point lists in the icon plane: x right, y up)
# ----------------------------------------------------------------------------

def _dedupe(pts, eps=1e-6):
    out = []
    for p in pts:
        if not out or abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) < eps and abs(out[0][1] - out[-1][1]) < eps:
        out.pop()
    return out


def rrect_pts(w, h, r, cx=0.0, cy=0.0, seg=20):
    r = max(1e-4, min(r, w / 2.0, h / 2.0))
    corners = (
        (cx + w / 2 - r, cy + h / 2 - r, 0.0),
        (cx - w / 2 + r, cy + h / 2 - r, 90.0),
        (cx - w / 2 + r, cy - h / 2 + r, 180.0),
        (cx + w / 2 - r, cy - h / 2 + r, 270.0),
    )
    pts = []
    for x, y, a0 in corners:
        for i in range(seg + 1):
            a = math.radians(a0 + 90.0 * i / seg)
            pts.append((x + r * math.cos(a), y + r * math.sin(a)))
    return _dedupe(pts)


def squircle_pts(half, n=5.0, count=320, cx=0.0, cy=0.0):
    """Superellipse |x|^n + |y|^n = half^n (the app-icon tile shape)."""
    pts = []
    e = 2.0 / n
    for i in range(count):
        t = 2.0 * math.pi * i / count
        c, s = math.cos(t), math.sin(t)
        pts.append((cx + half * math.copysign(abs(c) ** e, c), cy + half * math.copysign(abs(s) ** e, s)))
    return _dedupe(pts)


# ----------------------------------------------------------------------------
# Geometry
# ----------------------------------------------------------------------------

def plate(name, pts, depth, bevel, mat, y_front=0.0, holes=(), bevel_res=8):
    """Extruded 2D outline with rounded front/back edges, facing the camera.

    Curve bevels grow outward by `bevel`, so callers pass outlines already
    inset by that amount (holes: outset). Front face lands at y = y_front.
    """
    bevel = max(0.0, min(bevel, depth / 2.0 - 1e-4))
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.extrude = depth / 2.0 - bevel
    cu.bevel_depth = bevel
    cu.bevel_resolution = bevel_res
    for loop in [pts] + list(holes):
        sp = cu.splines.new("POLY")
        sp.points.add(len(loop) - 1)
        for point, (x, y) in zip(sp.points, loop):
            point.co = (x, y, 0.0, 1.0)
        sp.use_cyclic_u = True
        sp.use_smooth = True
    cu.materials.append(mat)
    ob = link(bpy.data.objects.new(name, cu))
    ob.rotation_euler = (math.pi / 2.0, 0.0, 0.0)  # local +Z -> world -Y
    ob.location = (0.0, y_front + depth / 2.0, 0.0)
    return ob


def rplate(name, w, h, r, depth, bevel, mat, cx=0.0, cz=0.0, y_front=0.0):
    pts = rrect_pts(w - 2 * bevel, h - 2 * bevel, r - bevel, cx, cz)
    return plate(name, pts, depth, bevel, mat, y_front)


def tile(mat, half=1.0, depth=0.30, bevel=0.06, n=5.0, y_front=0.0, holes=(), name="Tile"):
    return plate(name, squircle_pts(half - bevel, n), depth, bevel, mat, y_front, holes)


def sphere(name, loc, radius, mat, scale=(1.0, 1.0, 1.0), seg=64):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=radius)
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me))
    ob.location = loc
    ob.scale = scale
    return ob


def tube(name, pts, radius, mat, y=0.0, flat=1.0, joints=True):
    """Round stroke through 2D points (x, z) at depth y, round caps and joins.

    `flat` < 1 squashes the stroke toward the tile for a lower relief.
    """
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.fill_mode = "FULL"
    cu.bevel_depth = radius
    cu.bevel_resolution = 16
    cu.use_fill_caps = True
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        sp = cu.splines.new("POLY")
        sp.points.add(1)
        sp.points[0].co = (ax, 0.0, az, 1.0)
        sp.points[1].co = (bx, 0.0, bz, 1.0)
        sp.use_smooth = True
    cu.materials.append(mat)
    ob = link(bpy.data.objects.new(name, cu))
    ob.location = (0.0, y, 0.0)
    ob.scale = (1.0, flat, 1.0)
    made = [ob]
    if joints:
        for i, (px, pz) in enumerate(pts):
            made.append(sphere(f"{name}.j{i}", (px, y, pz), radius, mat, scale=(1.0, flat, 1.0), seg=48))
    return made


def prism(name, pts, y0, y1):
    """Closed mesh prism from an (x, z) outline, extruded from y0 to y1."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((x, y0, z)) for x, z in pts])
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    verts = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0.0, y1 - y0, 0.0), verts=verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


# ----------------------------------------------------------------------------
# Concepts
# ----------------------------------------------------------------------------

def check_trend(tile_mat, stroke_mat, dot_mat, radius=0.115, dot=0.2):
    """A V that is at once a check mark and a recovering trend line."""
    tile(tile_mat)
    pts = [(-0.50, 0.12), (-0.16, -0.36), (0.44, 0.38)]
    tube("Stroke", pts, radius, stroke_mat, y=-radius * 0.8, flat=0.9)
    sphere("DataPoint", (pts[-1][0], -dot * 0.8, pts[-1][1]), dot, dot_mat, scale=(1.0, 0.9, 1.0))


def concept_a(scene):
    check_trend(mat_graphite(), mat_blue(), mat_white(emit=0.6))
    studio()
    camera(scene)


def concept_e(scene):
    check_trend(mat_blue(), mat_white(), mat_signal(emit=0.4))
    studio()
    camera(scene)


def concept_a3(scene):
    """Concept a seen three-quarter, to judge a tilted hero angle."""
    check_trend(mat_graphite(), mat_blue(), mat_white(emit=0.6))
    studio()
    camera(scene, loc=(4.2, -8.6, 3.0), ortho_scale=2.75)


def visor_shell(slot_w=1.5, slot_h=0.64, slot_z=0.10, recess=0.085):
    """Graphite helmet tile with a pill slot; returns the slot geometry."""
    g = mat_graphite()
    lip = 0.03
    hole = rrect_pts(slot_w + 2 * lip, slot_h + 2 * lip, slot_h / 2 + lip, 0.0, slot_z)
    plate("Shell", squircle_pts(1.0 - lip, 5.0), recess + 0.03, lip, g, 0.0, holes=[hole])
    plate("Back", squircle_pts(0.985 - 0.06, 5.0), 0.30 - recess, 0.06, g, recess)
    return slot_w, slot_h, slot_z, recess


def visor_glass(slot_w, slot_h, slot_z):
    cover = glass("VisorGlass", (0.82, 0.90, 1.0, 1.0), body=0.03, fresnel=0.3)
    plate("Glass", rrect_pts(slot_w - 0.02, slot_h - 0.02, slot_h / 2, 0.0, slot_z), 0.02, 0.004, cover, 0.006)


def concept_b(scene):
    """Helmet visor: a dark slot with ascending bars behind glass."""
    w, h, z, recess = visor_shell()
    screen = principled("Screen", "#0a1220", rough=0.5, emission="#0d2a55", emission_strength=0.5)
    plate("Screen", rrect_pts(w + 0.1, h + 0.1, h / 2 + 0.05, 0.0, z), 0.03, 0.0, screen, recess - 0.005)
    heights = (0.16, 0.26, 0.36, 0.46)
    bar_w, gap = 0.2, 0.1
    x0 = -(len(heights) * bar_w + (len(heights) - 1) * gap) / 2 + bar_w / 2
    base = z - 0.23
    for i, bh in enumerate(heights):
        last = i == len(heights) - 1
        m = mat_white(emit=1.6) if last else mat_blue(emit=1.8)
        rplate(f"Bar{i}", bar_w, bh, 0.05, 0.04, 0.012, m, x0 + i * (bar_w + gap), base + bh / 2, recess - 0.045)
    visor_glass(w, h, z)
    studio()
    camera(scene)


def concept_f(scene):
    """Helmet visor: a lit blue slot carrying the check/trend stroke."""
    w, h, z, recess = visor_shell()
    screen = principled("Screen", BLUE, rough=0.45, emission=BLUE, emission_strength=0.9)
    plate("Screen", rrect_pts(w + 0.1, h + 0.1, h / 2 + 0.05, 0.0, z), 0.03, 0.0, screen, recess - 0.005)
    pts = [(-0.40, z + 0.08), (-0.18, z - 0.13), (0.36, z + 0.13)]
    tube("Trend", pts, 0.055, mat_white(emit=1.2), y=recess - 0.05, flat=0.7)
    sphere("DataPoint", (pts[-1][0], recess - 0.06, pts[-1][1]), 0.095, mat_white(emit=1.6), scale=(1.0, 0.7, 1.0))
    visor_glass(w, h, z)
    studio()
    camera(scene)


def concept_c(scene):
    """Three ascending bars read through a tinted glass visor band."""
    tile(mat_graphite())
    white = mat_white()
    heights = (0.50, 0.80, 1.10)
    bar_w, gap = 0.34, 0.14
    x0 = -(3 * bar_w + 2 * gap) / 2 + bar_w / 2
    base = -0.58
    for i, bh in enumerate(heights):
        rplate(f"Bar{i}", bar_w, bh, 0.10, 0.16, 0.035, white, x0 + i * (bar_w + gap), base + bh / 2, -0.16)
    band = glass("VisorBand", rgba(BLUE_HI), body=0.38, body_color=rgba(BLUE), fresnel=0.3)
    rplate("Visor", 1.72, 0.36, 0.18, 0.07, 0.03, band, 0.0, 0.04, -0.30)
    studio()
    camera(scene)


def concept_d(scene):
    """Helmet orb: a graphite sphere with a wrapped visor showing three bars."""
    made = []
    shell = principled("Helmet", "#1d1d22", rough=0.3, coat=0.7, coat_rough=0.06)
    made.append(sphere("Helmet", (0.0, 0.0, 0.0), 0.90, shell, seg=96))
    visor_mat = principled("Visor", BLUE, rough=0.22, coat=0.8, coat_rough=0.04, emission=BLUE, emission_strength=0.35)
    visor = sphere("Visor", (0.0, 0.0, 0.0), 0.925, visor_mat, seg=128)
    vz, vh = 0.10, 0.56
    cutter = prism("VisorCutter", rrect_pts(1.34, vh, vh / 2, 0.0, vz), -2.0, 0.0)
    cutter.hide_render = True
    cutter.display_type = "WIRE"
    mod = visor.modifiers.new("Cut", "BOOLEAN")
    mod.operation = "INTERSECT"
    mod.solver = "EXACT"
    mod.object = cutter
    made += [visor, cutter]
    radius = 0.945
    bars = mat_white(emit=1.4)
    for i, (x, top) in enumerate(((-0.26, 0.10), (0.0, 0.21), (0.26, 0.32))):
        z0 = vz - 0.13
        y0 = -math.sqrt(radius ** 2 - x ** 2 - z0 ** 2)
        y1 = -math.sqrt(radius ** 2 - x ** 2 - top ** 2)
        ym = (y0 + y1) / 2.0
        made += tube(f"Bar{i}", [(x, z0), (x, top)], 0.055, bars, y=ym)
    rig = link(bpy.data.objects.new("Rig", None))
    for ob in made:
        ob.parent = rig
    rig.rotation_euler = (math.radians(-6.0), 0.0, math.radians(22.0))
    studio()
    camera(scene, ortho_scale=2.1)


CONCEPTS = {
    "a": (concept_a, "check-trend, graphite tile"),
    "b": (concept_b, "helmet visor, bars in slot"),
    "c": (concept_c, "bars under a glass visor band"),
    "d": (concept_d, "helmet orb"),
    "e": (concept_e, "check-trend, blue tile"),
    "f": (concept_f, "helmet visor, trend in slot"),
    "a3": (concept_a3, "check-trend, three-quarter"),
}


# ----------------------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------------------

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="logo.py")
    ap.add_argument("--out", default="out/renders")
    ap.add_argument("--concepts", default=",".join(DEFAULT_SET))
    ap.add_argument("--samples", type=int, default=160)
    ap.add_argument("--res", type=int, default=1024)
    ap.add_argument("--blend", default="")
    ap.add_argument("--final", default=FINAL)
    args = ap.parse_args(argv)

    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    wanted = [c.strip() for c in args.concepts.split(",") if c.strip()]
    if wanted == ["all"]:
        wanted = list(CONCEPTS)

    done, failed = [], {}
    for key in wanted:
        if key not in CONCEPTS:
            failed[key] = "unknown concept"
            continue
        build, label = CONCEPTS[key]
        print(f"logo: === concept {key}: {label} ===", flush=True)
        try:
            scene = new_scene()
            setup_render(scene, args.samples, args.res)
            setup_world(scene)
            build(scene)
            scene.render.filepath = os.path.join(out_dir, key + ".png")
            if args.blend and key == args.final:
                blend_path = os.path.abspath(args.blend)
                os.makedirs(os.path.dirname(blend_path), exist_ok=True)
                scene.render.filepath = "//" + key + ".png"
                bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True, relative_remap=False)
                scene.render.filepath = os.path.join(out_dir, key + ".png")
            bpy.ops.render.render(write_still=True)
            done.append(key)
        except Exception:
            failed[key] = traceback.format_exc()
            print(f"logo: concept {key} FAILED\n{failed[key]}", flush=True)

    meta = {
        "order": done,
        "final": args.final if args.final in done else "",
        "concepts": {k: {"label": CONCEPTS[k][1]} for k in done},
        "failed": failed,
    }
    with open(os.path.join(out_dir, "concepts.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    print(f"logo: rendered {done}; failed {list(failed)}", flush=True)
    if not done:
        raise SystemExit(1)


main()
