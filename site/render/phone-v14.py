# Rethink Phone product render (Blender 5.x, Cycles).
#   blender -b -P phone.py -- <mode> <outdir> [extra]
# modes:
#   preview          three angles at low samples, for checking the look
#   seq <n>          scroll turntable: front 3/4 -> profile -> back, n frames
#   flat             phone lying face-up, incoming-call screen
import bpy, bmesh, math, sys, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['preview', '/tmp']
MODE, OUT = argv[0], argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
SCREENS = os.path.join(HERE, 'out')

# ---------- dimensions (units = decimetres; a 165.7 x 76 x 8.7 mm phone) ----------
W, H, T = 0.76, 1.657, 0.087
GLASS = 0.0045
R = 0.098               # corner radius in plan
SW = W - 0.058          # screen width
SH = SW * 2340 / 1080   # screen height (texture aspect)
SR = 0.075              # screen corner radius

scene = bpy.context.scene
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)

# ---------- render setup ----------
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print('GPU setup failed, using CPU:', e)
scene.cycles.use_denoising = True
scene.cycles.denoising_input_passes = 'RGB'
scene.cycles.denoising_prefilter = 'NONE'
scene.cycles.use_adaptive_sampling = True
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0.0
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.cycles.max_bounces = 8
scene.cycles.glossy_bounces = 6
scene.cycles.transparent_max_bounces = 8

# ---------- materials ----------
def mat(name, color, metallic=0.0, rough=0.4, coat=0.0, coat_rough=0.03, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = coat_rough
    try: b.inputs['Specular IOR Level'].default_value = spec
    except KeyError: pass
    return m

def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

M_FRAME = mat('frame', srgb('#9a9ca1'), metallic=1.0, rough=0.28)          # bead-blasted aluminium
M_BACK = mat('back', srgb('#0b3020'), metallic=0.0, rough=0.42, coat=0.35, coat_rough=0.25)  # frosted green glass
M_FRONT = mat('front', srgb('#030303'), rough=0.02, coat=1.0, coat_rough=0.01)
M_LENS = mat('lens', srgb('#05070a'), rough=0.02, coat=1.0)
M_RING = mat('ring', srgb('#c9cbd0'), metallic=1.0, rough=0.18)
M_DOT = mat('dot', srgb('#d7d9dd'), metallic=1.0, rough=0.08)
M_BTN = mat('btn', srgb('#9a9ca1'), metallic=1.0, rough=0.3)

def screen_mat(path):
    m = bpy.data.materials.new('screen'); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    b.inputs['Roughness'].default_value = 0.02
    b.inputs['Coat Weight'].default_value = 1.0
    b.inputs['Coat Roughness'].default_value = 0.01
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(path)
    tex.interpolation = 'Cubic'
    nt.links.new(tex.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 1.0
    return m

# ---------- geometry ----------
def slab(name, w, h, t, r, seg=28, edge=0.0, edge_seg=6, material=None):
    """Rounded rectangle slab: X width, Z height, Y thickness."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, t, h), verts=bm.verts)
    corner = [e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co).normalized().y) > 0.99]
    bmesh.ops.bevel(bm, geom=corner, offset=r, segments=seg, affect='EDGES', profile=0.5)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    if edge > 0:
        mod = ob.modifiers.new('edge', 'BEVEL'); mod.width = edge; mod.segments = edge_seg
        mod.limit_method = 'ANGLE'; mod.angle_limit = math.radians(40); mod.harden_normals = False
    for p in me.polygons: p.use_smooth = True
    try:
        bpy.context.view_layer.objects.active = ob; ob.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
        ob.select_set(False)
    except Exception as e:
        print('smooth-by-angle unavailable:', e)
    if material: me.materials.append(material)
    return ob

def cyl(name, r, depth, loc, material, verts=96):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=(math.radians(90), 0, 0))
    ob = bpy.context.object; ob.name = name
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(material)
    return ob

rig = bpy.data.objects.new('rig', None); scene.collection.objects.link(rig)
parts = []

body_t = T - 2 * GLASS
parts.append(slab('frame', W, H, body_t, R, edge=0.012, material=M_FRAME))
front = slab('front', W - 0.010, H - 0.010, GLASS, R - 0.005, edge=0.0025, edge_seg=4, material=M_FRONT)
front.location.y = -(body_t / 2 + GLASS / 2) + 0.0005; parts.append(front)
back = slab('back', W - 0.010, H - 0.010, GLASS, R - 0.005, edge=0.0025, edge_seg=4, material=M_BACK)
back.location.y = (body_t / 2 + GLASS / 2) - 0.0005; parts.append(back)

def screen(path):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -(T / 2) - 0.0002, 0.01), rotation=(math.radians(90), 0, 0))
    sc = bpy.context.object; sc.name = 'screen'; sc.scale = (SW, SH, 1)
    sc.data.materials.append(screen_mat(path))
    return sc

# camera module (back, top-left when viewed from the back = +X in world since back faces +Y)
by = T / 2 + 0.006
for i, z in enumerate((0.60, 0.42)):
    parts.append(cyl(f'ring{i}', 0.072, 0.012, (0.19, by, z), M_RING))
    parts.append(cyl(f'lens{i}', 0.056, 0.014, (0.19, by + 0.001, z), M_LENS))
parts.append(cyl('flash', 0.018, 0.006, (0.05, T / 2 + 0.002, 0.60), mat('flash', srgb('#e9e4d4'), rough=0.3)))
# the Rethink dot: a single polished disc, the phone's only mark
# ---------- the eye: a lens-like status light, set into the back glass ----------
MARK_Z = 0.02
EY = T / 2                      # back surface
ER = 0.088                      # lens radius
def emission_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    return m, nt, nt.nodes.new('ShaderNodeOutputMaterial')

# lens: green light falling off from a bright core to black (radial ramp on object coords)
M_LENSE, nt, out = emission_mat('eye_lens')
tc = nt.nodes.new('ShaderNodeTexCoord'); grad = nt.nodes.new('ShaderNodeTexGradient'); grad.gradient_type = 'SPHERICAL'
mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.0, 1.0, 1.0)
ramp = nt.nodes.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
stops = [(0.00, '#0b3020'), (0.18, '#0d4a2c'), (0.40, '#10a052'), (0.68, '#3ce886'), (0.88, '#c6ffdf'), (1.00, '#ffffff')]
cr.elements[0].position, cr.elements[0].color = stops[0][0], (*srgb(stops[0][1]), 1)
cr.elements[1].position, cr.elements[1].color = stops[-1][0], (*srgb(stops[-1][1]), 1)
for pos, col in stops[1:-1]:
    e = cr.elements.new(pos); e.color = (*srgb(col), 1)
em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1.15
nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], grad.inputs['Vector'])
nt.links.new(grad.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], em.inputs['Color'])
lmix = nt.nodes.new('ShaderNodeMixShader'); ltr = nt.nodes.new('ShaderNodeBsdfTransparent')
lpw = nt.nodes.new('ShaderNodeMath'); lpw.operation = 'POWER'; lpw.inputs[1].default_value = 0.6
nt.links.new(grad.outputs['Fac'], lpw.inputs[0]); nt.links.new(lpw.outputs[0], lmix.inputs['Fac'])
nt.links.new(ltr.outputs[0], lmix.inputs[1]); nt.links.new(em.outputs[0], lmix.inputs[2])
nt.links.new(lmix.outputs[0], out.inputs['Surface']); M_LENSE.blend_method = 'BLEND'
bpy.ops.mesh.primitive_circle_add(vertices=128, radius=1.0, fill_type='NGON', location=(0, EY + 0.0045, MARK_Z), rotation=(math.radians(-90), 0, 0))
lens = bpy.context.object; lens.name = 'eye_lens'; lens.scale = (ER, ER, 1); lens.data.materials.append(M_LENSE)
lens.visible_shadow = False; parts.append(lens)

# dome: clear glass cover over the lens, catches the studio highlight
bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=1.0, location=(0, EY + 0.0040, MARK_Z))
dome = bpy.context.object; dome.name = 'eye_dome'; dome.scale = (ER + 0.004, 0.014, ER + 0.004)
bpy.ops.object.shade_smooth()
M_DOME = bpy.data.materials.new('dome'); M_DOME.use_nodes = True
db = M_DOME.node_tree.nodes['Principled BSDF']
db.inputs['Base Color'].default_value = (1, 1, 1, 1); db.inputs['Roughness'].default_value = 0.0
db.inputs['Transmission Weight'].default_value = 1.0; db.inputs['IOR'].default_value = 1.45
dome.data.materials.append(M_DOME); dome.visible_shadow = False; parts.append(dome)

# halo: light glowing through the frosted back glass, wide and soft
M_HALO, nt, out = emission_mat('halo'); M_HALO.blend_method = 'BLEND'
mix = nt.nodes.new('ShaderNodeMixShader'); tr = nt.nodes.new('ShaderNodeBsdfTransparent'); hem = nt.nodes.new('ShaderNodeEmission')
hem.inputs['Color'].default_value = (*srgb('#2bd36f'), 1); hem.inputs['Strength'].default_value = 2.0
tc = nt.nodes.new('ShaderNodeTexCoord'); grad = nt.nodes.new('ShaderNodeTexGradient'); grad.gradient_type = 'SPHERICAL'
pw = nt.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 2.6
sc = nt.nodes.new('ShaderNodeMath'); sc.operation = 'MULTIPLY'; sc.inputs[1].default_value = 0.8
nt.links.new(tc.outputs['Object'], grad.inputs['Vector']); nt.links.new(grad.outputs['Fac'], pw.inputs[0]); nt.links.new(pw.outputs[0], sc.inputs[0])
nt.links.new(sc.outputs[0], mix.inputs['Fac']); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(hem.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], out.inputs['Surface'])
bpy.ops.mesh.primitive_circle_add(vertices=128, radius=1.0, fill_type='NGON', location=(0, EY + 0.0004, MARK_Z), rotation=(math.radians(-90), 0, 0))
halo = bpy.context.object; halo.name = 'halo'; halo.scale = (0.34, 0.34, 1); halo.data.materials.append(M_HALO)
halo.visible_shadow = False; parts.append(halo)
# side buttons on the right edge (-X when viewed from the front faces... front is -Y, so viewer's right is +X)
for nm, z, ln in (('vol', 0.33, 0.20), ('pwr', 0.02, 0.10)):
    b = slab(nm, 0.012, ln, 0.026, 0.006, seg=8, material=M_BTN)
    b.rotation_euler = (0, 0, math.radians(90)); b.location = (W / 2 + 0.002, 0, z); parts.append(b)

for p in parts: p.parent = rig

# ---------- studio ----------
world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
wn = world.node_tree.nodes; wl = world.node_tree.links
env = wn.new('ShaderNodeTexEnvironment')
hdr = [p for p in [os.path.join(os.path.dirname(bpy.app.binary_path), '..', 'Resources', bpy.app.version_string[:3], 'datafiles', 'studiolights', 'world', 'studio.exr')] if os.path.exists(p)]
if not hdr:
    import glob
    hdr = glob.glob('/Applications/Blender.app/Contents/Resources/*/datafiles/studiolights/world/studio.exr')
env.image = bpy.data.images.load(hdr[0])
bg = wn['Background']; bg.inputs['Strength'].default_value = 0.32
wl.new(env.outputs['Color'], bg.inputs['Color'])
lp = wn.new('ShaderNodeLightPath'); mix = wn.new('ShaderNodeMixShader'); dark = wn.new('ShaderNodeBackground')
dark.inputs['Color'].default_value = (0.9, 0.9, 0.9, 1); dark.inputs['Strength'].default_value = 0.12
out = wn['World Output']
wl.new(lp.outputs['Is Glossy Ray'], mix.inputs['Fac'])
wl.new(dark.outputs['Background'], mix.inputs[1]); wl.new(bg.outputs['Background'], mix.inputs[2])
wl.new(mix.outputs['Shader'], out.inputs['Surface'])

def area(name, loc, size, energy, color=(1, 1, 1), shape='RECTANGLE', size_y=None, target=(0, 0, 0)):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy = energy; ld.color = color; ld.shape = shape
    ld.size = size; ld.size_y = size_y or size
    ob = bpy.data.objects.new(name, ld); scene.collection.objects.link(ob); ob.location = loc
    d = Vector(target) - Vector(loc); ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob

key = area('key', (-4.2, -0.6, 2.4), 2.6, 380)                      # side softbox, left: shapes the frame, stays out of the glass
area('top', (0.4, 1.4, 4.6), 3.0, 220)                        # overhead, slightly behind: soft gradient on the glass
rim = area('rim', (3.6, 1.6, 1.2), 0.45, 320, size_y=4.0)     # tall strip, back-right: edge highlight
rimL = area('rimL', (-3.8, 2.2, 1.2), 0.45, 200, size_y=4.0)  # second strip for the far edge
for l in (key, rim, rimL):
    l.data.use_shadow = False

# shadow catcher floor
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -H / 2 - 0.16))
floor = bpy.context.object; floor.name = 'floor'; floor.is_shadow_catcher = True

# camera
cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 105; cam_d.sensor_width = 36
cam = bpy.data.objects.new('cam', cam_d); scene.collection.objects.link(cam); scene.camera = cam

def aim(loc, target=(0, 0, 0)):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()

def pose(yaw_deg, tilt_deg=-4, roll_deg=0):
    rig.rotation_euler = (math.radians(tilt_deg), math.radians(roll_deg), math.radians(yaw_deg))

def render(path, res=(1000, 1250), samples=128):
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

os.makedirs(OUT, exist_ok=True)
ease = lambda t: 0.5 - 0.5 * math.cos(math.pi * t)

if MODE == 'dbg':
    sc = screen(os.path.join(SCREENS, 'screen-home.png')); sc.parent = rig
    aim((0, -7.2, 0.35)); pose(200)
    scene.render.use_border = True; scene.render.border_min_x, scene.render.border_max_x = 0.25, 0.75; scene.render.border_min_y, scene.render.border_max_y = 0.3, 0.62
    scene.render.use_crop_to_border = True
    render(os.path.join(OUT, 'dbg.png'), res=(1000, 1250), samples=96)
elif MODE == 'preview':
    sc = screen(os.path.join(SCREENS, 'screen-home.png')); sc.parent = rig
    aim((0, -7.2, 0.35))
    for nm, yaw in ((('c', 200),) if len(argv) > 2 and argv[2] == 'back' else (('a', -24), ('b', -90), ('c', 200))):
        pose(yaw); render(os.path.join(OUT, f'preview-{nm}.png'), res=(640, 800), samples=48)

elif MODE == 'seq':
    n = int(argv[2]) if len(argv) > 2 else 48
    sc = screen(os.path.join(SCREENS, 'screen-home.png')); sc.parent = rig
    aim((0, -7.2, 0.35))
    start = int(argv[4]) if len(argv) > 4 else 0
    for i in range(start, n):
        t = ease(i / (n - 1))
        pose(-24 + t * (200 + 24), tilt_deg=-4 + 2 * math.sin(math.pi * t))
        render(os.path.join(OUT, f'f{i:03d}.png'), samples=int(argv[3]) if len(argv) > 3 else 96)

elif MODE == 'flat':
    for o in scene.objects:
        if o.type == 'LIGHT': o.visible_glossy = False
    sc = screen(os.path.join(SCREENS, 'screen-ring.png')); sc.parent = rig
    # lie the phone face-up on the floor, turned slightly
    rig.rotation_euler = (math.radians(-90), 0, math.radians(-18))
    rig.location = (0, 0, -H / 2 - 0.16 + T / 2 + 0.001)
    aim((1.2, -4.4, 5.4), target=(0, 0, rig.location.z))
    cam_d.lens = 85
    render(os.path.join(OUT, 'flat.png'), res=(1600, 1200), samples=160)

elif MODE == 'meld':
    # apps melt into one green light. argv: meld <outdir> <frames> <samples> [t-list for preview]
    n = int(argv[2]); samples = int(argv[3])
    ts = [float(x) for x in argv[4].split(',')] if len(argv) > 4 else [i / (n - 1) for i in range(n)]
    smooth = lambda e0, e1, x: (lambda k: k * k * (3 - 2 * k))(min(1, max(0, (x - e0) / (e1 - e0))))

    # screen: busy wallpaper fading to black with t
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -(T / 2) - 0.0002, 0.01), rotation=(math.radians(90), 0, 0))
    scr = bpy.context.object; scr.scale = (SW, SH, 1); scr.parent = rig
    sm = bpy.data.materials.new('meldscreen'); sm.use_nodes = True; snt = sm.node_tree; sb = snt.nodes['Principled BSDF']
    sb.inputs['Base Color'].default_value = (0, 0, 0, 1); sb.inputs['Roughness'].default_value = 0.02
    sb.inputs['Coat Weight'].default_value = 1.0; sb.inputs['Coat Roughness'].default_value = 0.01
    stex = snt.nodes.new('ShaderNodeTexImage'); stex.image = bpy.data.images.load(os.path.join(SCREENS, 'wall-busy.png'))
    sk = snt.nodes.new('ShaderNodeValue'); smix = snt.nodes.new('ShaderNodeMix'); smix.data_type = 'RGBA'
    smix.inputs['B'].default_value = (0.0, 0.0, 0.0, 1)
    snt.links.new(sk.outputs[0], smix.inputs['Factor']); snt.links.new(stex.outputs['Color'], smix.inputs['A'])
    snt.links.new(smix.outputs['Result'], sb.inputs['Emission Color']); sb.inputs['Emission Strength'].default_value = 0.9
    scr.data.materials.append(sm)

    # metaball icons on the glass
    mb = bpy.data.metaballs.new('apps'); mb.resolution = 0.02; mb.render_resolution = 0.0035; mb.threshold = 0.6
    mbo = bpy.data.objects.new('apps', mb); scene.collection.objects.link(mbo); mbo.parent = rig
    mbo.location = (0, -(T / 2) - 0.004, 0.01); mbo.rotation_euler = (math.radians(90), 0, 0)
    icons = []
    for r in range(6):
        for c in range(4):
            icons.append(((c - 1.5) * 0.165, 0.50 - r * 0.175))
    for c in range(4):
        icons.append(((c - 1.5) * 0.165, -0.60))
    els = []
    for (x, y) in icons:
        e = mb.elements.new(type='CUBE'); e.co = (x, y, 0); e.radius = 0.052; e.stiffness = 4.0
        e.size_x = e.size_y = 0.022; e.size_z = 0.004; els.append(e)

    # material: app colours by angle around the centre, turning green near the centre and as t rises
    am = bpy.data.materials.new('apps'); am.use_nodes = True; ant = am.node_tree; ab = ant.nodes['Principled BSDF']
    ab.inputs['Roughness'].default_value = 0.12; ab.inputs['Coat Weight'].default_value = 1.0; ab.inputs['Coat Roughness'].default_value = 0.02
    tc = ant.nodes.new('ShaderNodeTexCoord')
    rad = ant.nodes.new('ShaderNodeTexGradient'); rad.gradient_type = 'RADIAL'
    hue = ant.nodes.new('ShaderNodeValToRGB'); hr = hue.color_ramp
    cols = ['#ff9f0a', '#0a84ff', '#ff375f', '#64d2ff', '#ffd60a', '#bf5af2', '#30d158', '#ff6b3d', '#5e5ce6', '#ff453a', '#32ade6', '#ffcc00', '#af52de', '#34c759']
    hr.elements[0].position, hr.elements[0].color = 0.0, (*srgb(cols[0]), 1)
    hr.elements[1].position, hr.elements[1].color = 1.0, (*srgb(cols[0]), 1)
    for i, cc in enumerate(cols[1:], 1):
        e = hr.elements.new(i / len(cols)); e.color = (*srgb(cc), 1)
    hr.interpolation = 'CONSTANT'
    sph = ant.nodes.new('ShaderNodeTexGradient'); sph.gradient_type = 'SPHERICAL'
    mp = ant.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (4.5, 4.5, 4.5)
    near = ant.nodes.new('ShaderNodeMath'); near.operation = 'POWER'; near.inputs[1].default_value = 0.5
    gk = ant.nodes.new('ShaderNodeValue')
    mx = ant.nodes.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'
    mix = ant.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.inputs['B'].default_value = (*srgb('#2fe07a'), 1)
    cmap = ant.nodes.new('ShaderNodeMapping'); cmap.inputs['Scale'].default_value = (6.06, 5.714, 1.0); cmap.inputs['Location'].default_value = (0.0, 0.643, 0.5)
    sep = ant.nodes.new('ShaderNodeSeparateXYZ')
    fx = ant.nodes.new('ShaderNodeMath'); fx.operation = 'FLOOR'; fy = ant.nodes.new('ShaderNodeMath'); fy.operation = 'FLOOR'
    mx1 = ant.nodes.new('ShaderNodeMath'); mx1.operation = 'MULTIPLY'; mx1.inputs[1].default_value = 0.37
    my1 = ant.nodes.new('ShaderNodeMath'); my1.operation = 'MULTIPLY'; my1.inputs[1].default_value = 0.611
    add = ant.nodes.new('ShaderNodeMath'); add.operation = 'ADD'; frc = ant.nodes.new('ShaderNodeMath'); frc.operation = 'FRACT'
    ant.links.new(tc.outputs['Object'], cmap.inputs['Vector']); ant.links.new(cmap.outputs['Vector'], sep.inputs['Vector'])
    ant.links.new(sep.outputs['X'], fx.inputs[0]); ant.links.new(sep.outputs['Y'], fy.inputs[0])
    ant.links.new(fx.outputs[0], mx1.inputs[0]); ant.links.new(fy.outputs[0], my1.inputs[0])
    ant.links.new(mx1.outputs[0], add.inputs[0]); ant.links.new(my1.outputs[0], add.inputs[1]); ant.links.new(add.outputs[0], frc.inputs[0])
    ant.links.new(frc.outputs[0], hue.inputs['Fac'])
    ant.links.new(tc.outputs['Object'], mp.inputs['Vector']); ant.links.new(mp.outputs['Vector'], sph.inputs['Vector'])
    ant.links.new(sph.outputs['Fac'], near.inputs[0]); ant.links.new(near.outputs[0], mx.inputs[0]); ant.links.new(gk.outputs[0], mx.inputs[1])
    ant.links.new(mx.outputs[0], mix.inputs['Factor']); ant.links.new(hue.outputs['Color'], mix.inputs['A'])
    ant.links.new(mix.outputs['Result'], ab.inputs['Base Color']); ant.links.new(mix.outputs['Result'], ab.inputs['Emission Color'])
    ek = ant.nodes.new('ShaderNodeValue'); ant.links.new(ek.outputs[0], ab.inputs['Emission Strength'])
    mb.materials.append(am)

    # glow on the glass around the final light
    hm = bpy.data.materials['halo'].copy()
    hstr = [nd for nd in hm.node_tree.nodes if nd.type == 'EMISSION'][0]
    bpy.ops.mesh.primitive_circle_add(vertices=128, radius=1.0, fill_type='NGON', location=(0, -(T / 2) - 0.001, 0.01), rotation=(math.radians(90), 0, 0))
    gl = bpy.context.object; gl.scale = (0.36, 0.36, 1); gl.data.materials.append(hm); gl.visible_shadow = False; gl.parent = rig

    aim((0, -7.2, 0.35)); pose(-14, tilt_deg=-3)
    hmul = [nd for nd in hm.node_tree.nodes if nd.type == 'MATH' and nd.operation == 'MULTIPLY'][0]
    for fi, t in enumerate(ts):
        for (x, y), e in zip(icons, els):
            dist = math.hypot(x, y)
            ti = smooth(0.05 + dist * 0.28, 0.62 + dist * 0.28, t)          # inner icons start first
            ang = math.atan2(y, x) + ti * 1.1                                # spiral in
            rr = dist * (1 - ti)
            e.co = (rr * math.cos(ang), rr * math.sin(ang), 0.006 * ti)
            k = 1 - 0.40 * ti
            e.radius = 0.052 * k; e.size_x = e.size_y = 0.022 * k * (1 - 0.8 * ti); e.size_z = 0.004 + 0.01 * ti
        mbo.scale = (1, 1, 0.32 + 0.68 * smooth(0.72, 1.0, t))
        sk.outputs[0].default_value = smooth(0.15, 0.75, t)
        gk.outputs[0].default_value = smooth(0.45, 0.85, t)
        ek.outputs[0].default_value = 0.05 + 3.0 * smooth(0.6, 1.0, t)
        hmul.inputs[1].default_value = 0.85 * smooth(0.7, 1.0, t); gl.hide_render = t < 0.7
        render(os.path.join(OUT, f'm{fi:03d}.png'), res=(900, 1200), samples=samples)
