"""Extra evidence from AHT_Plat.pdf for the whole-park map (all in PDF points):
  work/public_nodes.json    skeleton nodes reachable from the Ingang with both barriers closed (= public part)
  work/oneway_arrows.json   one-way arrows (legend "Eenrichtingsverkeer": 5-point shaft + 4-point head, 0.62 pt line)
  work/parking_strips.json  parking strips (road-coloured quads with green outline) and their cell count
Usage: python3 tools/extract_pdf_extras.py work/road_skeleton.json"""
import sys, json, math
import pdfplumber

skel = json.load(open(sys.argv[1]))
pg = pdfplumber.open('references/AHT_Plat.pdf').pages[0]

# ---- public part: block the two barrier edges, flood from the Ingang
def segd(p, a, b):
    ax, ay = a; bx, by = b; px, py = p; dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy or 1e-9
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L)); return math.hypot(ax + t * dx - px, ay + t * dy - py)
def near_edge(p):
    return min(((min(segd(p, e['pts'][j], e['pts'][j + 1]) for j in range(len(e['pts']) - 1)), i) for i, e in enumerate(skel['edges'])))
BARRIERS = [(373.8, 192.0), (445.0, 144.0)]      # West (toegangsweg) and Oost (hoofdweg) barrier symbols
INGANG = (205.0, 160.0)                           # PDF label "Ingang" at the Gelpenberg
blocked = {near_edge(b)[1] for b in BARRIERS}
adj = {}
for i, e in enumerate(skel['edges']):
    if i in blocked: continue
    adj.setdefault(e['a'], []).append(e['b']); adj.setdefault(e['b'], []).append(e['a'])
start = skel['edges'][near_edge(INGANG)[1]]['a']
seen = {start}; st = [start]
while st:
    u = st.pop()
    for v in adj.get(u, []):
        if v not in seen: seen.add(v); st.append(v)
json.dump(sorted(seen), open('work/public_nodes.json', 'w'))

# ---- one-way arrows
objs = [o for o in pg.curves if round(o.get('linewidth') or 0, 2) == 0.62 and o['bottom'] < 425
        and (o.get('stroking_color') == (0.0, 0.0, 0.0, 1.0) or o.get('non_stroking_color') == (0.0, 0.0, 0.0, 1.0))]
heads = [o for o in objs if len(o['pts']) == 4 and max(o['x1'] - o['x0'], o['bottom'] - o['top']) < 2.2]
shafts = [o for o in objs if len(o['pts']) == 5 and max(o['x1'] - o['x0'], o['bottom'] - o['top']) < 4.6]
arrows = []
for h in heads:
    hx, hy = (h['x0'] + h['x1']) / 2, (h['top'] + h['bottom']) / 2
    best = min(((math.hypot(hx - (s['x0'] + s['x1']) / 2, hy - (s['top'] + s['bottom']) / 2), s) for s in shafts), key=lambda t: t[0], default=None)
    if best and best[0] < 3.5:
        s = best[1]; sx, sy = (s['x0'] + s['x1']) / 2, (s['top'] + s['bottom']) / 2
        arrows.append({'pt': [round(sx, 1), round(sy, 1)], 'dir': [round((hx - sx) / best[0], 2), round((hy - sy) / best[0], 2)]})
arrows = [a for a in arrows if a['pt'][1] <= 385 and 215 < a['pt'][0] < 650]   # bike-route arrows lie outside the park
json.dump(arrows, open('work/oneway_arrows.json', 'w'))

# ---- parking strips
G = (0.56, 0.0, 1.0, 0.0)
cand = [o for o in pg.curves if o.get('stroking_color') == G and o['bottom'] < 425]
divs = [o for o in pg.lines if o.get('stroking_color') == G and o['bottom'] < 425]
def corners(o):
    P = [(round(x, 2), round(y, 2)) for x, y in o['pts']]
    if len(P) > 1 and math.dist(P[0], P[-1]) < 0.05: P = P[:-1]
    U = []
    for p in P:
        if all(math.dist(p, q) > 0.05 for q in U): U.append(p)
    return U
def inside(pt, q):
    s = None
    for i in range(len(q)):
        a, b = q[i], q[(i + 1) % len(q)]
        c = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0])
        if abs(c) < 1e-9: continue
        if s is None: s = c > 0
        elif s != (c > 0): return False
    return True
seen_q = set(); strips = []
for o in cand:
    q = corners(o)
    if len(q) != 4: continue
    key = tuple(sorted((round(x, 1), round(y, 1)) for x, y in q))
    if key in seen_q: continue
    seen_q.add(key)
    e = [math.dist(q[i], q[(i + 1) % 4]) for i in range(4)]
    if min(e) < 1.8 or min(e) > 4.5: continue
    n = sum(1 for d in divs if inside(((d['x0'] + d['x1']) / 2, (d['top'] + d['bottom']) / 2), q))
    strips.append({'quad': [[x, y] for x, y in q], 'cells': n + 1, 'long': round(max(e), 2), 'short': round(min(e), 2)})
json.dump(strips, open('work/parking_strips.json', 'w'))
print(f'public nodes {len(seen)}, one-way arrows {len(arrows)}, parking strips {len(strips)}')
