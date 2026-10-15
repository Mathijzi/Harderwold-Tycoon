"""Assemble the prototype sector data file from: house manifest, raster segmentation and PDF vector footprints.
Usage: python3 tools/build_sector.py <manifest.json> <segmentation.json> <out.json>"""
import json, sys, pdfplumber, math
man=json.load(open(sys.argv[1])); seg=json.load(open(sys.argv[2])); out=sys.argv[3]
VIEW=[305,122,492,260]           # visible sector in PDF points (16:9 after 50deg tilt)
MARGIN=[296,116,504,270]
inm=lambda x,y: MARGIN[0]<=x<=MARGIN[2] and MARGIN[1]<=y<=MARGIN[3]
P=seg['polygons']
def bbox(pts): xs=[p[0] for p in pts]; ys=[p[1] for p in pts]; return min(xs),min(ys),max(xs),max(ys)
def is_house_square(p):
    x0,y0,x1,y1=bbox(p['pts']); return len(p['pts'])<=6 and 20<p['areaPt2']<40 and (x1-x0)<10 and (y1-y0)<10
water=[p['pts'] for p in P['water'] if not is_house_square(p) and p['areaPt2']>8]
foot=[p['pts'] for p in P['footpath'] if p['areaPt2']>3]
road=[p['pts'] for p in P['road'] if p['areaPt2']>12]
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
data=dict(
  id='sector-receptie-west', name='Prototype-sector Receptie-West',
  source=dict(file='AHT_Plat.pdf',page=1,legendDate='01.10.2025'),
  viewPts=VIEW, originPt=[VIEW[0],VIEW[1]], metersPerPt=1.3,
  assumptions=[
    'Schaal 1 pt = 1,3 m geschat uit wegbreedte en huisgrootte (PDF heeft geen schaalbalk).',
    'Rijstrookligging, rijrichtingen, voorrang, snelheden en keerlusstraal zijn ontwerpaannames (niet in PDF).',
    'Gecontroleerde toegang = slagboom op de noord-zuidweg bij (373,192) pt; inrijdend en uitrijdend gescheiden met middeneiland (verbreding aan westzijde i.v.m. sloot).',
    'Hoofdweg west van de toegangsweg wordt als openbare aanrijroute behandeld; tweede PDF-slagboom (hoofdweg bij 445,144 pt) is in het prototype statisch decor.',
    'Parkeerclusters volgen de PDF-parkeerstroken; toewijzing huis -> vak is een aanname.',
    'Gebouwhoogtes en daakvormen van het centrumgebouw zijn artistieke aannames.'
  ],
  terrain=dict(water=water,footpaths=foot,roadSurfaces=road),
  structures=structures,
  facilities=[dict(key=f['key'],name=LEG.get(f['key'],f['key']),pt=[f['x'],f['y']]) for f in facs],
  houses=houses,
  parkingClusters=[
    dict(id='P-W1',kind='house',pt=[338.8,203.6],stalls=5,serves=[165,166,167,168],pdfEvidence='PDF-parkeerstroken bij (340,214) pt in de bocht bij J_W; 10 pt noordelijker gelegd (aanname). Laatste vak = dienstvak.'),
    dict(id='P-W2',kind='house',pt=[349.9,170.4],stalls=4,serves=[169,170,171],pdfEvidence='parkeerstroken bij (350,170) pt. Laatste vak = dienstvak.'),
    dict(id='P-W3',kind='house',pt=[366.5,148.6],stalls=3,serves=[172,173,174],pdfEvidence='aanname: geen strook zichtbaar bij keerlus'),
    dict(id='TD',kind='depot',pt=[383.6,209.5],stalls=2,serves=[],stall=dict(rt=2.6,straight=3.2,width=2.4,vehLen=2.8,vehWid=1.35),pdfEvidence='AANNAME: TD-post naast de receptie aan de servicestrook langs de westgevel'),
  ],
  staticBarriers=[dict(id='barrier-hoofdweg-oost',pt=[445.0,144.0],note='PDF-slagboom op hoofdweg; niet gemodelleerd in prototype')]
)
# editable building massing (hand-derived from the PDF walls, see data/map/massing_central.json)
mpath=os.path.join(os.path.dirname(out),'massing_central.json')
if os.path.exists(mpath): data['massing']=json.load(open(mpath))
json.dump(data,open(out,'w'),indent=1)
print('water',len(water),'foot',len(foot),'road',len(road),'structures',[(s['kind'],s['facilities'],s.get('name')) for s in structures],'houses',len(houses),'facs',len(facs))
