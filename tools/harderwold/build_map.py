"""Bouwt de Harderwold-kaart (data/map/park.json, park_road_network.json, harderwold_manifest.json) uit de
rasterplattegrond. Coordinaten: pixels van het volle raster (4961 x 3508 px) = "punten" (pt) van de kaart.

Volgorde:  python3 tools/harderwold/extract_plan.py   (raster uit de PDF -> work/plan_full.png)
           python3 tools/harderwold/segment.py        (kleurmaskers)
           python3 tools/harderwold/skeleton.py       (hartlijnen van de wegen)
           python3 tools/harderwold/labels.py         (kavelnummers)
           python3 tools/harderwold/build_map.py      (dit script)

Alles wat hier met de hand staat (knooppunten, wegindeling, slagbomen, voorzieningen, gebouwen) is een BEWERKBARE
AANNAME; zie docs/REFERENTIES_EN_AANNAMES.md. Daarna kan alles verder worden bijgesteld in de kaarteditor (/editor)."""
import heapq, json, math
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import contourpy

K = 0.24                       # meter per pt (zie docs: wegbreedte 25 pt = 6 m, kavelfront 85 pt = 20 m)
# Camera: the projector derives its tilt from the aspect ratio of the view (SE = 2160 / (viewH * 3840 / viewW)).
# TILT = sin(elevation): 0.67 = about 42 degrees, the same look as Aelderholt (opdrachtgever 15-10-2026: "meer zoals
# Aelderholt, zonder grote bosrand, ingezoomd op het park"). The view is cropped to the park itself: from the west edge
# of the golf course to the east edge of the villas, from the north edge to the service road along the south.
TILT = 0.67
_x0, _x1, _yc = 1000, 4800, 1725
_vh = (_x1 - _x0) * 2160 / (3840 * TILT)
VIEW = [_x0, round(_yc - _vh / 2), _x1, round(_yc + _vh / 2)]
seg = np.load('work/seg.npz')
SK = np.load('work/skeleton_mask.npz')
SKM, SKS = SK['sk'], int(SK['scale'])
H, W = seg['water'].shape

# ------------------------------------------------------------------ geometry helpers
def area(r):
    return 0.5 * sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))

def dp(pts, tol):
    """Douglas-Peucker for an open polyline"""
    if len(pts) < 3: return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a; L = np.hypot(*ab)
    P = np.array(pts)
    d = np.abs(np.cross(ab, P - a)) / L if L > 1e-9 else np.hypot(*(P - a).T)
    i = int(np.argmax(d))
    if d[i] <= tol: return [pts[0], pts[-1]]
    return dp(pts[:i + 1], tol)[:-1] + dp(pts[i:], tol)

def dp_ring(r, tol):
    if len(r) < 6: return r
    i = max(range(len(r)), key=lambda j: (r[j][0] - r[0][0]) ** 2 + (r[j][1] - r[0][1]) ** 2)
    out = dp(r[:i + 1], tol)[:-1] + dp(r[i:] + [r[0]], tol)[:-1]
    return out if len(out) >= 3 else r

def pip(p, r):
    x, y = p; c = False
    for i in range(len(r)):
        x1, y1 = r[i]; x2, y2 = r[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

def bridge(outer, holes):
    """Merge holes into the outer ring with zero-width slits, so every area is ONE simple polygon (no holes):
    canvas fill and point-in-polygon tests then treat islands correctly."""
    ring = outer[:]
    for h in sorted(holes, key=lambda h: min(p[0] for p in h)):
        j = min(range(len(h)), key=lambda k: h[k][0])
        hp = h[j]
        i = min(range(len(ring)), key=lambda k: (ring[k][0] - hp[0]) ** 2 + (ring[k][1] - hp[1]) ** 2)
        hr = h[j:] + h[:j] + [h[j]]
        ring = ring[:i + 1] + hr + [ring[i]] + ring[i + 1:]
    return ring

def polygons(mask, step=4, min_area=0, tol=3.0, keep=None):
    """Mask -> list of simple polygons (pt coordinates); holes are bridged into their outer ring."""
    h, w = mask.shape
    hh, ww = h // step, w // step
    m = mask[:hh * step, :ww * step].reshape(hh, step, ww, step).mean((1, 3))
    m = ndi.gaussian_filter(m, 0.6)
    m = np.pad(m, 1)
    gen = contourpy.contour_generator(z=m, line_type='Separate')
    rings = []
    for ln in gen.lines(0.5):
        r = [[(x - 1) * step + step / 2, (y - 1) * step + step / 2] for x, y in ln]
        if len(r) > 3 and r[0] == r[-1]: r = r[:-1]
        if len(r) < 3: continue
        rings.append(dp_ring(r, tol))
    outers = [r for r in rings if area(r) > 0]
    holes = [r for r in rings if area(r) < 0]
    if len(outers) < len(holes):  # orientation convention of contourpy: flip
        outers, holes = [r[::-1] for r in holes], [r[::-1] for r in outers]
    out = []
    for o in outers:
        if abs(area(o)) < min_area: continue
        if keep and not keep(o): continue
        mine = [hh_ for hh_ in holes if abs(area(hh_)) > max(400, min_area * 0.2) and pip(hh_[0], o)]
        out.append([[round(x, 1), round(y, 1)] for x, y in bridge(o, [h_[::-1] if area(h_) > 0 else h_ for h_ in mine])])
    return out

def in_view(r, margin=0):
    xs = [p[0] for p in r]; ys = [p[1] for p in r]
    return max(xs) > VIEW[0] - margin and min(xs) < VIEW[2] + margin and max(ys) > VIEW[1] - margin and min(ys) < VIEW[3] + margin

def not_legend(r):
    xs = [p[0] for p in r]; ys = [p[1] for p in r]
    return not (max(xs) < 820 and min(ys) > 800)

def not_icon(r):
    """legend/map icons are blue rounded squares (1, 2, 3, i, P ...): not water"""
    xs = [p[0] for p in r]; ys = [p[1] for p in r]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    return not (w < 100 and h < 100 and 0.7 < w / max(1, h) < 1.4 and abs(area(r)) > 0.6 * w * h)

# ------------------------------------------------------------------ terrain from the colour masks
img = np.asarray(Image.open('work/plan_full.png').convert('RGB')).astype(np.int16)
R, G, B = img[..., 0], img[..., 1], img[..., 2]
golf_zone = np.zeros((H, W), bool); golf_zone[1150:3200, 380:2330] = True
water = polygons(seg['water'], 4, 900, 3.0, keep=lambda r: in_view(r) and not_legend(r) and not_icon(r))
paved = ndi.binary_closing(ndi.binary_opening(seg['paved'], iterations=1), iterations=2) & ~ndi.binary_dilation(seg['road'], iterations=3)
# split by width: thin strips (golf paths, footpaths) vs wide paved areas (yards, overflow parking)
plab, pn = ndi.label(paved)
wide_ids = set()
dt = ndi.distance_transform_edt(paved)
for i, sl in enumerate(ndi.find_objects(plab), start=1):
    if dt[sl][plab[sl] == i].max() > 16: wide_ids.add(i)
wide = np.isin(plab, list(wide_ids))
# a wide component may still carry thin paths: only its thick core (opened) is a paved area, the rest stays a path
wide_core = ndi.binary_dilation(ndi.binary_erosion(wide, iterations=12), iterations=12) & wide
thin = paved & ~wide_core
footpaths = polygons(thin, 3, 250, 2.0, keep=lambda r: in_view(r) and not_legend(r))
big_paved = polygons(wide_core, 4, 4000, 4.0, keep=lambda r: in_view(r) and not_legend(r))
near = lambda c: (np.abs(R - c[0]) < 9) & (np.abs(G - c[1]) < 9) & (np.abs(B - c[2]) < 9)
fair = ndi.binary_opening(near((132, 156, 90)) & golf_zone, iterations=3)
fair = ndi.binary_closing(fair, iterations=4)
green = ndi.binary_opening(near((162, 174, 114)) & golf_zone, iterations=2)
bunker = (R > 225) & (G > 195) & (G < 232) & (B > 160) & (B < 210) & (R - B > 28) & golf_zone
bunker = ndi.binary_opening(bunker, iterations=1)
golf = {
    'fairways': polygons(fair, 4, 3000, 4.0, keep=in_view),
    'greens': polygons(green, 3, 300, 2.0, keep=in_view),
    'bunkers': polygons(bunker, 2, 120, 1.5, keep=in_view),
}
forest_m = ndi.binary_closing(seg['forest'], iterations=6)
forest_m = ndi.binary_opening(forest_m, iterations=6)
forest = polygons(forest_m, 8, 25000, 10.0, keep=lambda r: in_view(r) and not_legend(r))
# outside the park (white on the plan, incl. the legend) is forest in the game
outside = ndi.binary_opening(ndi.binary_closing(seg['white'], iterations=10), iterations=10)
forest += polygons(outside, 8, 60000, 10.0, keep=in_view)
# beyond the plan (above and below the raster, inside the camera view): forest
forest += [[[VIEW[0] - 60, VIEW[1] - 60], [VIEW[2] + 60, VIEW[1] - 60], [VIEW[2] + 60, 6], [VIEW[0] - 60, 6]],
           [[VIEW[0] - 60, H - 6], [VIEW[2] + 60, H - 6], [VIEW[2] + 60, VIEW[3] + 60], [VIEW[0] - 60, VIEW[3] + 60]]]
print('water', len(water), 'paden', len(footpaths), 'verhard', len(big_paved), 'fairways', len(golf['fairways']), 'greens', len(golf['greens']), 'bunkers', len(golf['bunkers']), 'bos', len(forest))

# individual trees (round dark crowns: rows along the streets, trees on the golf course) and small clumps:
# every forest-coloured blob that is not part of a large forest area becomes one or more single trees
tm = ndi.binary_opening(seg['forest'], iterations=1)
lab, n = ndi.label(tm)
objs = ndi.find_objects(lab)
sizes = ndi.sum(tm, lab, range(1, n + 1))
trees = []
rng = np.random.default_rng(7)
for i, sl in enumerate(objs, start=1):
    a_ = sizes[i - 1]
    if a_ < 250 or a_ > 30000: continue
    ys, xs = np.nonzero(lab[sl] == i)
    ys = ys + sl[0].start; xs = xs + sl[1].start
    cx, cy = xs.mean(), ys.mean()
    if not (VIEW[0] <= cx <= VIEW[2]) or (cx < 820 and cy > 800): continue
    if forest_m[int(cy), int(cx)] and a_ > 6000: continue  # inside a forest area: the forest fill places trees there
    k = max(1, int(round(a_ / 1800)))
    if k == 1:
        trees.append([round(cx, 1), round(cy, 1), round(min(6.0, math.sqrt(a_ / math.pi) * K), 1)])
    else:
        pick = rng.choice(len(xs), size=k, replace=False)
        for j in pick: trees.append([float(xs[j]), float(ys[j]), 3.5])
print('losse bomen', len(trees))

# ------------------------------------------------------------------ road network (hand-made topology, shapes from the skeleton)
sk_y, sk_x = np.nonzero(SKM)
sk_pts = np.stack([sk_x * SKS, sk_y * SKS], 1).astype(float)

def snap(p, r=34):
    d = np.hypot(sk_pts[:, 0] - p[0], sk_pts[:, 1] - p[1])
    i = int(np.argmin(d))
    return [float(sk_pts[i, 0]), float(sk_pts[i, 1])] if d[i] < r else list(p)

N = {}  # id -> dict
def node(id_, pt, kind='junction', snap_it=True, **kw):
    N[id_] = dict(pt=[round(v, 1) for v in (snap(pt) if snap_it else pt)], kind=kind, **kw)

# entrance, gate point and the hart
node('P_IN', (2224, 3500), 'portal', False, portal='public', label='Ingang Harderwold')
node('J_ZUID', (2226, 3213), radius=6, note='ingangsweg x weg langs de zuidrand (dienstweg)')
node('J_GATE', (2410, 1792), radius=7.5, note='slagboompunt bij het hart (rode stippellijn in de PDF)')
node('P_WERF', (1436, 3150), 'portal', False, portal='service', label='De werf (dienstingang)')
node('C_CAMP', (1195, 1192), 'deadend', turnRadiusM=6)
# villa ring road (forest edge north, north and east perimeter, down to the loods)
node('J_B1', (2444, 1417), radius=6); node('J_B2', (2655, 1040), radius=6)
node('J_E1', (4725, 652), radius=6); node('J_E2', (4725, 985), radius=6); node('J_E3', (4723, 1267), radius=6)
node('J_E5', (4592, 1550), radius=6); node('J_LOODS', (4552, 2900), radius=6, snap_it=False)
node('J_LZ', (4576, 3128), radius=5, note='aansluiting dienstweg zuid')
# main villa road and the southern grid
node('J_M1', (2802, 1795), radius=6); node('J_M3', (3540, 1795), radius=6.5)
node('J_C1', (2802, 2088), radius=5.5); node('J_C2', (2802, 2438), radius=5.5)
node('J_W1', (3540, 2338), radius=5.5); node('J_P2', (4118, 2338), radius=6)
# dead ends (turning circles, kept back from the canal)
for id_, p in {'C_500': (3500, 1290), 'C_526': (3290, 1054), 'C_570': (3700, 985), 'C_360': (3905, 1255), 'C_390': (4078, 1478),
               'C_426': (4305, 1655), 'C_250': (3330, 2088), 'C_240': (3330, 2438), 'C_217': (3330, 2790), 'C_340': (4220, 2790),
               'C_330': (4220, 2338)}.items():
    node(id_, p, 'deadend', True, turnRadiusM=5.5)
node('C_TD', (4705, 2938), 'deadend', False, turnRadiusM=4.5, note='trailerstalling / golfkarren TD (aanname)')
node('C_LOODS', (4560, 2975), 'deadend', False, turnRadiusM=5.5, note='keerlus aan het eind van de Oostlaan, bij De loods (aanname)')

ROADS = []
def road(id_, name, a, b, cls='park', via=(), speed=15, prio=1, off=1.45, follow=True, **kw):
    ROADS.append(dict(id=id_, name=name, frm=a, to=b, cls=cls, via=list(via), speed=speed, prio=prio, off=off, follow=follow, kw=kw))

road('toegangsweg-zuid', 'Ingangsweg (openbaar)', 'P_IN', 'J_ZUID', 'public', [(2224, 3400)], speed=30, prio=2, off=1.7, markings='centre-dashed')
road('toegangsweg', 'Ingangsweg naar het slagboompunt', 'J_ZUID', 'J_GATE', 'arrival', [(2300, 2950), (2370, 2650), (2400, 2400), (2414, 2100), (2414, 1950)], speed=30, prio=2, off=1.7, markings='centre-dashed')
road('hartweg', 'Weg naar het hart en de camperplaatsen', 'J_GATE', 'C_CAMP', 'park', [(2300, 1795), (2237, 1797), (2237, 1500), (2237, 1192), (1700, 1192)])
road('bosrandweg', 'Bosrandweg', 'J_GATE', 'J_B1', 'park', [(2406, 1650), (2410, 1520)])
road('bosrandweg-2', 'Bosrandweg', 'J_B1', 'J_B2', 'park', [(2520, 1260), (2600, 1110)], follow=False)
road('bosrandweg-3', 'Bosrandweg', 'J_B2', 'J_E1', 'park', [(2704, 996), (2781, 890), (2935, 868), (3021, 765), (3155, 636), (3540, 636), (3700, 470), (3869, 312), (4300, 306), (4719, 306), (4725, 480)])
road('oostrand-1', 'Oostrand', 'J_E1', 'J_E2', 'park')
road('oostrand-2', 'Oostrand', 'J_E2', 'J_E3', 'park')
road('oostrand-3', 'Oostrand', 'J_E3', 'J_E5', 'park', [(4722, 1450), (4718, 1547)])
road('oostlaan', 'Oostlaan', 'J_E5', 'J_LOODS', 'park', [(4592, 1700), (4520, 1840), (4440, 1925), (4470, 2150), (4542, 2317), (4548, 2700)])
road('oostlaan-eind', 'Oostlaan (keerlus bij De loods)', 'J_LOODS', 'C_LOODS', 'park', follow=False)
road('hoofdlaan', 'Hoofdlaan', 'J_GATE', 'J_M1', 'park', [(2600, 1794)], follow=False)
road('hoofdlaan-2', 'Hoofdlaan', 'J_M1', 'J_M3', 'park', [(3200, 1795)], follow=False)
road('laan-500', 'Laan 500-525', 'J_B1', 'C_500', 'park', [(2900, 1416), (3354, 1415)], follow=False)
road('laan-526', 'Laan 526-537', 'J_B2', 'C_526', 'park', [(2900, 1052)])
road('laan-570', 'Laan 566-593', 'J_E1', 'C_570', 'park', [(4400, 652), (4033, 652), (3850, 840)])
road('laan-360', 'Laan 350-376', 'J_E2', 'C_360', 'park', [(4400, 985), (4177, 985), (4004, 1156)])
road('laan-390', 'Laan 380-416', 'J_E3', 'C_390', 'park', [(4500, 1267), (4292, 1267), (4170, 1390)])
road('laan-426', 'Laan 420-434', 'J_E5', 'C_426', 'park', [(4450, 1550), (4400, 1550)])
road('laan-200', 'Laan 204-224', 'J_M1', 'J_C1', 'park')
road('laan-200-2', 'Laan 204-224', 'J_C1', 'J_C2', 'park')
road('laan-200-3', 'Laan 204-224', 'J_C2', 'C_217', 'park', [(2802, 2790), (3000, 2790)])
road('laan-250', 'Laan 246-259', 'J_C1', 'C_250', 'park', [(3100, 2088)])
road('laan-240', 'Laan 232-245', 'J_C2', 'C_240', 'park', [(3100, 2438)])
road('laan-700', 'Laan 700-709', 'J_M3', 'J_W1', 'park', [(3540, 2100)])
road('laan-330', 'Laan 323-349', 'J_W1', 'C_340', 'park', [(3540, 2790), (3900, 2790)])
road('laan-320', 'Laan bij de appartementen', 'J_W1', 'J_P2', 'park', [(3800, 2338)])
road('laan-320-2', 'Laan bij de appartementen', 'J_P2', 'C_330', 'park')
road('laan-710', 'Laan 310-322 en 710-712', 'J_M3', 'J_P2', 'park', [(3646, 1631), (3700, 1612), (3802, 1700), (3960, 1880), (4033, 1992), (4075, 2167), (4110, 2290)])
# service: from the werf along the south edge to the loods; staff barrier before the loods (golf carts stay inside)
road('dienstweg-werf', 'Dienstweg De werf', 'P_WERF', 'J_ZUID', 'service', [(1436, 3213), (1800, 3213)], speed=20, prio=0, off=1.2)
road('dienstweg-zuid', 'Dienstweg zuidrand (bos)', 'J_ZUID', 'J_LZ', 'service', [(2600, 3212), (3200, 3209), (3500, 3209), (4045, 3190), (4400, 3150)], speed=20, prio=0, off=1.2, follow=False)
road('dienstweg-loods', 'Personeelsweg De loods', 'J_LZ', 'J_LOODS', 'service', [(4610, 3060), (4615, 2960)], speed=12, prio=0, off=1.2, follow=False)
road('td-pad', 'Pad trailerstalling (golfkarren TD)', 'J_LOODS', 'C_TD', 'service', [(4640, 2915)], speed=12, prio=0, off=1.05, follow=False, surface='pavers')

def corridor_path(a, b, guide, width=46):
    """shortest path over skeleton pixels from a to b, staying within `width` pt of the guide polyline"""
    gx = np.array([p[0] for p in guide]); gy = np.array([p[1] for p in guide])
    def dseg(px, py):
        best = np.full(px.shape, 1e9)
        for i in range(len(guide) - 1):
            ax, ay, bx, by = gx[i], gy[i], gx[i + 1], gy[i + 1]
            vx, vy = bx - ax, by - ay; L2 = vx * vx + vy * vy or 1
            t = np.clip(((px - ax) * vx + (py - ay) * vy) / L2, 0, 1)
            best = np.minimum(best, np.hypot(px - (ax + t * vx), py - (ay + t * vy)))
        return best
    ok = dseg(sk_pts[:, 0], sk_pts[:, 1]) < width
    cand = sk_pts[ok]
    if len(cand) < 5: return None
    idx = {(int(x // SKS), int(y // SKS)): i for i, (x, y) in enumerate(cand)}
    def nearest(p):
        d = np.hypot(cand[:, 0] - p[0], cand[:, 1] - p[1]); i = int(np.argmin(d)); return i if d[i] < 30 else None
    s, t = nearest(a), nearest(b)
    if s is None or t is None: return None
    dist = {s: 0.0}; prev = {}; pq = [(0.0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == t: break
        if d > dist.get(u, 1e18): continue
        ux, uy = int(cand[u, 0] // SKS), int(cand[u, 1] // SKS)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                v = idx.get((ux + dx, uy + dy))
                if v is None or v == u: continue
                nd = d + math.hypot(dx, dy)
                if nd < dist.get(v, 1e18): dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
    if t not in dist: return None
    path = [t]
    while path[-1] != s: path.append(prev[path[-1]])
    pts = [[float(cand[i, 0]), float(cand[i, 1])] for i in reversed(path)]
    # the path must actually reach both ends (no long straight gap)
    return pts

net_roads = []
for r in ROADS:
    a, b = N[r['frm']]['pt'], N[r['to']]['pt']
    guide = [a] + [list(v) for v in r['via']] + [b]
    pts = corridor_path(a, b, guide) if r['follow'] else None
    if pts:
        ln = sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
        gl = sum(math.hypot(guide[i + 1][0] - guide[i][0], guide[i + 1][1] - guide[i][1]) for i in range(len(guide) - 1))
        if ln > 1.35 * gl + 40: pts = None
    src = 'skelet' if pts else 'met de hand'
    if not pts: pts = guide
    pts = dp(pts, 4.0)
    # round off the corners (Chaikin, 2x): a sharp bend makes the two lanes overlap for turning cars
    for _ in range(2):
        if len(pts) < 3: break
        sm = [pts[0]]
        for i in range(len(pts) - 1):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            q = [0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]; r_ = [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]
            sm += ([r_] if i == 0 else [q, r_]) if i < len(pts) - 2 else [q]
        pts = sm + [pts[-1]]
    inner = [p for p in pts[1:-1] if math.hypot(p[0] - a[0], p[1] - a[1]) > 14 and math.hypot(p[0] - b[0], p[1] - b[1]) > 14]
    rr = {'id': r['id'], 'name': r['name'], 'from': r['frm'], 'to': r['to'], 'class': r['cls'], 'speedKmh': r['speed'], 'priority': r['prio'],
          'laneOffsetM': r['off'], 'pts': [[round(x, 1), round(y, 1)] for x, y in inner], 'shape': src}
    rr.update(r['kw'])
    net_roads.append(rr)
    print(f"  weg {r['id']:18s} {src:12s} {len(inner)} punten")

# barrier point: in- and outbound barrier on the entrance road just south of the gate junction, island between the lanes
for rr in net_roads:
    if rr['id'] == 'toegangsweg':
        rr['gatePlaza'] = {'fromPt': [2414, 1990], 'toPt': [2414, 1890], 'forwardOffsetM': 3.4, 'backwardOffsetM': 3.4, 'rampM': 8}
gates = [
    {'id': 'gate-in', 'direction': 'inbound', 'road': 'toegangsweg', 'lane': 'forward', 'stopPt': [2414, 1905], 'queueSlots': 6, 'slotSpacingM': 7.6, 'armSide': 'left', 'openSec': 3.2, 'closeSec': 3.4, 'label': 'Hart', 'pdfEvidence': 'rode stippellijnen (slagboom) bij de kruising ten oosten van het hart, ca. (2300-2475, 1785) pt; de slagboom staat hier op de ingangsweg zodat de wachtrij op die weg past (aanname, opdrachtgever 15-10-2026: een toegang, in en uit)'},
    {'id': 'gate-out', 'direction': 'outbound', 'road': 'toegangsweg', 'lane': 'backward', 'stopPt': [2414, 1975], 'queueSlots': 4, 'slotSpacingM': 7.2, 'armSide': 'left', 'openSec': 3.2, 'closeSec': 3.4, 'label': 'Hart'},
    {'id': 'gate-personeel-in', 'direction': 'inbound', 'staff': True, 'road': 'dienstweg-loods', 'lane': 'forward', 'stopPt': [4612, 3030], 'queueSlots': 1, 'slotSpacingM': 7.0, 'armSide': 'right', 'openSec': 3.0, 'closeSec': 3.2, 'label': 'Personeel', 'note': 'personeelsslagboom bij De loods, richting park'},
    {'id': 'gate-personeel-uit', 'direction': 'outbound', 'staff': True, 'road': 'dienstweg-loods', 'lane': 'backward', 'stopPt': [4614, 2985], 'queueSlots': 1, 'slotSpacingM': 7.0, 'armSide': 'right', 'openSec': 3.0, 'closeSec': 3.2, 'label': 'Personeel', 'note': 'personeelsslagboom bij De loods, richting dienstweg'},
]
network = {
    'comment': 'Gericht wegennet van Harderwold (pt = pixel van de rasterplattegrond, 0,24 m/pt). Topologie met de hand vastgelegd, wegvormen langs de hartlijnen van de wegvlakken (tools/harderwold/build_map.py). Rijstroken, voorrang, snelheden, keerlussen, slagbomen en dienstwegen zijn BEWERKBARE ONTWERPAANNAMES.',
    'nodes': N, 'roads': net_roads, 'turnRestrictions': [], 'gates': gates,
    'parking': {'comment': 'Een parkeervak per villa aan de straatkant van de kavel; de geschakelde blokken 600-655 delen een parkeerstrook per blok. Ligging is een aanname (de PDF toont geen parkeervakken bij de villa\'s).'},
}

# ------------------------------------------------------------------ houses from the plot labels
labels = json.load(open('work/labels.json'))
fixed = {(2858, 1705): '303', (2961, 1704): '304', (3718, 868): '577A', (4035, 1023): '358A', (3976, 1083): '359A',
         (4041, 1192): '364A', (3705, 1478): '312A', (2849, 2887): '217A'}
blocks = {(4125, 236): (615, 619), (4294, 236): (610, 614), (4463, 244): (605, 609), (4632, 236): (600, 604),
          (3725, 375): (620, 624), (3573, 391): (625, 630), (3569, 527): (631, 635), (3430, 578): (636, 640),
          (3322, 468): (641, 645), (3213, 578): (646, 650), (2936, 982): (651, 655)}
def num_of(t):  # '217A' -> 1217 (A-variants get 1000 + number; see src/shared/house.ts houseLabel)
    return 1000 + int(t[:-1]) if t.endswith('A') else int(t)
houses, block_list = [], []
for b in labels:
    key = next((k for k in list(fixed) + list(blocks) if abs(k[0] - b['cx']) < 12 and abs(k[1] - b['cy']) < 12), None)
    if key in blocks: block_list.append((b, blocks[key])); continue
    t = fixed.get(key, b['text'])
    if key is None and (b['score'] < 0.8 or len(t.rstrip('A')) != 3): raise SystemExit(f'label onzeker: {b}')
    houses.append({'b': b, 'text': t, 'num': num_of(t)})
nums = [h['num'] for h in houses]
assert len(nums) == len(set(nums)), 'dubbele huisnummers'

# nearest road centreline (visitor roads) for the front direction and the parking point
road_lines = []
for rr in net_roads:
    if rr['class'] == 'service': continue
    pl = [N[rr['from']]['pt']] + rr['pts'] + [N[rr['to']]['pt']]
    road_lines.append(np.array(pl, float))
def nearest_road(p):
    best = (1e9, None)
    for pl in road_lines:
        for i in range(len(pl) - 1):
            a, b2 = pl[i], pl[i + 1]; v = b2 - a; L2 = v @ v or 1
            t = max(0, min(1, ((p - a) @ v) / L2)); q = a + t * v; d = np.hypot(*(p - q))
            if d < best[0]: best = (d, q)
    return best

def front_deg(u, box_ang):
    """front = towards the nearest street, snapped to the axes of the plot label (plots are rectangular)"""
    want = math.degrees(math.atan2(u[1], u[0]))
    cands = [box_ang + 90 * q for q in range(4)]
    best = min(cands, key=lambda c: abs((c - want + 180) % 360 - 180))
    return round(best % 360, 1)

park_houses, clusters = [], []
for h in sorted(houses, key=lambda h: h['num']):
    b = h['b']; p = np.array([b['cx'], b['cy']])
    d, q = nearest_road(p)
    park_houses.append({'id': f"H{h['num']}", 'number': h['num'], 'label': h['text'], 'pt': [round(b['cx'], 1), round(b['cy'], 1)],
                        'legendType': '8V', 'typeConfidence': 'high' if b['score'] > 0.85 or h['text'] in fixed.values() else 'medium',
                        'pdfRotationDeg': round(b['ang'], 1), 'petsAllowed': h['num'] % 5 == 0, 'footprintPts': 60,
                        'frontDeg': front_deg(q - p, b['ang'])})
    u = (q - p) / max(1, d)
    cp = q - u * 22  # just inside the plot, at the road
    clusters.append({'id': f"P{h['num']}", 'kind': 'house', 'pt': [round(cp[0], 1), round(cp[1], 1)], 'stalls': 1, 'serves': [h['num']],
                     'pdfEvidence': 'aanname: oprit aan de straatkant van de kavel'})
# terraced blocks 600-655: units side by side along the block's long axis
for b, (lo, hi) in block_list:
    n = hi - lo + 1
    a = math.radians(b['ang']); u = np.array([math.cos(a), math.sin(a)])
    span = max(b['len'], 110)
    p = np.array([b['cx'], b['cy']])
    d, q = nearest_road(p); tow = (q - p) / max(1, d)
    for k in range(n):
        c = p + u * (k - (n - 1) / 2) * span / n
        park_houses.append({'id': f'H{lo + k}', 'number': lo + k, 'label': str(lo + k), 'pt': [round(c[0], 1), round(c[1], 1)], 'legendType': '4G',
                            'typeConfidence': 'medium', 'pdfRotationDeg': round(b['ang'], 1), 'petsAllowed': False, 'footprintPts': round(span / n, 1), 'frontDeg': front_deg(tow, b['ang']),
                            'note': f'geschakeld blok {lo}/{hi} (aanname: {n} woningen naast elkaar)'})
    cp = q - tow * 22
    # block 646/650 lies next to the bend of the forest-edge road: its parking strip goes on the straight part
    if (lo, hi) == (646, 650): cp = np.array([3300.0, 618.0])
    clusters.append({'id': f'P{lo}-{hi}', 'kind': 'house', 'pt': [round(cp[0], 1), round(cp[1], 1)], 'stalls': n, 'serves': list(range(lo, hi + 1)),
                     'pdfEvidence': 'aanname: gedeelde parkeerstrook voor het geschakelde blok'})
clusters.append({'id': 'TD', 'kind': 'depot', 'pt': [4680, 2960], 'stalls': 2, 'serves': [],
                 'stall': {'rt': 2.6, 'straight': 3.2, 'width': 2.4, 'vehLen': 2.8, 'vehWid': 1.35},
                 'pdfEvidence': 'AANNAME: golfkarren van de technische dienst bij De loods / trailerstalling (5)'})
print('huizen', len(park_houses), 'parkeerclusters', len(clusters))

# ------------------------------------------------------------------ facilities (legend icons, placed by hand from the plan)
F = lambda key, name, x, y: {'key': key, 'name': name, 'pt': [x, y]}
facilities = [
    F('A', 'Receptie', 1833, 1805), F('G', 'Brasserie Harderwold', 1764, 1805), F('H', 'Terras', 1760, 1883),
    F('J', 'Toiletten & douches', 1797, 1737), F('S', 'Speeltuin', 1833, 1883), F('V', 'Receptie (winkeltje)', 1840, 1790),
    F('W', 'Fietsen bij de receptie', 1820, 1840), F('P', 'Parkeerplaatsen', 2000, 1805), F('EV', 'Electrisch laden', 2073, 1805),
    F('K', 'Stort chemisch toilet', 2185, 1641), F('B5', 'Brievenbus 5', 2342, 1737),
    F('R', 'Interactieve driving range', 2015, 1486), F('Z', 'Jeu-de-boulesbaan', 2191, 1432), F('U', 'Adventure golf 18 holes', 1824, 1332),
    F('CP', '23 Camperplaatsen', 1540, 1377), F('O', '9-holes golfbaan', 1376, 2192), F('L', 'Bosgolf 18 holes', 2482, 2532),
    F('D', 'Milieustraat', 1469, 2845), F('I', 'De werf', 1396, 3005), F('WB', 'Woonboten', 945, 1283),
    F('T', 'Lasergame', 750, 464), F('C', 'Boogschieten', 567, 573), F('Y', 'Outdoor baan', 690, 736),
    F('N', 'Appartementen', 3750, 2045), F('Q', 'Tennisbaan', 3908, 2127), F('S', 'Speeltuin', 3605, 2195), F('E', 'AED', 3845, 2223),
    F('X', 'Afval PD/papier/glas/restafval', 3594, 2304), F('P', 'Parkeerplaatsen', 3845, 2304),
    F('E', 'AED', 4759, 982), F('X', 'Restafval', 4759, 286), F('X', 'Restafval', 4759, 1126), F('X', 'Afval PD/papier/glas/restafval', 2967, 723),
    F('X', 'Afval PD/papier/glas/restafval', 2845, 1895), F('X', 'Afval PD/papier/glas/restafval', 4622, 1636), F('S', 'Speeltuin', 4691, 1636),
    F('Z', 'Jeu-de-boulesbaan', 4677, 1759), F('X', 'Restafval', 2899, 1718), F('F', 'Trailerstalling', 4669, 2918), F('M', 'De loods', 4669, 3014),
]
for f in facilities: f['pt'] = [float(v) for v in f['pt']]

# ------------------------------------------------------------------ buildings, fields, car park, decor
rect = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
def rot_rect(cx, cy, L, Wd, deg):
    a = math.radians(deg); u = (math.cos(a), math.sin(a)); v = (-math.sin(a), math.cos(a))
    return [[round(cx + u[0] * L / 2 * i + v[0] * Wd / 2 * j, 1), round(cy + u[1] * L / 2 * i + v[1] * Wd / 2 * j, 1)] for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
massing = {
    'comment': 'Bouwmassa van de gebouwen (pt). Per vleugel: hoekpunten; goothoogte, dakvorm en gevelstijl zijn ARTISTIEKE AANNAMES (de PDF toont alleen vlakken en symbolen). Fase 2 vervangt dit door Harderwold-architectuur.',
    'rotationDeg': 0,
    'wings': [
        {'id': 'HART', 'name': 'Brasserie Harderwold & receptie', 'facilities': ['A', 'G', 'J', 'V'], 'corners': rect(1716, 1707, 1866, 1905), 'eaveM': 4.4, 'roof': 'white', 'style': 'modern', 'terrace': True, 'sign': {'text': 'Harderwold', 'sub': 'Receptie  ·  Brasserie'}},
        {'id': 'DR', 'name': 'Driving range', 'facilities': ['R'], 'corners': rect(1881, 1527, 2146, 1582), 'eaveM': 4.0, 'roof': 'white', 'style': 'modern'},
        {'id': 'WERF', 'name': 'De werf', 'facilities': ['I'], 'corners': rect(1355, 2914, 1485, 3086), 'eaveM': 5.0, 'pitchDeg': 22, 'ridge': 'v', 'style': 'workshop', 'sign': {'text': 'De werf'}},
        {'id': 'LOODS', 'name': 'De loods', 'facilities': ['M'], 'corners': rect(4609, 2987, 4736, 3055), 'eaveM': 4.5, 'pitchDeg': 20, 'ridge': 'u', 'style': 'workshop'},
        {'id': 'APP1', 'name': 'Appartementen', 'facilities': ['N'], 'corners': rot_rect(3762, 2112, 430, 62, 45), 'eaveM': 7.5, 'roof': 'white', 'style': 'modern', 'rotationDeg': 45},
        {'id': 'APP2', 'name': 'Appartementen', 'facilities': ['N'], 'corners': rot_rect(3762, 2112, 430, 62, -45), 'eaveM': 7.5, 'roof': 'white', 'style': 'modern', 'rotationDeg': -45},
    ],
}
structures = [
    {'kind': 'field', 'facilities': ['Q'], 'pts': rot_rect(3908, 2127, 88, 52, 0), 'heightM': 0, 'roof': 'none', 'name': 'Tennisbanen'},
    {'kind': 'field', 'facilities': ['R'], 'pts': rect(1883, 1300, 2140, 1520), 'heightM': 0, 'roof': 'none', 'name': 'Driving range'},
]
lot = {
    'id': 'P-hart', 'name': 'Parkeerterrein bij het hart', 'origin': [1888.0, 1690.0], 'angleDeg': 0, 'lengthPt': 312, 'depthPt': 204, 'cornerPt': 8,
    'rows': [{'v0': 2, 'v1': 22, 'nose': -1}, {'v0': 48, 'v1': 68, 'nose': 1}, {'v0': 68, 'v1': 88, 'nose': -1},
             {'v0': 114, 'v1': 134, 'nose': 1}, {'v0': 134, 'v1': 154, 'nose': -1}, {'v0': 180, 'v1': 200, 'nose': 1}],
    'stallU0': 14, 'stallWidthPt': 10.4, 'stalls': 27, 'aisles': [35, 101, 167], 'ev': {'row': 0, 'count': 6},
    'note': 'Ontwerpaanname naar de PDF: zes rijen parkeervakken tussen hagen, laadpalen (EV) aan de noordrij. Bewerkbaar.',
}
lot['outline'] = rect(1888, 1690, 1888 + 312, 1690 + 204)
decor = {
    'comment': 'Losse decorstukken (pt): entreebord, vlaggen, bloemperken en straatlantaarns langs de ingangsweg. Aanname.',
    'sign': [2470, 2030], 'flags': [[2470, 2060], [2470, 2075], [2470, 2090]],
    'flowerBeds': [[2470, 1960], [2350, 1960], [1760, 1930], [1820, 1930]],
    'lampRoad': 'toegangsweg', 'staffRoad': 'dienstweg-loods',
    'focus': {'receptie': 'A', 'brasserie': 'G', 'hart': 'A', 'appartementen': 'N', 'golf': 'O', 'werf': 'I', 'loods': 'M', 'slagboom': 'gate'},
    'trees': trees,
}
park = {
    'id': 'park-harderwold', 'name': 'Harderwold Villa Resort (spelprototype)',
    'source': {'file': 'references/harderwold_plattegrond.pdf', 'page': 1, 'raster': [4961, 3508], 'note': 'alleen raster; coordinaten = pixels'},
    'viewPts': VIEW, 'originPt': VIEW[:2], 'metersPerPt': K,
    'assumptions': [
        'Schaal 1 pt (pixel van het raster) = 0,24 m: wegbreedte ~25 pt = 6 m (twee rijstroken), kavelfront ~85 pt = 20 m. De tennisbaan is in de PDF kleiner dan op schaal getekend.',
        'Wegennet: knooppunten en wegindeling met de hand, wegvormen langs de hartlijnen van de wegvlakken. Alle villastraten zijn tweerichtingsverkeer met een keerlus aan het eind.',
        'Een toegang (opdrachtgever, 15-10-2026): in- en uitrijslagboom op de ingangsweg net ten zuiden van de kruising bij het hart; het hart, de camperplaatsen en de villawijk liggen erachter.',
        'Dienstvoertuigen starten bij De werf (4) en rijden over de dienstweg langs de zuidrand naar De loods (5), met een personeelsslagboom. De golfkarren van de TD staan bij de trailerstalling (binnen).',
        'Villa\'s: positie en richting uit de nummervakjes; voorkant naar de straat, achterkant naar het water. Geschakelde blokken 600-655: woningen naast elkaar in het grijze blok.',
        'Voorzieningsletters zijn tijdelijk gekoppeld aan de opdrachten van de basis (bijv. J = toiletten & douches); fase 3 maakt Harderwold-opdrachten.',
        'Golfpaden zijn voetpaden (geen rijbaan) in fase 1; golfkarren op de baan volgen in een latere fase.',
    ],
    'terrain': {'water': water, 'footpaths': footpaths, 'roadSurfaces': big_paved, 'golf': golf, 'forest': forest},
    'structures': structures, 'facilities': facilities, 'houses': park_houses, 'parkingClusters': clusters, 'staticBarriers': [],
    'massing': massing, 'parkingLot': lot, 'decor': decor,
}
manifest = {
    'comment': 'Automatisch uit de rasterplattegrond (labels.py): huisnummers met positie, voor het kaartrapport in de editor.',
    'houses': [{'number': h['number'], 'label': h['label'], 'pdf': {'x': h['pt'][0], 'y': h['pt'][1]}, 'legendType': h['legendType'], 'typeConfidence': h['typeConfidence']} for h in park_houses],
    'facilities': [{'key': f['key'], 'x': f['pt'][0], 'y': f['pt'][1]} for f in facilities],
    'legend': {}, 'warnings': [],
}
json.dump(park, open('data/map/park.json', 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump(network, open('data/map/park_road_network.json', 'w'), ensure_ascii=False, indent=1)
json.dump(manifest, open('data/map/harderwold_manifest.json', 'w'), ensure_ascii=False, indent=0)
print('klaar')
