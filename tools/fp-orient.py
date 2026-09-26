"""Find which world axis the fp's lens mount faces, so the viewer
sees the FRONT of the camera rather than its top plate.

Renders the model from all six axis directions, one file per axis.

    blender --background --python tools/fp-orient.py
"""
import bpy, math, os, mathutils

GLB = "/Users/priticolours/Desktop/cmprssr-site/assets/models/sigma-fp.glb"
OUT = "/Users/priticolours/Desktop/cmprssr-site/.shots"
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
obj = [o for o in bpy.data.objects if o.type == "MESH"][0]

mat = bpy.data.materials.new("m")
mat.use_nodes = True
b = mat.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (0.22, 0.24, 0.27, 1)
b.inputs["Roughness"].default_value = 0.45
obj.data.materials.append(mat)

w = bpy.data.worlds.new("w")
bpy.context.scene.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.08, 0.11, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 2.4

for nm, loc in (("key", (2.4, -2.6, 3.0)), ("fill", (-2.2, -2.0, 0.6))):
    L = bpy.data.lights.new(nm, type="AREA")
    L.energy = 380 if nm == "key" else 130
    L.size = 5
    o = bpy.data.objects.new(nm, L)
    o.location = loc
    bpy.context.collection.objects.link(o)

cam = bpy.data.cameras.new("cam")
cam.lens = 70
co = bpy.data.objects.new("cam", cam)
bpy.context.collection.objects.link(co)
bpy.context.scene.camera = co
scn = bpy.context.scene
scn.render.resolution_x = 420
scn.render.resolution_y = 420
scn.render.image_settings.file_format = "PNG"

# straight-on from each of the six axis directions
R = 4.0
DIRS = {
    "+X": ( R, 0, 0), "-X": (-R, 0, 0),
    "+Y": ( 0, R, 0), "-Y": ( 0,-R, 0),
    "+Z": ( 0, 0, R), "-Z": ( 0, 0,-R),
}
for name, loc in DIRS.items():
    co.location = loc
    d = mathutils.Vector((0, 0, 0)) - co.location
    co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scn.render.filepath = os.path.join(OUT, "fp-axis-%s.png" % name.replace("+", "p").replace("-", "n"))
    bpy.ops.render.render(write_still=True)
    print("rendered %s" % name)
