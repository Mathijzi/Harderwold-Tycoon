"""Extract house numbers, positions, orientation and legend type from AHT_Plat.pdf.
Output: JSON manifest (uncertain fields flagged). Coordinates are PDF points (page 1) and normalized.
Usage: AHT_PDF=references/AHT_Plat.pdf python3 tools/extract_manifest.py data/map/aelderholt_manifest.json"""
import pdfplumber, json, math, sys, re
import os
PDF=os.environ.get('AHT_PDF','references/AHT_Plat.pdf')
p=pdfplumber.open(PDF); pg=p.pages[0]; W,H=pg.width,pg.height
MAP_BOTTOM=0.70*H  # legend strip below
chars=[c for c in pg.chars if c['text'].strip()]
def ctr(c): return ((c['x0']+c['x1'])/2,(c['top']+c['bottom'])/2)
digs=[c for c in chars if c['text'].isdigit() and ctr(c)[1]<MAP_BOTTOM]
# rotation from text matrix
def ang(c):
    a,b=c['matrix'][0],c['matrix'][1]; return math.atan2(b,a)
# cluster: union-find on distance & same angle
n=len(digs); par=list(range(n))
def f(i):
    while par[i]!=i: par[i]=par[par[i]]; i=par[i]
    return i
for i in range(n):
    xi,yi=ctr(digs[i])
    for j in range(i+1,n):
        if abs(ang(digs[i])-ang(digs[j]))>0.05: continue
        xj,yj=ctr(digs[j]); s=digs[i]['size']
        if math.hypot(xi-xj,yi-yj)<s*0.75: par[f(i)]=f(j)
groups={}
for i in range(n): groups.setdefault(f(i),[]).append(digs[i])
labels=[]
for g in groups.values():
    a=ang(g[0]); dx,dy=math.cos(a),-math.sin(a)  # reading direction in page coords (y down)
    g.sort(key=lambda c: ctr(c)[0]*dx+ctr(c)[1]*dy)
    txt=''.join(c['text'] for c in g)
    cx=sum(ctr(c)[0] for c in g)/len(g); cy=sum(ctr(c)[1] for c in g)/len(g)
    labels.append(dict(text=txt,x=cx,y=cy,size=g[0]['size'],textAngleDeg=round(math.degrees(a),1)))
# legend colours: legend swatches top-left with text labels like 2C,4B...
legend_words=[w for w in pg.extract_words() if w['top']<0.40*H and w['x0']<0.25*W and re.fullmatch(r'\d+[A-Z]+\d?',w['text'])]
shapes=[s for s in pg.curves+pg.rects if s.get('non_stroking_color') is not None and s.get('fill')]
def poly(s):
    if 'pts' in s and s['pts']: return [(x,y) for x,y in s['pts']]
    return [(s['x0'],s['top']),(s['x1'],s['top']),(s['x1'],s['bottom']),(s['x0'],s['bottom'])]
def inside(pt,pl):
    x,y=pt; c=False
    for i in range(len(pl)):
        x1,y1=pl[i]; x2,y2=pl[(i+1)%len(pl)]
        if (y1>y)!=(y2>y) and x < (x2-x1)*(y-y1)/(y2-y1+1e-12)+x1: c=not c
    return c
def colkey(c):
    if isinstance(c,(list,tuple)): return tuple(round(v,3) for v in c)
    return (round(c,3),)
legend={}
for w in legend_words:
    t=w['text']
    if not any(ch.isdigit() for ch in t): continue
    pt=((w['x0']+w['x1'])/2,(w['top']+w['bottom'])/2)
    best=None
    for s in shapes:
        pl=poly(s)
        if inside(pt,pl):
            area=(s['x1']-s['x0'])*(s['bottom']-s['top'])
            if best is None or area<best[0]: best=(area,s)
    if best: legend[colkey(best[1]['non_stroking_color'])]=t
def rgb(c):
    if len(c)==4: C,M,Y,K=c; return ((1-C)*(1-K),(1-M)*(1-K),(1-Y)*(1-K))
    if len(c)==3: return c
    return (c[0],)*3
def nearest_type(ck):
    r=rgb(ck); ds=sorted((math.dist(r,rgb(k)),v) for k,v in legend.items())
    return ds[0][1],ds[0][0],(ds[1][0] if len(ds)>1 else 9)
black=[s for s in shapes if colkey(s['non_stroking_color'])==(0.0,0.0,0.0,1.0) and 1.5<(s['x1']-s['x0'])<4]
def pets_near(pl):
    cx=sum(x for x,_ in pl)/len(pl); cy=sum(y for _,y in pl)/len(pl)
    return any(math.hypot((b['x0']+b['x1'])/2-cx,(b['top']+b['bottom'])/2-cy)<9 for b in black)
houses=[]; unknown=[]
for L in labels:
    t=L['text']
    if not t.isdigit(): continue
    v=int(t)
    best=None
    for s in shapes:
        if s['bottom']>MAP_BOTTOM: continue
        w_=s['x1']-s['x0']; h_=s['bottom']-s['top']
        if not (4<w_<20 and 4<h_<20): continue
        if colkey(s['non_stroking_color'])==(0.0,0.0,0.0,1.0): continue
        pl=poly(s)
        if inside((L['x'],L['y']),pl):
            area=w_*h_
            if best is None or area<best[0]: best=(area,s,pl)
    rec=dict(id=f'H{v}',number=v,pdf=dict(page=1,x=round(L['x'],2),y=round(L['y'],2)),
             norm=dict(x=round(L['x']/W,5),y=round(L['y']/H,5)))
    if best:
        s,pl=best[1],best[2]
        ck=colkey(s['non_stroking_color'])
        lt,dist,second=nearest_type(ck)
        rec['legendType']=lt; rec['fill']=list(ck); rec['legendColourDistance']=round(dist,3)
        rec['typeConfidence']='high' if dist<0.06 and second-dist>0.08 else ('medium' if dist<0.15 else 'low')
        rec['petsAllowed']=pets_near(pl)
        # orientation from longest edge
        e=max(((pl[i],pl[(i+1)%len(pl)]) for i in range(len(pl))),key=lambda e:math.hypot(e[1][0]-e[0][0],e[1][1]-e[0][1]))
        rec['rotationDeg']=round(math.degrees(math.atan2(e[1][1]-e[0][1],e[1][0]-e[0][0]))%90,1)
        rec['footprintPts']=round(max(s['x1']-s['x0'],s['bottom']-s['top']),2)
    else:
        rec['legendType']=None; rec['typeConfidence']='no-swatch-found'
    if not best:
        unknown.append(dict(text=t,x=round(L['x'],2),y=round(L['y'],2))); continue
    houses.append(rec)
houses.sort(key=lambda h:h['number'])
FAC=set('A B1 B2 C D E F G H I J K L M O Q R S S1 S2 T U V W X Y Z'.split())
facilities=[]
for w in pg.extract_words():
    if w['text'] in FAC and w['top']<MAP_BOTTOM and not (w['x0']<0.25*W and w['top']<0.4*H):
        facilities.append(dict(key=w['text'],x=round((w['x0']+w['x1'])/2,2),y=round((w['top']+w['bottom'])/2,2)))
# duplicates / suspicious
from collections import Counter
cnt=Counter(h['number'] for h in houses)
out=dict(source=dict(file='AHT_Plat.pdf',page=1,widthPts=W,heightPts=H,legendDate='01.10.2025'),
         extraction='automatic (pdfplumber); REQUIRES HUMAN REVIEW in map editor',
         legend={v:list(k) for k,v in legend.items()},
         houses=houses, nonHouseNumericLabels=unknown, facilities=facilities,
         warnings=[f'duplicate label {k} x{v}' for k,v in cnt.items() if v>1])
json.dump(out,open(sys.argv[1],'w'),indent=1)
print('labels',len(labels),'houses',len(houses),'legend types',len(legend))
print('typed',sum(1 for h in houses if h.get('legendType')),'untyped',[h['number'] for h in houses if not h.get('legendType')][:80])
print('dups',out['warnings'][:20])
nums=sorted(cnt); print('range',nums[0],nums[-1])
