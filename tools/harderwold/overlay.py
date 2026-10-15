"""Controlebeeld: gegenereerde kaart (wegen, knopen, slagbomen, huizen, water) over de plattegrond -> work/overlay.png"""
import json, sys
from PIL import Image, ImageDraw
park = json.load(open('data/map/park.json')); net = json.load(open('data/map/park_road_network.json'))
im = Image.open('work/plan_full.png').convert('RGB').point(lambda v: 110 + v // 2)
d = ImageDraw.Draw(im)
for w in park['terrain']['water']: d.line([tuple(p) for p in w + [w[0]]], fill=(0, 60, 255), width=3)
for f in park['terrain']['footpaths']: d.line([tuple(p) for p in f + [f[0]]], fill=(150, 90, 0), width=2)
col = {'public': (0, 0, 0), 'arrival': (200, 0, 200), 'park': (220, 0, 0), 'service': (230, 140, 0)}
for r in net['roads']:
    pl = [net['nodes'][r['from']]['pt']] + r['pts'] + [net['nodes'][r['to']]['pt']]
    d.line([tuple(p) for p in pl], fill=col[r['class']], width=7)
for k, n in net['nodes'].items():
    x, y = n['pt']; c = (0, 0, 220) if n['kind'] == 'junction' else (0, 160, 0) if n['kind'] == 'deadend' else (0, 0, 0)
    d.ellipse([x - 14, y - 14, x + 14, y + 14], fill=c); d.text((x + 16, y - 16), k, fill=(0, 0, 0), font_size=30)
for g in net['gates']:
    x, y = g['stopPt']; d.rectangle([x - 18, y - 6, x + 18, y + 6], fill=(255, 0, 0))
import math
for h in park['houses']:
    x, y = h['pt']; d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=(255, 255, 0))
for c in park['parkingClusters']:
    x, y = c['pt']; d.rectangle([x - 5, y - 5, x + 5, y + 5], fill=(0, 200, 255))
s = float(sys.argv[1]) if len(sys.argv) > 1 else 0.35
im.resize((int(im.width * s), int(im.height * s))).save('work/overlay.png')
