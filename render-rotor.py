import json, math
from PIL import Image, ImageDraw, ImageFont

try:
    FONT = ImageFont.truetype('C:\\Windows\\Fonts\\msyh.ttc', 15)
except Exception:
    FONT = None

frames = json.load(open('gatling-mesh.json', 'r', encoding='utf-8'))

W, H, GAP = 430, 470, 24

def render(tris, eye, target, scale, flat=False):
    px = [e - t for e, t in zip(eye, target)]
    n = math.sqrt(sum(c*c for c in px)); f = tuple(c/n for c in px)
    up = (0.0, 1.0, 0.0)
    r = (f[1]*up[2]-f[2]*up[1], f[2]*up[0]-f[0]*up[2], f[0]*up[1]-f[1]*up[0])
    rn = math.sqrt(sum(c*c for c in r)) or 1.0; r = tuple(c/rn for c in r)
    u = (r[1]*f[2]-r[2]*f[1], r[2]*f[0]-r[0]*f[2], r[0]*f[1]-r[1]*f[0])
    L = (0.6, 0.9, 0.35); ln = math.sqrt(sum(c*c for c in L)); L = tuple(c/ln for c in L)

    polys = []
    for tri in tris:
        a, b, c = tri['t']; nn = list(tri['n'])
        if sum(nn[i]*(-f[i]) for i in range(3)) < 0: nn = [-x for x in nn]
        depth = sum(sum((v[i]-eye[i])*f[i] for i in range(3)) for v in (a,b,c))/3
        pts = []
        for v in (a,b,c):
            sx = sum((v[i]-eye[i])*r[i] for i in range(3))*scale
            sy = -sum((v[i]-eye[i])*u[i] for i in range(3))*scale
            pts.append((W/2+sx, H/2+sy))
        lum = max(0.0, sum(nn[i]*L[i] for i in range(3)))
        polys.append((depth, pts, lum, tri['r']))
    polys.sort(key=lambda p: -p[0])
    img = Image.new('RGB', (W, H), (10, 14, 20))
    d = ImageDraw.Draw(img)
    for depth, pts, lum, is_rotor in polys:
        if flat:
            col = (255, 110, 40) if is_rotor else (150, 162, 178)
        else:
            base = (250, 122, 46) if is_rotor else (140, 152, 168)
            k = 0.45 + 0.55*lum
            col = tuple(min(255, int(c*k)) for c in base)
        edge = (255, 255, 255) if is_rotor else (40, 46, 56)
        d.polygon(pts, fill=col, outline=edge)
    return img

views = {
    '侧前上方（看清两脚支架与散热笼）': ((-1.25, 0.85, -1.35), (0.0, -0.02, -0.45), 330),
    '第一人称（沿枪管轴线看枪口）':   ((0.26, -0.20, 0.55), (0.0, 0.03, -0.90), 250),
}
panels = []
for name, (eye, target, sc) in views.items():
    a = render(frames[0], eye, target, sc, flat=True)
    b = render(frames[1], eye, target, sc, flat=True)
    p = Image.new('RGB', (W*2+10, H), (6, 8, 12))
    p.paste(a, (0, 0)); p.paste(b, (W+10, 0))
    panels.append((name, p))

out = Image.new('RGB', (max(p.width for _, p in panels), sum(p.height + 26 for _, p in panels)), (5, 7, 11))
d = ImageDraw.Draw(out)
y = 0
for name, p in panels:
    d.text((4, y+3), name + '   | 左：转子 0°   右：转子转 90°   橙色=随枪管转，灰色=静止', fill=(225, 235, 250), font=FONT)
    out.paste(p, (0, y+22))
    y += p.height + 26
out.save('gatling-rotor-check.png')
print('saved', out.size)
