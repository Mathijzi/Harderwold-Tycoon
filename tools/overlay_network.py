"""Draw the road network JSON over the rasterised PDF for visual verification.
Usage: python3 tools/overlay_network.py data/map/sector_road_network.json work/hi-1.png work/overlay.png"""
import json, sys
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS=None
net=json.load(open(sys.argv[1])); im=Image.open(sys.argv[2]).convert('RGB'); out=sys.argv[3]
X0,Y0,X1,Y1=300,118,500,265
k=im.size[0]/841.89; Z=6
cr=im.crop((int(X0*k),int(Y0*k),int(X1*k),int(Y1*k))).resize((int((X1-X0)*Z),int((Y1-Y0)*Z)))
d=ImageDraw.Draw(cr)
T=lambda p:((p[0]-X0)*Z,(p[1]-Y0)*Z)
N=net['nodes']
for r in net['roads']:
    pts=[N[r['from']]['pt']]+r['pts']+[N[r['to']]['pt']]
    d.line([T(p) for p in pts],fill=(220,0,0),width=3)
    for p in r['pts']: x,y=T(p); d.ellipse([x-3,y-3,x+3,y+3],fill=(160,0,0))
for n,v in N.items():
    x,y=T(v['pt']); d.ellipse([x-7,y-7,x+7,y+7],outline=(0,0,255),width=3); d.text((x+8,y-8),n,fill=(0,0,200))
for g in net['gates']:
    x,y=T(g['stopPt']); d.line([x-12,y,x+12,y],fill=(255,120,0),width=4); d.text((x+14,y-6),g['id'],fill=(200,80,0))
cr.save(out)
