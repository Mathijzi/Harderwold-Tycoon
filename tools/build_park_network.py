"""Build the editable road network of the WHOLE park: the hand-tuned prototype sector network (gate plaza, TD path,
turning circle) is kept as is; every other road comes from the PDF skeleton (tools/extract_roads.py).
Sector portals that now continue into the park become junctions; the hoofdweg is extended to the real Ingang.
Output: data/map/park_road_network.json (PDF points). All lane geometry, directions and priorities stay EDITABLE
DESIGN ASSUMPTIONS - the PDF only shows road surfaces.
Usage: python3 tools/build_park_network.py work/road_skeleton.json work/public_nodes.json data/map/park_road_network.json"""
import sys, json, math, copy

skel = json.load(open(sys.argv[1])); pub = set(json.load(open(sys.argv[2]))); out = sys.argv[3]
base = json.load(open('data/map/sector_road_network.json'))
net = copy.deepcopy(base)
SK = {n['id']: n for n in skel['nodes']}

def segd(p, a, b):
    ax, ay = a; bx, by = b; px, py = p; dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy or 1e-9
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L)); return math.hypot(ax + t * dx - px, ay + t * dy - py), t
def poly_of(r): return [net['nodes'][r['from']]['pt']] + r['pts'] + [net['nodes'][r['to']]['pt']]
def densify(P, step=1.0):
    out = [P[0]]
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]; n = max(1, int(math.dist(a, b) / step))
        out += [[a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n] for j in range(1, n + 1)]
    return out
def plen(P): return sum(math.dist(P[i], P[i + 1]) for i in range(len(P) - 1))
def thin(P, tol=0.6):
    """Douglas-Peucker on interior control points (endpoints are the nodes)."""
    if len(P) < 3: return P
    a, b = P[0], P[-1]; dm, im = 0, 0
    for i in range(1, len(P) - 1):
        d, _ = segd(P[i], a, b)
        if d > dm: dm, im = d, i
    if dm < tol: return [a, b]
    return thin(P[:im + 1], tol)[:-1] + thin(P[im:], tol)

def chaikin(P, it=2):
    """corner cutting: removes the pixel staircase of the skeleton so roads have smooth, even curves (ends fixed)"""
    for _ in range(it):
        if len(P) < 3: return P
        Q = [P[0]]
        for a, b in zip(P, P[1:]):
            Q += [[0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]]
        Q.append(P[-1]); P = Q
    return P

def gauss_smooth(P, sigma=3.0):
    """Gaussian smoothing of a densified (1 pt) polyline: removes the long-wave wobble of the PDF skeleton so roads
    run in even, flowing curves. The ends stay fixed (they meet junctions) and the effect fades in over 2 sigma."""
    n = len(P)
    if n < 5: return P
    r = int(3 * sigma)
    w = [math.exp(-0.5 * (k / sigma) ** 2) for k in range(-r, r + 1)]
    out = []
    for i in range(n):
        sx = sy = sw = 0.0
        for k in range(-r, r + 1):
            j = min(n - 1, max(0, i + k))
            # mirror around the end point so the end tangent is kept
            if i + k < 0: q = [2 * P[0][0] - P[-(i + k)][0], 2 * P[0][1] - P[-(i + k)][1]] if -(i + k) < n else P[0]
            elif i + k >= n: m = 2 * (n - 1) - (i + k); q = [2 * P[-1][0] - P[m][0], 2 * P[-1][1] - P[m][1]] if m >= 0 else P[-1]
            else: q = P[j]
            sx += q[0] * w[k + r]; sy += q[1] * w[k + r]; sw += w[k + r]
        out.append([sx / sw, sy / sw])
    out[0], out[-1] = P[0], P[-1]
    return out

def split_road(rid, pt, nid, new_rid):
    """Split sector road rid at the point nearest to pt; node nid is inserted there."""
    r = next(x for x in net['roads'] if x['id'] == rid)
    P = poly_of(r); best = (1e9, 0, 0)
    for i in range(len(P) - 1):
        d, t = segd(pt, P[i], P[i + 1])
        if d < best[0]: best = (d, i, t)
    _, i, t = best
    q = [round(P[i][0] + (P[i + 1][0] - P[i][0]) * t, 1), round(P[i][1] + (P[i + 1][1] - P[i][1]) * t, 1)]
    net['nodes'][nid] = {'pt': q, 'kind': 'junction', 'radius': 6}
    r2 = copy.deepcopy(r); r2['id'] = new_rid; r2['from'] = nid; r2['pts'] = [p for p in P[i + 1:-1]]
    r['to'] = nid; r['pts'] = [p for p in P[1:i + 1]]
    r2.pop('gatePlaza', None)
    net['roads'].append(r2)
    return q

# ---- 1. sector portals that continue into the park
net['nodes']['P_E'].update(kind='junction', radius=7); net['nodes']['P_E'].pop('portal', None); net['nodes']['P_E'].pop('label', None)
for pid in ('P_S', 'P_WW'):
    net['nodes'][pid].update(kind='junction', radius=6); net['nodes'][pid].pop('portal', None); net['nodes'][pid].pop('label', None)
for r in net['roads']:
    if r['id'] in ('dienstweg-zuid', 'dienstweg-west'):
        r['class'] = 'park'; r['name'] = {'dienstweg-zuid': 'Zuidlaan', 'dienstweg-west': 'Weg west'}[r['id']]
    if r['id'] == 'hoofdweg-e': r['class'] = 'arrival'; r['name'] = 'Hoofdweg (achter slagboom Oost)'
# junctions of the PDF that lie on sector roads
split_road('hoofdweg-e', SK[120]['pt'], 'J_O', 'hoofdweg-oost')
split_road('dienstweg-west', SK[152]['pt'], 'J_WW', 'weg-west-2')
for r in net['roads']:
    if r['id'] == 'hoofdweg-oost': r['class'] = 'park'; r['name'] = 'Hoofdweg oost'
    if r['id'] == 'weg-west-2': r['class'] = 'park'; r['name'] = 'Weg west'
# hoofdweg to the real Ingang (PDF "Ingang" at the Gelpenberg)
e_ing = next(e for e in skel['edges'] if 114 in (e['a'], e['b']) and min(SK[e['a']]['pt'][0], SK[e['b']]['pt'][0]) < 200)
ing_id = e_ing['b'] if e_ing['a'] == 114 else e_ing['a']
ing = SK[ing_id]['pt']
old_pw = base['nodes']['P_W']['pt']
P = [SK[e_ing['a']]['pt']] + e_ing['pts'][1:-1] + [SK[e_ing['b']]['pt']]
if e_ing['a'] == 114: P = P[::-1]                      # from the Ingang eastwards
P = [p for p in P if p[0] < old_pw[0] - 3]
start = [round(P[0][0] + 5, 1), round(P[0][1], 1)]     # portal a few metres inside the Ingang (off the Gelpenberg)
net['nodes']['P_W'].update(pt=start, label='Ingang (Gelpenberg)')
hw = next(r for r in net['roads'] if r['id'] == 'hoofdweg-w')
hw['pts'] = [[round(x, 1), round(y, 1)] for x, y in thin([start] + [p for p in P if p[0] > start[0] + 2] + [old_pw])[1:]] + hw['pts']

# skeleton node -> network node (sector junctions the skeleton also found)
MAP = {45: 'J_S', 68: 'J_W', 161: 'J_W', 160: 'J_N', 118: 'C_E', 34: 'P_E', 167: 'P_E', 200: 'P_WW', 114: 'J_A', 120: 'J_O', 152: 'J_WW'}
covered_polys = [densify(poly_of(r), 1.0) for r in net['roads']]
def coverage(p):
    best = 1e9
    for P in covered_polys:
        for q in P[::2]:
            d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
            if d < best: best = d
    return math.sqrt(best)

# park boundary: hull of all houses + 8 pt. Outside lie the public roads (Gelpenberg, Paardelandsedrift, Wezup);
# the PDF connects a few park roads to them at emergency exits ("Nooduitgang"), which are NOT car routes.
from shapely.geometry import MultiPoint, Point
_man = json.load(open('data/map/aelderholt_manifest.json'))
PARK = MultiPoint([(h['pdf']['x'], h['pdf']['y']) for h in _man['houses']]).convex_hull.buffer(8)
def outside(p): return not PARK.contains(Point(p[0], p[1]))

# ---- 2. add skeleton roads outside the sector network
added = 0; deadends = {}
def node_for(skid, pt):
    if skid in MAP: return MAP[skid]
    nid = f'N{skid}'
    if nid not in net['nodes']:
        deg = SK[skid]['degree']
        # degree 2 = bend left by a pruned spur (merged away below); degree 1 = turning circle / end of road
        net['nodes'][nid] = {'pt': SK[skid]['pt'], 'kind': 'junction', 'radius': 6} if deg >= 2 else {'pt': SK[skid]['pt'], 'kind': 'deadend', 'turnRadiusM': 5.5}
    return nid
def nearest_node(pt, maxd=12):
    best = min(((math.dist(pt, n['pt']), k) for k, n in net['nodes'].items() if n['kind'] in ('junction', 'deadend', 'portal')), default=(1e9, None))
    return best[1] if best[0] <= maxd else None

for ei, e in enumerate(skel['edges']):
    if e['a'] in pub or e['b'] in pub: continue
    P = densify([SK[e['a']]['pt']] + e['pts'][1:-1] + [SK[e['b']]['pt']], 1.0)
    out_ = [outside(p) for p in P]
    cov = [o or coverage(p) < 4.0 for p, o in zip(P, out_)]
    # runs of uncovered points
    runs, cur = [], []
    for i, c in enumerate(cov):
        if not c: cur.append(i)
        elif cur: runs.append(cur); cur = []
    if cur: runs.append(cur)
    for run in runs:
        i0, i1 = run[0], run[-1]
        whole = i0 == 0 and i1 == len(P) - 1          # a complete skeleton edge: keep even tiny links between junction blobs
        if i1 - i0 < 4 and not whole: continue
        def cut_end(i):  # run ends at the park boundary: an emergency exit, modelled as the end of the road
            nid = f'X{ei}_{i}'; net['nodes'][nid] = {'pt': [round(P[i][0], 1), round(P[i][1], 1)], 'kind': 'deadend', 'turnRadiusM': 5.5, 'note': 'parkgrens / nooduitgang'}
            return nid
        a = node_for(e['a'], P[0]) if i0 == 0 else (cut_end(i0) if out_[i0 - 1] else nearest_node(P[i0 - 1]))
        b = node_for(e['b'], P[-1]) if i1 == len(P) - 1 else (cut_end(i1) if out_[i1 + 1] else nearest_node(P[i1 + 1]))
        if (i0 == 0 and outside(SK[e['a']]['pt'])) or (i1 == len(P) - 1 and outside(SK[e['b']]['pt'])): continue
        if a is None or b is None:
            print('WARN: cannot attach run', ei, P[i0], P[i1], a, b); continue
        if a == b and plen(P[i0:i1 + 1]) < 30: continue
        inner = thin(gauss_smooth(P[i0:i1 + 1], 3.0), 0.2)[1:-1] if i1 - i0 >= 2 else []
        rid = f'laan-{len(net["roads"]) + 1}'
        road = {'id': rid, 'name': 'Parklaan', 'from': a, 'to': b, 'class': 'park', 'speedKmh': 15, 'priority': 1, 'laneOffsetM': 1.45,
                'pts': [[round(x, 1), round(y, 1)] for x, y in inner]}
        if a == b:  # loop road: split it with a mid node so every road has two distinct ends
            mid = len(inner) // 2
            mid_id = f'{rid}-m'; net['nodes'][mid_id] = {'pt': [round(inner[mid][0], 1), round(inner[mid][1], 1)], 'kind': 'junction', 'radius': 1}
            r2 = dict(road, id=rid + 'b', from_=None); r2.pop('from_')
            r2['from'] = mid_id; r2['pts'] = road['pts'][mid + 1:]; road['to'] = mid_id; road['pts'] = road['pts'][:mid]
            net['roads'].append(r2)
        net['roads'].append(road); added += 1

# degree-2 "junctions" (skeleton artefacts) become simple bends: merge their two roads
def degree(nid): return sum((r['from'] == nid) + (r['to'] == nid) for r in net['roads'])
changed = True
while changed:
    changed = False
    for nid, n in list(net['nodes'].items()):
        if not nid.startswith('N') or n['kind'] != 'junction' or degree(nid) != 2: continue
        rs = [r for r in net['roads'] if nid in (r['from'], r['to'])]
        if len(rs) != 2 or rs[0] is rs[1]: continue
        r1, r2 = rs
        P1 = poly_of(r1) if r1['to'] == nid else poly_of(r1)[::-1]
        P2 = poly_of(r2) if r2['from'] == nid else poly_of(r2)[::-1]
        start = r1['from'] if r1['to'] == nid else r1['to']; end = r2['to'] if r2['from'] == nid else r2['from']
        if start == end: continue
        r1.update({'from': start, 'to': end, 'pts': P1[1:-1] + [n['pt']] + P2[1:-1]})
        net['roads'].remove(r2); del net['nodes'][nid]; changed = True; break
# two junctions joined by a short road (< 16 pt ~ 21 m) become one junction: two offset T-junctions read as one
# smeared asphalt area on the map, a single crossing looks clean
changed = True
while changed:
    changed = False
    for r in list(net['roads']):
        a, b = r['from'], r['to']
        if a == b or net['nodes'][a]['kind'] != 'junction' or net['nodes'][b]['kind'] != 'junction': continue
        if plen(poly_of(r)) >= 16: continue
        if not a.startswith('N') and not b.startswith('N'): continue   # both hand-tuned sector junctions: keep
        keep, drop = (a, b) if not a.startswith('N') else (b, a) if not b.startswith('N') else (a, b)
        pa, pb = net['nodes'][a]['pt'], net['nodes'][b]['pt']
        if keep.startswith('N'): net['nodes'][keep]['pt'] = [round((pa[0] + pb[0]) / 2, 1), round((pa[1] + pb[1]) / 2, 1)]
        net['roads'].remove(r)
        for r2 in net['roads']:
            if r2['from'] == drop: r2['from'] = keep
            if r2['to'] == drop: r2['to'] = keep
        del net['nodes'][drop]; changed = True; break
# dead-end stubs shorter than 12 pt (remnants of a turning circle, or too short for a turning loop next to a junction)
for r in list(net['roads']):
    a, b = r['from'], r['to']
    ends = [x for x in (a, b) if net['nodes'][x]['kind'] == 'deadend' and x.startswith(('N', 'X'))]
    if ends and plen(poly_of(r)) < 12: net['roads'].remove(r)
# junctions left with a single road (their other branches lay outside the park) are road ends
for nid, n in net['nodes'].items():
    if n['kind'] == 'junction' and degree(nid) == 1 and nid.startswith(('N', 'X')):
        n.update(kind='deadend', turnRadiusM=5.5); n.pop('radius', None)
# drop unused nodes
used = {r['from'] for r in net['roads']} | {r['to'] for r in net['roads']}
for nid in list(net['nodes']):
    if nid not in used: del net['nodes'][nid]

net['comment'] = ('Gericht wegennet van het HELE park (PDF-punten, AHT_Plat.pdf p.1). Sector Receptie-West is handmatig afgesteld '
                  '(slagboomplein, TD-pad, keerlus); de overige wegen komen uit het skelet van de PDF-wegvlakken (tools/extract_roads.py). '
                  'Rijstroken, rijrichtingen, voorrang, snelheden en keerlussen zijn BEWERKBARE ONTWERPAANNAMES.')
json.dump(net, open(out, 'w'), indent=1)
print(f'{len(net["nodes"])} nodes, {len(net["roads"])} roads ({added} added from skeleton)')

# ---- 3. one-way roads: the PDF marks them with small arrows (legend "Eenrichtingsverkeer")
import os
if os.path.exists('work/oneway_arrows.json'):
    arrows = json.load(open('work/oneway_arrows.json'))
    for a in arrows:
        best = (1e9, None, 0, 0)
        for r in net['roads']:
            P = poly_of(r)
            for i in range(len(P) - 1):
                d, _ = segd(a['pt'], P[i], P[i + 1])
                tx, ty = P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]
                L = math.hypot(tx, ty) or 1e-9
                dot = (tx * a['dir'][0] + ty * a['dir'][1]) / L
                score = d + 4 * (1 - abs(dot))      # the arrow lies ALONG its road
                if score < best[0]: best = (score, r, dot, d)
        _, r, dot, d = best
        if d > 5: print('WARN: one-way arrow not on a road', a); continue
        want = 'f' if dot > 0 else 'b'
        if r.get('oneway') and r['oneway'] != want: print('WARN: conflicting arrows on', r['id'])
        r['oneway'] = want; r['laneOffsetM'] = 0.0
        r.setdefault('pdfEvidence', f"eenrichtingspijl bij {a['pt']}")
        a['road'] = r['id']
    # the arrows sample ONE continuous one-way route (west -> along the south edge -> north-east): the road pieces
    # between two consecutive arrowed roads are one-way too (shortest connection, in driving order)
    import heapq
    ordered = sorted([a for a in arrows if 'road' in a], key=lambda a: a['pt'][0])
    R = {r['id']: r for r in net['roads']}
    def head(r): return r['to'] if r['oneway'] == 'f' else r['from']
    def tail(r): return r['from'] if r['oneway'] == 'f' else r['to']
    def path(a, b):
        dist = {a: 0}; prev = {}; pq = [(0, a)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == b: break
            if d > dist[u]: continue
            for r in net['roads']:
                if r.get('oneway'): continue
                if u not in (r['from'], r['to']): continue
                v = r['to'] if r['from'] == u else r['from']
                nd = d + plen(poly_of(r))
                if nd < dist.get(v, 1e18): dist[v] = nd; prev[v] = (u, r); heapq.heappush(pq, (nd, v))
        if b not in dist or dist[b] > 120: print('  no connection', a, '->', b, dist.get(b)); return []
        out, v = [], b
        while v != a: u, r = prev[v]; out.append((r, u)); v = u
        return out[::-1]
    for a1, a2 in zip(ordered, ordered[1:]):
        r1, r2 = R[a1['road']], R[a2['road']]
        if r1 is r2: continue
        for r, frm in path(head(r1), tail(r2)):
            r['oneway'] = 'f' if r['from'] == frm else 'b'; r['laneOffsetM'] = 0.0
            r['pdfEvidence'] = 'eenrichting: verbindt twee wegen met eenrichtingspijlen (aanname)'
    json.dump(net, open(out, 'w'), indent=1)
    print('one-way roads:', [(r['id'], r['oneway']) for r in net['roads'] if r.get('oneway')])

# ---- 4. second controlled access (client, 12-10-2026): barrier on the hoofdweg at the PDF symbol (445,144) pt
net['gates'] = [g for g in net['gates'] if not g['id'].endswith('-oost') and not g.get('staff')] + [
    # inbound barrier ~12 m east of the PDF symbol (client, 12-10-2026): room for 3 waiting cars before it
    {'id': 'gate-in-oost', 'direction': 'inbound', 'road': 'hoofdweg-e', 'lane': 'forward', 'stopPt': [454.0, 146.6], 'queueSlots': 3, 'slotSpacingM': 7.2,
     'armSide': 'right', 'openSec': 3.2, 'closeSec': 3.4, 'pdfEvidence': 'Slagboomsymbool in AHT_Plat.pdf op ca. (445,144) pt; door de opdrachtgever aangewezen als tweede toegang (Oost)'},
    {'id': 'gate-out-oost', 'direction': 'outbound', 'road': 'hoofdweg-e', 'lane': 'backward', 'stopPt': [445.0, 144.6], 'queueSlots': 2, 'slotSpacingM': 7.2,
     'armSide': 'right', 'openSec': 3.2, 'closeSec': 3.4, 'note': 'bij het PDF-symbool; de inrijslagboom staat ~12 m oostelijker; geen middeneiland, dus de armen scharnieren aan de wegrand'},
]
for g in net['gates']:
    if g['id'] in ('gate-in', 'gate-out'): g['label'] = 'West'
    elif not g.get('staff'): g['label'] = 'Oost'
# ---- 4b. service lanes next to the barriers (client, 12-10-2026: service vehicles must never queue between
# check-in guests). West: a paver path leaving the toegangsweg well BEFORE the queue, across the reception forecourt
# to the TD yard and the existing TD path. Oost: through aisle 1 of the car park and a separate staff road.
if 'J_TD' not in net['nodes']:
    split_road('toegangsweg', [421.0, 184.4], 'J_TD', 'toegangsweg-2')
    r1 = next(r for r in net['roads'] if r['id'] == 'toegangsweg'); r2 = next(r for r in net['roads'] if r['id'] == 'toegangsweg-2')
    r1['id'], r2['id'] = 'toegangsweg-noord', 'toegangsweg'           # the gate lies on the second piece
    r2['gatePlaza'] = r1.pop('gatePlaza'); r2['class'] = r1['class']; r2['name'] = r1['name']
    net['nodes']['C_T'] = {'pt': net['nodes']['C_T']['pt'], 'kind': 'junction', 'radius': 4, 'note': 'TD-terrein: aansluiting TD-pad en dienstpad West (aanname)'}
    net['roads'].append({'id': 'dienstpad-west', 'name': 'Dienstpad West (langs de slagboom)', 'from': 'J_TD', 'to': 'C_T', 'class': 'service', 'speedKmh': 12, 'priority': 1, 'laneOffsetM': 1.05,
                         'surface': 'pavers', 'pts': [[417.5, 190.5], [409.0, 197.6], [399.0, 201.0], [392.0, 200.6]],
                         'note': 'alleen dienstvoertuigen; takt af voor de wachtrij van slagboom West (aanname)'})
    # toegangsweg-noord on the centre line of the PDF road (the sector network had it ~3 m too far east, over the
    # footpath next to it and into the car park)
    next(r for r in net['roads'] if r['id'] == 'toegangsweg-noord')['pts'] = [[431.4, 152.0], [429.6, 162.0], [428.7, 171.0], [426.6, 179.6]]
    # Oost (client, 12-10-2026: "a clear car park and a separate staff road"): staff and service vehicles enter the
    # car park at aisle 1 (J_P), drive through the aisle and leave at its east end on a separate staff road that
    # joins the hoofdweg-oost behind both Oost barriers. The aisle itself is drawn by the car park (hidden road).
    import plaza_layout as PL
    split_road('toegangsweg-noord', [428.7, PL.aisle_entry()[1]], 'J_P', 'toegangsweg-noord-2')
    rn = next(r for r in net['roads'] if r['id'] == 'toegangsweg-noord-2'); rn['id'] = 'toegangsweg-plein'
    net['nodes']['J_P']['radius'] = 5
    split_road('hoofdweg-oost', PL.J_SO_PT, 'J_SO', 'hoofdweg-oost-2')
    net['nodes']['J_SO']['radius'] = 5
    net['nodes']['J_LE'] = {'pt': PL.aisle_exit(), 'kind': 'junction', 'radius': 3, 'note': 'oostkant parkeerterrein: begin personeelsweg'}
    net['roads'].append({'id': 'parkeerterrein-gang', 'name': 'Rijpad parkeerterrein (doorgang personeel)', 'from': 'J_P', 'to': 'J_LE', 'class': 'service', 'speedKmh': 10, 'priority': 0, 'laneOffsetM': 1.3,
                         'hidden': True, 'pts': PL.aisle_pts(), 'note': 'rijpad 1 van het parkeerterrein; getekend door het parkeerterrein zelf'})
    net['roads'].append({'id': 'dienstweg-oost', 'name': 'Personeelsweg Oost', 'from': 'J_LE', 'to': 'J_SO', 'class': 'service', 'speedKmh': 12, 'priority': 0, 'laneOffsetM': 1.0,
                         'pts': PL.STAFF_PTS, 'note': 'alleen personeel en dienstvoertuigen; om de slagbomen Oost heen (aanname, op de lijn van het PDF-pad)'})
    # its own staff barrier (client, 12-10-2026): opens only with a logged staff pass (personeelspas), never for visitors
    net['gates'] += [
        {'id': 'gate-personeel-uit', 'direction': 'outbound', 'staff': True, 'road': 'dienstweg-oost', 'lane': 'forward', 'stopPt': [470.3, 169.2], 'queueSlots': 1, 'slotSpacingM': 7.0,
         'armSide': 'right', 'openSec': 3.0, 'closeSec': 3.2, 'label': 'Personeel', 'note': 'personeelsslagboom, richting hoofdweg'},
        {'id': 'gate-personeel-in', 'direction': 'inbound', 'staff': True, 'road': 'dienstweg-oost', 'lane': 'backward', 'stopPt': [471.0, 167.0], 'queueSlots': 1, 'slotSpacingM': 7.0,
         'armSide': 'right', 'openSec': 3.0, 'closeSec': 3.2, 'label': 'Personeel', 'note': 'personeelsslagboom, richting parkeerterrein'},
    ]

# ---- 5. service entrances: emergency exits used by service vehicles (visitors only enter/leave at the Ingang P_W)
SERVICE = {'X30_24': ('P_SVC_O', 'Dienstingang Paardelandsedrift'), 'X55_4': ('P_SVC_Z', 'Dienstingang zuidoost')}
for old, (new, label) in SERVICE.items():
    if old not in net['nodes']: print('WARN: service entrance node missing', old); continue
    n = net['nodes'].pop(old); net['nodes'][new] = {'pt': n['pt'], 'kind': 'portal', 'portal': 'service', 'label': label, 'note': 'nooduitgang uit de PDF, gebruikt als dienstingang (aanname)'}
    for r in net['roads']:
        if r['from'] == old: r['from'] = new
        if r['to'] == old: r['to'] = new
json.dump(net, open(out, 'w'), indent=1)
print('gates', [g['id'] for g in net['gates']], 'portals', [k for k, v in net['nodes'].items() if v['kind'] == 'portal'])
