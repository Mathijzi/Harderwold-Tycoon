"""Kleursegmentatie van de Harderwold-plattegrond (raster, 4961 x 3508 px).
Gebruik: python3 tools/harderwold/segment.py   (verwacht work/plan_full.png, zie extract_plan.py)
Schrijft work/seg_*.png (maskers) en work/seg.npz. Alle coordinaten in pixels van het volle raster."""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

im = np.asarray(Image.open('work/plan_full.png').convert('RGB')).astype(np.int16)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
mx, mn = im.max(-1), im.min(-1)
sat = mx - mn
water = (b > 150) & (b - r > 70) & (b > g + 20)
grey = sat < 14
road = grey & (mx >= 208) & (mx <= 236)
label = grey & (mx >= 192) & (mx < 208)
paved = grey & (mx >= 176) & (mx < 192)
white = mn > 240
forest = (g < 125) & (g > r + 8) & (g > b + 15) & (mx < 130)
# kleine gaten dichten (tekst, symbolen) en ruis weghalen
water = ndi.binary_opening(ndi.binary_closing(water, iterations=2), iterations=2)
road = ndi.binary_opening(road, iterations=2)
np.savez_compressed('work/seg.npz', water=water, road=road, label=label, paved=paved, forest=forest, white=white)
H, W = water.shape
vis = np.zeros((H, W, 3), np.uint8) + 230
vis[forest] = (60, 110, 60); vis[water] = (40, 120, 220); vis[road] = (255, 255, 255); vis[paved] = (150, 150, 150); vis[label] = (220, 60, 60)
Image.fromarray(vis).resize((W // 3, H // 3), Image.NEAREST).save('work/seg_vis.png')
print('water', water.sum(), 'road', road.sum(), 'label', label.sum(), 'paved', paved.sum(), 'forest', forest.sum())
