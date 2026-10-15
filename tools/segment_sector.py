"""Raster-segment a sector of AHT_Plat.pdf into terrain polygons (water, footpath, building, road surface).
Output JSON in PDF points; the game converts to metres (metersPerPt in the sector file).
Usage: pdftoppm -r 500 -png references/AHT_Plat.pdf work/hi && python3 tools/segment_sector.py 296 116 504 270 work/seg.json work/hi-1.png"""
import sys, json, numpy as np, cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
X0,Y0,X1,Y1=[float(v) for v in sys.argv[1:5]]; out=sys.argv[5]
im=np.array(Image.open(sys.argv[6] if len(sys.argv)>6 else 'ref/hi-1.png').convert('RGB')).astype(np.int16)
k=im.shape[1]/841.89
a=im[int(Y0*k):int(Y1*k), int(X0*k):int(X1*k)]
def near(c,t=14): return (np.abs(a-np.array(c)).sum(axis=2)<t*3)
cls={
 'road':near((234,246,217)),
 'building':near((219,240,192),8),
 'footpath':near((253,227,184),18),
 'grass':near((191,229,147)),
}
# water: bluish pixels
r,g,b=a[...,0],a[...,1],a[...,2]
cls['water']=(b>200)&(r<190)&(g>190)&(b-r>40)
res={}
kern=lambda n: cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(n,n))
for name,m in cls.items():
    m=(m*255).astype(np.uint8)
    if name in('road','water','footpath'):
        m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,kern(int(2.2*k)))  # fill label holes (~2pt)
        m=cv2.morphologyEx(m,cv2.MORPH_OPEN,kern(3))
    if name=='building':
        m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,kern(int(1.6*k)))
    cs,_=cv2.findContours(m,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
    polys=[]
    for c in cs:
        area=cv2.contourArea(c)/(k*k)
        if area<(4 if name!='footpath' else 3): continue
        ap=cv2.approxPolyDP(c,0.25*k,True)
        polys.append(dict(areaPt2=round(area,1),pts=[[round(X0+p[0][0]/k,2),round(Y0+p[0][1]/k,2)] for p in ap]))
    res[name]=polys
    cv2.imwrite(out.replace('.json',f'_{name}.png'),m)
json.dump(dict(bboxPts=[X0,Y0,X1,Y1],source='AHT_Plat.pdf p1 raster 500dpi',polygons=res),open(out,'w'))
print({k_:len(v) for k_,v in res.items()})
