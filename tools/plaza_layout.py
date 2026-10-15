"""Designed layout of the central car park and the staff road (client, 12-10-2026: "a clear car park and a separate
staff road"). The PDF shows one big paved area here (plaza + car park + forecourt); the simulation map gets:
  - a rectangular car park (P-plein) in the orientation of the Sports Arena, 4 rows of stalls, 2 aisles, EV stalls,
    with a green verge to the toegangsweg; entrance/exit on the toegangsweg at aisle 1 (node J_P)
  - a separate staff road from the east end of aisle 1 to the hoofdweg-oost (on the line of the PDF path there)
All in PDF points. Used by build_park.py (terrain, park.json "parkingLot") and build_park_network.py (roads).
Usage (patch an existing park.json in place): python3 tools/plaza_layout.py data/map/park.json"""
import math, json, sys

LOT = {
    'id': 'P-plein', 'name': 'Parkeerterrein centrum',
    'origin': [435.0, 163.4], 'angleDeg': 7.3, 'lengthPt': 32.0, 'depthPt': 24.6, 'cornerPt': 1.8,
    # rows across the depth (v, PDF points); nose = direction the parked car faces (-1 north, +1 south)
    'rows': [{'v0': 0.3, 'v1': 4.0, 'nose': -1}, {'v0': 8.6, 'v1': 12.3, 'nose': 1},
             {'v0': 12.3, 'v1': 16.0, 'nose': -1}, {'v0': 20.6, 'v1': 24.3, 'nose': 1}],
    'stallU0': 1.8, 'stallWidthPt': 2.0, 'stalls': 13,
    'aisles': [6.3, 18.3],                 # centre lines of the aisles (v); aisle 1 = entrance and staff through-route
    'ev': {'row': 0, 'count': 4},          # EV charging stalls at the east end of row A (PDF: charging symbol)
    'note': 'Ontwerpaanname: de PDF toont hier één groot verhard vlak met P en laadpaal-symbool. Indeling, aantal vakken en de personeelsweg zijn bewerkbaar.',
}
STAFF_PTS = [[469.4, 171.2], [471.6, 165.6], [473.3, 159.6]]   # staff road J_LE -> J_SO (line of the PDF path)
J_SO_PT = [474.5, 154.2]

def _uv():
    a = math.radians(LOT['angleDeg']); return (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
def pt(u, v):
    (ux, uy), (vx, vy) = _uv(); o = LOT['origin']
    return [round(o[0] + ux * u + vx * v, 2), round(o[1] + uy * u + vy * v, 2)]
def outline():
    L, D, r = LOT['lengthPt'], LOT['depthPt'], LOT['cornerPt']; out = []
    for cu, cv, a0 in [(L - r, r, -90), (L - r, D - r, 0), (r, D - r, 90), (r, r, 180)]:
        for k in range(7):
            a = math.radians(a0 + k * 15); out.append(pt(cu + r * math.cos(a), cv + r * math.sin(a)))
    return out
def aisle_entry(): return pt(0, LOT['aisles'][0])
def aisle_exit(): return pt(LOT['lengthPt'], LOT['aisles'][0])
def aisle_pts(): return [pt(1.5, LOT['aisles'][0]), pt(LOT['lengthPt'] - 3.5, LOT['aisles'][0])]

def apply(park):
    """Replace the PDF plaza surface by the designed car park (idempotent)."""
    from shapely.geometry import Polygon
    t = park['terrain']
    plaza = [P for P in t['roadSurfaces'] if Polygon(P).buffer(0).contains(Polygon([[449, 175], [451, 175], [451, 177]]))]
    keep = [P for P in t['roadSurfaces'] if P not in plaza
            # leftovers along the toegangsweg West: the PDF road lies ~2 m north of the modelled one (strip above the road)
            # and the forecourt band below it
            and not (360 <= min(q[0] for q in P) and max(q[0] for q in P) <= 431 and 176 <= min(q[1] for q in P) and max(q[1] for q in P) <= 228)
            and not (449 <= min(q[0] for q in P) and max(q[0] for q in P) <= 481 and 186 <= min(q[1] for q in P) and max(q[1] for q in P) <= 246)
            # leftover sliver of the toegangsweg-noord (the road network draws that road itself)
            and not (424 <= min(q[0] for q in P) and max(q[0] for q in P) <= 433 and 145 <= min(q[1] for q in P) and max(q[1] for q in P) <= 182)]
    # the PDF plaza itself is replaced by the designed car park (parkingLot); its forecourt band south of the
    # toegangsweg and the strip behind the shops are dropped (client, 12-10-2026: no extra strips beside the road)
    t['roadSurfaces'] = keep
    # the PDF path between the car park and the hoofdweg becomes the staff road
    t['footpaths'] = [P for P in t['footpaths'] if not (468 <= min(q[0] for q in P) and max(q[0] for q in P) <= 476 and 154 <= min(q[1] for q in P) and max(q[1] for q in P) <= 169)]
    lot = dict(LOT); lot['outline'] = outline()
    park['parkingLot'] = lot
    return park

if __name__ == '__main__':
    p = sys.argv[1]; d = json.load(open(p)); apply(d); json.dump(d, open(p, 'w'), indent=1)
    print('parkeerterrein', LOT['id'], 'vakken', LOT['stalls'] * len(LOT['rows']), 'wegvlakken', len(d['terrain']['roadSurfaces']))
