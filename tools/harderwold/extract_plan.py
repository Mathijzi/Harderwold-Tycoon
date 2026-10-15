"""Haalt het raster (4961 x 3508 px, JPEG) uit references/harderwold_plattegrond.pdf -> work/plan_full.png.
De PDF bevat alleen deze afbeelding (geen vectoren of tekst)."""
import os, re
from PIL import Image
d = open('references/harderwold_plattegrond.pdf', 'rb').read()
m = re.search(rb'<<([^<>]*?/Subtype\s*/Image[^<>]*?)>>\s*stream\r?\n', d, re.S)
start, n = m.end(), int(re.search(rb'/Length (\d+)', m.group(1)).group(1))
os.makedirs('work', exist_ok=True)
open('work/plan_full.jpg', 'wb').write(d[start:start + n])
im = Image.open('work/plan_full.jpg').convert('RGB'); im.save('work/plan_full.png')
print(im.size)
