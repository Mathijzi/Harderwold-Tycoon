"""Hartlijnen van de wegen (Zhang-Suen-verdunning van het wegmasker) en een ruwe graaf: knooppunten en wegstukken.
Gebruik: python3 tools/harderwold/skeleton.py   (na segment.py). Schrijft work/skeleton.json en work/skeleton_vis.png.
De graaf is HULPMATERIAAL voor het handmatig vastgelegde wegennet (tools/harderwold/spec.py), geen eindproduct."""
import json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

S = 2  # werk op halve resolutie
seg = np.load('work/seg.npz')
road = seg['road'] | seg['paved']
road = road[::S, ::S]
road = ndi.binary_closing(road, iterations=2)
road = ndi.binary_fill_holes(road) & road | ndi.binary_closing(road, iterations=1)
lab, n = ndi.label(road)
sizes = ndi.sum(road, lab, range(1, n + 1))
road = np.isin(lab, np.nonzero(sizes > 400)[0] + 1)

def thin(img):
    img = img.copy().astype(np.uint8)
    while True:
        changed = False
        for step in (0, 1):
            P = np.pad(img, 1)
            p2, p3, p4, p5 = P[:-2, 1:-1], P[:-2, 2:], P[1:-1, 2:], P[2:, 2:]
            p6, p7, p8, p9 = P[2:, 1:-1], P[2:, :-2], P[1:-1, :-2], P[:-2, :-2]
            nb = [p2, p3, p4, p5, p6, p7, p8, p9]
            B = sum(x.astype(np.int32) for x in nb)
            A = sum(((nb[i] == 0) & (nb[(i + 1) % 8] == 1)).astype(np.int32) for i in range(8))
            if step == 0: c = (p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0)
            else: c = (p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0)
            m = (img == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if m.any(): img[m] = 0; changed = True
        if not changed: return img.astype(bool)

sk = thin(road)
np.savez_compressed("work/skeleton_mask.npz", sk=sk, scale=S)
# graaf
ys, xs = np.nonzero(sk)
pix = set(zip(ys.tolist(), xs.tolist()))
nbrs = lambda p: [(p[0] + dy, p[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (p[0] + dy, p[1] + dx) in pix]
deg = {p: len(nbrs(p)) for p in pix}
special = {p for p, d in deg.items() if d != 2}
# knooppunten: clusters van speciale pixels
nodes = []
nid = {}
for p in special:
    if p in nid: continue
    stack = [p]; cl = []
    nid[p] = len(nodes)
    while stack:
        q = stack.pop(); cl.append(q)
        for r in nbrs(q):
            if r in special and r not in nid: nid[r] = len(nodes); stack.append(r)
    cy = sum(c[0] for c in cl) / len(cl); cx = sum(c[1] for c in cl) / len(cl)
    nodes.append({'id': len(nodes), 'pt': [round(cx * S, 1), round(cy * S, 1)], 'deg': max(deg[c] for c in cl), 'size': len(cl)})
edges = []
seen = set()
for p in special:
    for q in nbrs(p):
        if q in special or (p, q) in seen: continue
        path = [p, q]; prev, cur = p, q
        while cur not in special:
            nx = [r for r in nbrs(cur) if r != prev and r not in path[-3:]]
            if not nx: break
            prev, cur = cur, nx[0]; path.append(cur)
        seen.add((p, q)); seen.add((path[-1], path[-2]) if len(path) > 1 else (p, q))
        if cur not in special: continue
        a, b = nid[p], nid[cur]
        pts = [[c[1] * S, c[0] * S] for c in path]
        key = (min(a, b), max(a, b), len(pts))
        if key in seen: continue
        seen.add(key)
        edges.append({'a': a, 'b': b, 'len': len(pts) * S, 'pts': pts[::6] + [pts[-1]]})
json.dump({'nodes': nodes, 'edges': edges}, open('work/skeleton.json', 'w'))
print('knopen', len(nodes), 'wegstukken', len(edges))
im = Image.open('work/plan_full.png').convert('RGB').point(lambda v: 128 + v // 2)
d = ImageDraw.Draw(im)
for e in edges:
    if e['len'] < 20: continue
    d.line([tuple(p) for p in e['pts']], fill=(220, 0, 0), width=5)
for nd in nodes:
    x, y = nd['pt']; d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=(0, 0, 200) if nd['deg'] > 2 else (0, 160, 0))
    d.text((x + 10, y - 10), str(nd['id']), fill=(0, 0, 0))
im.resize((im.width // 2, im.height // 2)).save('work/skeleton_vis.png')
