"""Assemble the WHOLE-PARK map file from: house manifest, raster segmentation, PDF vector footprints, the PDF parking
strips and the park road network (for parking-cluster generation).
Usage: pdftoppm -r 500 -png references/AHT_Plat.pdf work/hi && python3 tools/segment_sector.py 186 4 660 400 work/seg_park.json work/hi-1.png
       python3 tools/build_park.py data/map/aelderholt_manifest.json work/seg_park.json data/map/park.json"""
import json, sys, pdfplumber, math
man=json.load(open(sys.argv[1])); seg=json.load(open(sys.argv[2])); out=sys.argv[3]
VIEW=[186,4,660,400]             # whole park in PDF points (fits 16:9 after the camera tilt)
MARGIN=VIEW
inm=lambda x,y: MARGIN[0]<=x<=MARGIN[2] and MARGIN[1]<=y<=MARGIN[3]
P=seg['polygons']
def bbox(pts): xs=[p[0] for p in pts]; ys=[p[1] for p in pts]; return min(xs),min(ys),max(xs),max(ys)
def is_house_square(p):
    x0,y0,x1,y1=bbox(p['pts']); return len(p['pts'])<=6 and 20<p['areaPt2']<40 and (x1-x0)<10 and (y1-y0)<10
# Terrain polygons straight from the segmentation masks. Polygons must not contain holes (a ring-shaped path would be
# filled completely), so every hole is opened with a 1-pixel slit towards the outside first - invisible at map scale.
import numpy as np, cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
X0, Y0, X1, Y1 = seg['bboxPts']
segbase = sys.argv[2].replace('.json', '')
def mask_of(name): return (np.array(Image.open(f'{segbase}_{name}.png')) > 0).astype(np.uint8)
def polys_without_holes(m, min_area, simplify=0.25):
    k = m.shape[1] / (X1 - X0)
    m = m.copy()
    cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is not None:
        for c, h in zip(cs, hier[0]):
            if h[3] < 0: continue                       # outer contour
            x, y = min(((p[0][0], p[0][1]) for p in c), key=lambda q: q[1])
            yy = y - 1
            while yy >= 0 and m[yy, x]: m[yy, x] = 0; yy -= 1
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cs:
        if cv2.contourArea(c) / (k * k) < min_area: continue
        ap = cv2.approxPolyDP(c, simplify * k, True)
        out.append([[round(X0 + q[0][0] / k, 2), round(Y0 + q[0][1] / k, 2)] for q in ap])
    return out
water = [p for p in polys_without_holes(mask_of('water'), 8) if not is_house_square({'pts': p, 'areaPt2': 30 if len(p) <= 6 else 99})]
foot = polys_without_holes(mask_of('footpath'), 3)
# road surfaces: only what the road network does not draw itself (plaza, parking areas, wide spots)
roadm = mask_of('road')
kk = roadm.shape[1] / (X1 - X0)
netm = np.zeros_like(roadm)
rn = json.load(open('data/map/park_road_network.json'))
for r in rn['roads']:
    pts = [rn['nodes'][r['from']]['pt']] + r['pts'] + [rn['nodes'][r['to']]['pt']]
    q = np.array([[(x - X0) * kk, (y - Y0) * kk] for x, y in pts], np.int32)
    cv2.polylines(netm, [q], False, 1, thickness=int((1.2 if r.get('oneway') else 2.2) * 2 / 1.3 * kk))
for nid, nd in rn['nodes'].items():
    x, y = nd['pt']
    rad = (nd.get('turnRadiusM', 0) + 1.8) / 1.3 if nd['kind'] == 'deadend' else (nd.get('radius', 6) * 0.9) / 1.3
    cv2.circle(netm, (int((x - X0) * kk), int((y - Y0) * kk)), int(rad * kk), 1, -1)
rem = cv2.morphologyEx(roadm & (1 - netm), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(1.2 * kk), int(1.2 * kk))))
road = polys_without_holes(rem, 25)
# keep only real paved areas (public roads around the park, plaza, parking, service strip); the small leftovers along
# junctions and bends would show up as grey bulges next to the roads
def _area(P): return abs(sum(P[i][0] * P[(i + 1) % len(P)][1] - P[(i + 1) % len(P)][0] * P[i][1] for i in range(len(P)))) / 2
def _in_plaza(P): cx = sum(q[0] for q in P) / len(P); cy = sum(q[1] for q in P) / len(P); return 415 <= cx <= 475 and 150 <= cy <= 205
road = [P for P in road if _area(P) >= 170 or _in_plaza(P)]
# vector footprints from PDF (filled light-green with black outline) + fields
import os
pg=pdfplumber.open(os.environ.get('AHT_PDF','references/AHT_Plat.pdf')).pages[0]
fps=[]
for s in pg.curves+pg.rects:
    if s.get('stroking_color')!=(0.0,0.0,0.0,1.0) or not s.get('stroke'): continue
    if not (MARGIN[0]<s['x0'] and s['x1']<MARGIN[2] and MARGIN[1]<s['top'] and s['bottom']<MARGIN[3]): continue
    w=s['x1']-s['x0']; h=s['bottom']-s['top']
    if w<6 and h<6: continue
    pts=[[round(x,2),round(y,2)] for x,y in (s.get('pts') or [])]
    if len(pts)<3: continue
    fps.append(dict(bbox=[round(s['x0'],1),round(s['top'],1),round(s['x1'],1),round(s['bottom'],1)],pts=pts,filled=bool(s.get('fill'))))
facs=[f for f in man['facilities'] if inm(f['x'],f['y'])]
def fac_in(b):
    return [f['key'] for f in facs if b[0]<=f['x']<=b[2] and b[1]<=f['y']<=b[3]]
LEG={'A':'Receptie','B1':'Bollo Club','B2':'Bollohuis','C':'Bowlingbaan','D':'Atelier','E':'Beachvolleybalveld','F':'Beautysalon','G':'De Brasserie','H':'De Snackbar','I':'Serviceruimte','J':'Zwembad','K':'Squash','L':'Skyflyer','M':'Wasserette','O':'Sports Arena','Q':'Tennisbanen','R':'Sportveld','S':'Speelplaats','S1':'Speeltuin en airtrampoline','S2':'Buitenpodium','T':'Indoorspeelparadijs','U':'Adventure Golf','V':'ParkShop','W':'Bikes & More fietsverhuur','X':'Hondentoilet','Y':'De Tent','Z':'Outdoor area'}
structures=[]
hpts=[(h['pdf']['x'],h['pdf']['y']) for h in man['houses']]
for f in fps:
    b=f['bbox']; cx=(b[0]+b[2])/2; cy=(b[1]+b[3])/2
    if max(b[2]-b[0],b[3]-b[1])<9 and any(math.hypot(cx-x,cy-y)<6 for x,y in hpts): continue
    keys=fac_in(f['bbox'])
    kind='field' if set(keys)&{'Q','R','E'} and not set(keys)&{'A','J','T','G','V'} else 'building'
    if kind=='building' and not (f['filled'] or set(keys)&{'O','Y'}): continue
    style=dict(heightM=7.0,roof='flat')
    if set(keys)&{'J','W'}: style=dict(heightM=8.5,roof='flat',name='Zwembad & receptie')
    elif set(keys)&{'V','F','M','I'}: style=dict(heightM=6.0,roof='flat',name='ParkShop-vleugel')
    elif set(keys)&{'G','H','K'}: style=dict(heightM=7.5,roof='flat',name='Brasserie & bowling')
    elif 'O' in keys: style=dict(heightM=9.0,roof='flat',name='Sports Arena')
    elif 'Y' in keys: style=dict(heightM=4.5,roof='tent',name='De Tent')
    if kind=='field': style=dict(heightM=0,roof='none',name='Sportveld' if 'R' in keys else 'Tennisbanen')
    structures.append(dict(kind=kind,facilities=keys,bbox=f['bbox'],pts=f['pts'],**style))
houses=[]
for h in man['houses']:
    x,y=h['pdf']['x'],h['pdf']['y']
    if inm(x,y):
        houses.append(dict(id=h['id'],number=h['number'],pt=[x,y],legendType=h['legendType'],typeConfidence=h['typeConfidence'],
                           pdfRotationDeg=h.get('rotationDeg'),petsAllowed=h.get('petsAllowed',False),footprintPts=h.get('footprintPts')))
# ---- parking: the hand-tuned clusters of the prototype sector stay; every other house gets a stall in the nearest
# PDF parking strip (or, without a strip nearby, at the road next to the house). Order/assignment is an ASSUMPTION.
SECTOR_CLUSTERS=[
    dict(id='P-W1',kind='house',pt=[338.8,203.6],stalls=5,serves=[165,166,167,168],pdfEvidence='PDF-parkeerstroken bij (340,214) pt in de bocht bij J_W; 10 pt noordelijker gelegd (aanname). Laatste vak = dienstvak.'),
    dict(id='P-W2',kind='house',pt=[349.9,170.4],stalls=4,serves=[169,170,171],pdfEvidence='parkeerstroken bij (350,170) pt. Laatste vak = dienstvak.'),
    dict(id='P-W3',kind='house',pt=[366.5,148.6],stalls=3,serves=[172,173,174],pdfEvidence='aanname: geen strook zichtbaar bij keerlus'),
    dict(id='TD',kind='depot',pt=[383.6,209.5],stalls=2,serves=[],stall=dict(rt=2.6,straight=3.2,width=2.4,vehLen=2.8,vehWid=1.35),pdfEvidence='AANNAME: TD-post naast de receptie aan de servicestrook langs de westgevel'),
]
taken={n for c in SECTOR_CLUSTERS for n in c['serves']}
strips=json.load(open('work/parking_strips.json'))
def centre(q): return [sum(p[0] for p in q)/len(q), sum(p[1] for p in q)/len(q)]
spots=[dict(pt=centre(st['quad']),houses=[],src='strip') for st in strips]
# strips inside the hand-tuned sector belong to its clusters
spots=[sp for sp in spots if not (330<sp['pt'][0]<372 and 140<sp['pt'][1]<222)]
for h in man['houses']:
    n=h['number']
    if n in taken: continue
    x,y=h['pdf']['x'],h['pdf']['y']
    best=min(spots,key=lambda sp: math.hypot(sp['pt'][0]-x,sp['pt'][1]-y)) if spots else None
    if best and math.hypot(best['pt'][0]-x,best['pt'][1]-y)<14: best['houses'].append(n)
    else: spots.append(dict(pt=[x,y],houses=[n],src='house'))
spots=[sp for sp in spots if sp['houses']]
# merge spots that lie close together (their stalls would overlap along the same lane)
merged=True
while merged:
    merged=False
    for i in range(len(spots)):
        for j in range(i+1,len(spots)):
            a,b=spots[i],spots[j]
            if math.hypot(a['pt'][0]-b['pt'][0],a['pt'][1]-b['pt'][1])<7.5:
                na,nb=len(a['houses']),len(b['houses'])
                a['pt']=[(a['pt'][0]*na+b['pt'][0]*nb)/(na+nb),(a['pt'][1]*na+b['pt'][1]*nb)/(na+nb)]
                a['houses']+=b['houses']; a['src']='strip' if 'strip' in (a['src'],b['src']) else 'house'
                del spots[j]; merged=True; break
        if merged: break
gen=[]
for i,sp in enumerate(sorted(spots,key=lambda s:(round(s['pt'][1]/20),s['pt'][0]))):
    gen.append(dict(id=f'P{i+1:03d}',kind='house',pt=[round(sp['pt'][0],1),round(sp['pt'][1],1)],stalls=len(sp['houses']),serves=sorted(sp['houses']),
                    pdfEvidence='PDF-parkeerstrook' if sp['src']=='strip' else 'geen strook in de PDF bij dit huis: vak aan de weg (aanname)'))
data=dict(
  id='park-aelderholt', name='Landal Aelderholt (volledig park)',
  source=dict(file='AHT_Plat.pdf',page=1,legendDate='01.10.2025'),
  viewPts=VIEW, originPt=[VIEW[0],VIEW[1]], metersPerPt=1.3,
  assumptions=[
    'Schaal 1 pt = 1,3 m geschat uit wegbreedte en huisgrootte (PDF heeft geen schaalbalk).',
    'Wegennet uit het skelet van de PDF-wegvlakken; rijstroken, voorrang, snelheden en keerlussen zijn ontwerpaannames. Eenrichtingsverkeer volgens de pijlen in de PDF; tussenliggende stukken zijn aangenomen.',
    'Twee gecontroleerde toegangen (opdrachtgever, 12-10-2026): slagboom West op de toegangsweg bij (373,192) pt en slagboom Oost op de hoofdweg bij (445,144) pt. Hoofdweg vanaf de Ingang, plein en parkeerterrein zijn vrij toegankelijk.',
    'Nooduitgangen naar de Paardelandsedrift en de Gelpenberg zijn geen autoroutes; de wegen eindigen daar.',
    'Parkeren: elk huis een vak in de dichtstbijzijnde PDF-parkeerstrook (of aan de weg als er geen strook is); toewijzing is een aanname.',
    'Gebouwhoogtes en daakvormen van het centrumgebouw zijn artistieke aannames.'
  ],
  terrain=dict(water=water,footpaths=foot,roadSurfaces=road),
  structures=structures,
  facilities=[dict(key=f['key'],name=LEG.get(f['key'],f['key']),pt=[f['x'],f['y']]) for f in facs],
  houses=houses,
  parkingClusters=SECTOR_CLUSTERS+gen,
  staticBarriers=[]
)
# editable building massing (hand-derived from the PDF walls, see data/map/massing_central.json)
mpath=os.path.join(os.path.dirname(out),'massing_central.json')
if os.path.exists(mpath): data['massing']=json.load(open(mpath))
# designed car park + staff road instead of the single PDF plaza surface (tools/plaza_layout.py)
import plaza_layout; plaza_layout.apply(data)
json.dump(data,open(out,'w'),indent=1)
print('water',len(water),'foot',len(foot),'road',len(road),'structures',len(structures),'houses',len(houses),'facs',len(facs),'parking clusters',len(data['parkingClusters']),'stalls',sum(c['stalls'] for c in data['parkingClusters']))
