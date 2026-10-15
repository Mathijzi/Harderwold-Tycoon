"""Draw data/map/park_road_network.json over the PDF raster for visual checking.
Usage: python3 tools/overlay_park_network.py work/p300-1.png data/map/park_road_network.json work/park_net.png [x0 y0 x1 y1]"""
import json, sys
from PIL import Image, ImageDraw
im = Image.open(sys.argv[1]).convert('RGB'); net = json.load(open(sys.argv[2])); k = im.size[0] / 841.89
dr = ImageDraw.Draw(im)
col = {'public': (200, 0, 200), 'arrival': (255, 120, 0), 'park': (220, 0, 0), 'service': (0, 120, 255), 'scenery': (120, 120, 120)}
for r in net['roads']:
    P = [net['nodes'][r['from']]['pt']] + r['pts'] + [net['nodes'][r['to']]['pt']]
    dr.line([(x * k, y * k) for x, y in P], fill=col.get(r['class'], (0, 0, 0)), width=5 if r.get('oneway') else 3)
for nid, n in net['nodes'].items():
    x, y = n['pt']; c = {'junction': (0, 0, 255), 'deadend': (255, 0, 255), 'portal': (0, 160, 0)}.get(n['kind'], (0, 0, 0))
    dr.ellipse([x * k - 6, y * k - 6, x * k + 6, y * k + 6], fill=c)
    if not nid.startswith('N') and not nid.startswith('laan'): dr.text((x * k + 7, y * k - 12), nid, fill=(0, 0, 0))
for g in net.get('gates', []):
    x, y = g['stopPt']; dr.rectangle([x * k - 8, y * k - 8, x * k + 8, y * k + 8], outline=(255, 140, 0), width=4)
box = [float(v) for v in sys.argv[4:8]] if len(sys.argv) > 7 else [0, 0, 841.89, 0.715 * 595.28]
im.crop(tuple(int(v * k) for v in box)).save(sys.argv[3])
