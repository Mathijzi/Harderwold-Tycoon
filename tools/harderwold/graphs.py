"""Hartlijnen-netwerk uit een masker (gebruikt voor de vaarroutes in de grachten en de golfpaden).
graph(mask, step) -> {'nodes': [[x, y], ...], 'edges': [{'a': i, 'b': j, 'pts': [[x, y], ...], 'w': [halve breedte in pt]}]}
Coordinaten in pt (pixels van het volle raster)."""
import math
import numpy as np
from scipy import ndimage as ndi


def thin(img):
    """Zhang-Suen verdunning"""
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
            c = ((p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0)) if step == 0 else ((p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0))
            m = (img == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if m.any():
                img[m] = 0; changed = True
        if not changed:
            return img.astype(bool)


def _dp(pts, tol):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float)
    ab = b - a; L = np.hypot(*ab); P = np.array(pts, float)
    d = np.abs(np.cross(ab, P - a)) / L if L > 1e-9 else np.hypot(*(P - a).T)
    i = int(np.argmax(d))
    if d[i] <= tol: return [pts[0], pts[-1]]
    return _dp(pts[:i + 1], tol)[:-1] + _dp(pts[i:], tol)


def graph(mask, step=4, min_spur=40.0, tol=3.0):
    """skeleton graph of `mask` (full resolution), worked out at 1/step resolution; spurs shorter than min_spur pt
    (ending in a dead end) are removed repeatedly, chains are simplified with tolerance `tol` pt"""
    h, w = mask.shape
    m = mask[:h // step * step, :w // step * step].reshape(h // step, step, w // step, step).mean((1, 3)) > 0.5
    m = ndi.binary_opening(m, iterations=1)
    dist = ndi.distance_transform_edt(m) * step
    sk = thin(m)
    pix = set(zip(*np.nonzero(sk)))
    nbrs = lambda p: [(p[0] + dy, p[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (p[0] + dy, p[1] + dx) in pix]

    def chains():
        deg = {p: len(nbrs(p)) for p in pix}
        special = {p for p, d in deg.items() if d != 2}
        out, seen = [], set()
        for p in special:
            for q in nbrs(p):
                if (p, q) in seen: continue
                path = [p, q]; prev, cur = p, q
                while cur not in special:
                    nx = [r for r in nbrs(cur) if r != prev and r not in path[-3:]]
                    if not nx: break
                    prev, cur = cur, nx[0]; path.append(cur)
                seen.add((p, q)); seen.add((path[-1], path[-2]))
                out.append(path)
        return out, deg

    # prune short spurs (ends of the skeleton in the corners of a canal)
    for _ in range(6):
        cs, deg = chains()
        cut = False
        for c in cs:
            ln = sum(math.hypot(c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1]) for i in range(len(c) - 1)) * step
            if ln < min_spur and (deg.get(c[0]) == 1 or deg.get(c[-1]) == 1) and not (deg.get(c[0]) == 1 and deg.get(c[-1]) == 1 and ln > min_spur / 2):
                for p in c:
                    if deg.get(p, 0) <= 2 or p in (c[0], c[-1]) and deg.get(p) == 1: pix.discard(p)
                cut = True
        if not cut: break
    cs, deg = chains()
    # nodes: cluster the junction / end pixels
    special = sorted({p for c in cs for p in (c[0], c[-1])})
    node_of, nodes = {}, []
    for p in special:
        hit = next((i for i, q in enumerate(nodes) if math.hypot(q[0] - p[1] * step, q[1] - p[0] * step) < 3 * step), None)
        if hit is None:
            nodes.append([p[1] * step + step / 2, p[0] * step + step / 2]); hit = len(nodes) - 1
        node_of[p] = hit
    edges, keyset = [], set()
    for c in cs:
        a, b = node_of[c[0]], node_of[c[-1]]
        if a == b and len(c) < 8: continue
        pts = [[p[1] * step + step / 2, p[0] * step + step / 2] for p in c]
        k = (min(a, b), max(a, b), round(sum(p[0] for p in pts)))
        if k in keyset: continue
        keyset.add(k)
        simp = _dp(pts, tol)
        wid = [float(dist[min(h // step - 1, int(p[1] // step)), min(w // step - 1, int(p[0] // step))]) for p in simp]
        edges.append({'a': a, 'b': b, 'pts': [[round(x, 1), round(y, 1)] for x, y in simp], 'w': [round(v, 1) for v in wid]})
    return _clean(nodes, edges, short=3.5 * step)


def _len(pts):
    return sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))


def _clean(nodes, edges, short):
    """merge nodes joined by very short edges, drop self-loops and duplicate edges, renumber"""
    parent = list(range(len(nodes)))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for e in edges:
        if e['a'] != e['b'] and _len(e['pts']) < short: parent[find(e['a'])] = find(e['b'])
    groups = {}
    for i in range(len(nodes)): groups.setdefault(find(i), []).append(i)
    newid, newnodes = {}, []
    for root, members in groups.items():
        newid[root] = len(newnodes)
        newnodes.append([sum(nodes[m][0] for m in members) / len(members), sum(nodes[m][1] for m in members) / len(members)])
    best = {}
    for e in edges:
        a, b = newid[find(e['a'])], newid[find(e['b'])]
        L = _len(e['pts'])
        if a == b and L < 20 * short: continue
        if a != b and L < short: continue
        pts = [newnodes[a]] + e['pts'][1:-1] + [newnodes[b]]
        k = (min(a, b), max(a, b))
        if k not in best or _len(best[k]['pts']) > L: best[k] = {'a': a, 'b': b, 'pts': pts, 'w': e['w']}
    used = sorted({i for e in best.values() for i in (e['a'], e['b'])})
    remap = {o: n for n, o in enumerate(used)}
    out = [{'a': remap[e['a']], 'b': remap[e['b']], 'pts': [[round(x, 1), round(y, 1)] for x, y in e['pts']], 'w': e['w']} for e in best.values()]
    return {'nodes': [[round(newnodes[o][0], 1), round(newnodes[o][1], 1)] for o in used], 'edges': out}
