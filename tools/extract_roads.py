"""Trace the car-road centre lines of the whole park from AHT_Plat.pdf.
Road surfaces have one exact fill colour; the mask is closed (labels, stall lines), skeletonised, and turned into a graph
of junction/end nodes and polylines (PDF points). Short spurs (parking strips, label remnants) are pruned.
This is spatial EVIDENCE for the editable road network, not the network itself: lanes, directions and priorities are
added in data/map/park_road_network.json.
Usage: pdftoppm -r 300 -png references/AHT_Plat.pdf work/p300 && python3 tools/extract_roads.py work/p300-1.png work/road_skeleton.json"""
import sys, json, math
import numpy as np, cv2
from PIL import Image
from skimage.morphology import skeletonize

Image.MAX_IMAGE_PIXELS = None
src, out = sys.argv[1], sys.argv[2]
im = np.array(Image.open(src).convert('RGB')).astype(np.int16)
k = im.shape[1] / 841.89                       # px per PDF point
MAP_BOTTOM = int(0.715 * im.shape[0])           # legend strip below the map
road = (np.abs(im - np.array((234, 246, 217))).sum(axis=2) < 12)
road[MAP_BOTTOM:] = False
road = road.astype(np.uint8)
# close gaps from labels / stall lines / house symbols drawn on the asphalt
road = cv2.morphologyEx(road, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
# drop isolated blobs (building courtyards, legend boxes) smaller than ~150 pt^2
n, lab, stats, _ = cv2.connectedComponentsWithStats(road, 8)
keep = np.zeros(n, bool); keep[1:] = stats[1:, cv2.CC_STAT_AREA] > 150 * k * k
road = keep[lab].astype(np.uint8)
# remove thin necks (< ~2 pt wide, e.g. footpath joints in road colour) before skeletonising
road = cv2.morphologyEx(road, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
dist = cv2.distanceTransform(road, cv2.DIST_L2, 5)
sk = skeletonize(road > 0)

H, W = sk.shape
nbr = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
pts = set(zip(*np.nonzero(sk)))
def neigh(p):
    return [(p[0] + a, p[1] + b) for a, b in nbr if (p[0] + a, p[1] + b) in pts]
deg = {p: len(neigh(p)) for p in pts}
nodes_px = {p for p, d in deg.items() if d != 2}
# merge node pixels that touch into one node (junction blobs)
node_id, nodes = {}, []
for p in nodes_px:
    if p in node_id: continue
    stack, comp = [p], []
    node_id[p] = len(nodes)
    while stack:
        q = stack.pop(); comp.append(q)
        for r in neigh(q):
            if r in nodes_px and r not in node_id: node_id[r] = len(nodes); stack.append(r)
    cy = sum(c[0] for c in comp) / len(comp); cx = sum(c[1] for c in comp) / len(comp)
    nodes.append({'px': (cy, cx), 'pix': comp})
# walk edges
seen = set(); edges = []
for ni, nd in enumerate(nodes):
    for p in nd['pix']:
        for q in neigh(p):
            if q in nodes_px or (p, q) in seen: continue
            path = [p, q]; seen.add((p, q)); prev, cur = p, q
            while cur not in nodes_px:
                nx = [r for r in neigh(cur) if r != prev and (cur, r) not in seen]
                if not nx: break
                seen.add((cur, nx[0])); prev, cur = cur, nx[0]; path.append(cur)
            if cur in nodes_px:
                seen.add((path[-1], path[-2]))
                edges.append({'a': ni, 'b': node_id[cur], 'path': path})

def length(path): return sum(math.dist(path[i], path[i + 1]) for i in range(len(path) - 1)) / k
# iteratively prune short dead-end spurs (< 9 pt) - parking strips, label remnants
for _ in range(6):
    degc = {}
    for e in edges: degc[e['a']] = degc.get(e['a'], 0) + 1; degc[e['b']] = degc.get(e['b'], 0) + 1
    before = len(edges)
    edges = [e for e in edges if not ((degc[e['a']] == 1 or degc[e['b']] == 1) and e['a'] != e['b'] and length(e['path']) < 9)]
    if len(edges) == before: break
edges = [e for e in edges if not (e['a'] == e['b'] and length(e['path']) < 6)]

def simplify(path):
    a = np.array([[c[1] / k, c[0] / k] for c in path], np.float32).reshape(-1, 1, 2)
    s = cv2.approxPolyDP(a, 0.35, False).reshape(-1, 2)
    return [[round(float(x), 1), round(float(y), 1)] for x, y in s]
used = sorted({e['a'] for e in edges} | {e['b'] for e in edges})
remap = {o: i for i, o in enumerate(used)}
degf = {}
for e in edges: degf[e['a']] = degf.get(e['a'], 0) + 1; degf[e['b']] = degf.get(e['b'], 0) + 1
res = {
    'source': 'AHT_Plat.pdf page 1, road fill colour (234,246,217), 300 dpi skeleton',
    'nodes': [{'id': remap[o], 'pt': [round(nodes[o]['px'][1] / k, 1), round(nodes[o]['px'][0] / k, 1)], 'degree': degf[o]} for o in used],
    'edges': [{'a': remap[e['a']], 'b': remap[e['b']], 'lengthPt': round(length(e['path']), 1),
               'widthPt': round(float(np.median([dist[c] for c in e['path']])) * 2 / k, 1), 'pts': simplify(e['path'])} for e in edges],
}
json.dump(res, open(out, 'w'))
print(f"{len(res['nodes'])} nodes, {len(res['edges'])} edges, total {sum(e['lengthPt'] for e in res['edges']):.0f} pt")
