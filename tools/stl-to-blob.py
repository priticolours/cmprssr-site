"""Convert the fp STL into a flat binary blob for gl.js: interleaved
position + normal per vertex, plus triangle indices. No materials, no
UVs, no node graph — the shader does the shading.

    blender --background --python tools/stl-to-blob.py

Output: assets/models/sigma-fp.bin
        assets/models/sigma-fp.json   (metadata gl.js reads)
"""
import bpy, bmesh, struct, os, json

SRC = "/Users/priticolours/Desktop/DUMP/fp model/models/SIGMA_fp_ver4.stl"
OUT = "/Users/priticolours/Desktop/cmprssr-site/assets/models"
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_mesh.stl(filepath=SRC)
obj = bpy.data.objects[0]
me = obj.data

bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
bm.to_mesh(me)
bm.free()

bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = obj
bpy.ops.object.modifier_add(type="DECIMATE")
mod = obj.modifiers["Decimate"]
mod.decimate_type = "COLLAPSE"
mod.ratio = 42000 / len(obj.data.polygons)   # 42k tris: enough for a
bpy.ops.object.modifier_apply(modifier=mod.name) # 2k-point cloud to sample
bpy.ops.object.shade_smooth()
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")

me = obj.data
nv = len(me.vertices)
nt = len(me.polygons)
print("verts=%d tris=%d" % (nv, nt))

# ── centroid + bounds, so gl.js can normalise without guessing ────
xs = [v.co.x for v in me.vertices]
ys = [v.co.y for v in me.vertices]
zs = [v.co.z for v in me.vertices]
cx = (min(xs) + max(xs)) / 2.0
cy = (min(ys) + max(ys)) / 2.0
cz = (min(zs) + max(zs)) / 2.0
span = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
print("centroid=(%.3f,%.3f,%.3f) span=%.3f" % (cx, cy, cz, span))

# The scan is Z-up, and the published fp is 112.7 wide x 70.9 deep x
# 48.3 tall, so in the source the width lies along x, the depth along y,
# and the height along z. gl.js is Y-up and orbits on the +z side, so
# the target frame wants width on x, height on y, and the front facing
# the viewer on +z:
#
#   source  x = width   y = depth   z = height
#   target  x = width   y = height  z = front-toward-viewer
#
# Two checks, both of which caught a real bug:
#   1. after the mapping, x must hold the 1.0 span and y the 0.43 span
#      (width is the longest axis, height is the shortest);
#   2. the lens mount must end up on +z, not -z. The first attempt put
#      it at -z, which renders the camera facing away and shows the
#      viewer its back.
# tools/fp-poses.py renders the six candidate rotations and confirms the
# front is the one where the mount is visible.
def aim(x, y, z):
    return (x, z, -y)    # target x, y, z


buf = bytearray()
for v in me.vertices:
    px, py, pz = aim((v.co.x - cx) / span, (v.co.y - cy) / span, (v.co.z - cz) / span)
    buf += struct.pack("<fff", px, py, pz)

# smooth per-vertex normals, transformed by the same basis
me.calc_normals_split() if hasattr(me, "calc_normals_split") else None
for v in me.vertices:
    nx, ny, nz = aim(v.normal.x, v.normal.y, v.normal.z)
    buf += struct.pack("<fff", nx, ny, nz)

idx = []
for p in me.polygons:
    idx += [p.vertices[0], p.vertices[1], p.vertices[2]]
idx_buf = bytearray()
for i in idx:
    idx_buf += struct.pack("<I", i)

blob = path_out = os.path.join(OUT, "sigma-fp.bin")
with open(blob, "wb") as f:
    f.write(buf)
    f.write(idx_buf)

meta = {
    "vertices": nv,
    "triangles": nt,
    "posBytes": nv * 12,
    "posOffset": 0,
    "nrmOffset": nv * 12,
    "idxOffset": len(buf),
    "indexCount": len(idx),
    "note": "STL was Z-up, -x front; baked to Y-up with front still -x. "
            "Longest axis normalised to 1.0, centred on the bounding box."
}
with open(os.path.join(OUT, "sigma-fp.json"), "w") as f:
    json.dump(meta, f, indent=2)

print("wrote %s (%.1f KB) + json" % (blob, os.path.getsize(blob) / 1024.0))
