import json, math
from PIL import Image, ImageDraw, ImageFont

frames = json.load(open('kaiju-mesh.json', 'r', encoding='utf-8'))
try:
    FONT = ImageFont.truetype('C:\\Windows\\Fonts\\msyh.ttc', 15)
except Exception:
    FONT = None

W, H = 520, 430

def render(tris, eye, target, scale):
    px = [e - t for e, t in zip(eye, target)]
    n = math.sqrt(sum(c*c for c in px)); f = tuple(c/n for c in px)
    up = (0.0, 1.0, 0.0)
    r = (f[1]*up[2]-f[2]*up[1], f[2]*up[0]-f[0]*up[2], f[0]*up[1]-f[1]*up[0])
    rn = math.sqrt(sum(c*c for c in r)) or 1.0; r = tuple(c/rn for c in r)
    u = (r[1]*f[2]-r[2]*f[1], r[2]*f[0]-r[0]*f[2], r[0]*f[1]-r[1]*f[0])
    L = (0.55, 0.85, 0.35); ln = math.sqrt(sum(c*c for c in L)); L = tuple(c/ln for c in L)

    polys = []
    for tri in tris:
        if tri.get('rim'):      # 轮廓光副本不画，避免糊成一团
            continue
        a, b, c = tri['t']; nn = list(tri['n'])
        if sum(nn[i]*(-f[i]) for i in range(3)) < 0: nn = [-x for x in nn]
        depth = sum(sum((v[i]-eye[i])*f[i] for i in range(3)) for v in (a, b, c)) / 3
        pts = []
        for v in (a, b, c):
            sx = sum((v[i]-eye[i])*r[i] for i in range(3)) * scale
            sy = -sum((v[i]-eye[i])*u[i] for i in range(3)) * scale
            pts.append((W/2 + sx, H/2 + sy))
        lum = max(0.0, sum(nn[i]*L[i] for i in range(3)))
        polys.append((depth, pts, lum, tri['c']))
    polys.sort(key=lambda p: -p[0])
    img = Image.new('RGB', (W, H), (10, 13, 20))
    d = ImageDraw.Draw(img)
    for depth, pts, lum, col in polys:
        k = 0.45 + 0.65 * lum
        fill = tuple(min(255, int(c * k)) for c in col)
        d.polygon(pts, fill=fill, outline=(20, 24, 32))
    return img

# 材质 base 色很暗（贴图是程序化的，这里用材质默认白），所以手动给每类零件上色
views = [
    ('侧面轮廓（看清长尾与背板）', (-7.5, 2.8, -0.6), (0, 2.4, -0.6), 55),
    ('侧前方 3/4 视角', (4.6, 2.8, 4.6), (0, 2.4, -0.6), 50),
    ('第一人称（玩家视角）', (0.0, 1.65, 3.4), (0, 2.4, -0.6), 48),
]
panels = []
for name, eye, target, sc in views:
    a = render(frames[0], eye, target, sc)
    b = render(frames[1], eye, target, sc)
    p = Image.new('RGB', (W*2 + 12, H), (6, 8, 12))
    p.paste(a, (0, 0)); p.paste(b, (W + 12, 0))
    panels.append((name, p))

out = Image.new('RGB', (max(p.width for _, p in panels), sum(p.height + 24 for _, p in panels)), (5, 7, 11))
d = ImageDraw.Draw(out)
y = 0
for name, p in panels:
    d.text((4, y + 3), name + '   | 左：常态   右：撕咬/吐息张口', fill=(225, 235, 250), font=FONT)
    out.paste(p, (0, y + 20))
    y += p.height + 24
out.save('preview-kaiju.png')
print('saved', out.size)
