"""Kavellabels van de plattegrond: grijze nummervakjes -> positie, richting en huisnummer.
Cijferherkenning met eigen sjablonen (de labels 204-216 staan rechtop en bevatten alle cijfers 0-9).
Gebruik: python3 tools/harderwold/labels.py   (na segment.py). Schrijft work/labels.json en work/labels_vis.png."""
import json, math
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

seg = np.load('work/seg.npz')
img = Image.open('work/plan_full.png').convert('L')
G = np.asarray(img)
lab_mask = ndi.binary_closing(seg['label'], iterations=3)
lab_mask = ndi.binary_fill_holes(lab_mask)
lab_mask = ndi.binary_opening(lab_mask, iterations=3)
L, n = ndi.label(lab_mask)
boxes = []
for i, sl in enumerate(ndi.find_objects(L), start=1):
    m = L[sl] == i
    area = m.sum()
    if area < 2500 or area > 20000: continue
    ys, xs = np.nonzero(m)
    ys = ys + sl[0].start; xs = xs + sl[1].start
    cx, cy = xs.mean(), ys.mean()
    cov = np.cov(np.vstack([xs - cx, ys - cy]))
    ev, evec = np.linalg.eigh(cov)
    major = evec[:, 1]; ang = math.degrees(math.atan2(major[1], major[0]))
    Lm, Wm = math.sqrt(12 * ev[1]), math.sqrt(12 * ev[0])
    fill = area / max(1, Lm * Wm)
    if fill < 0.75 or Lm / max(1, Wm) < 1.15: continue
    boxes.append({'cx': float(cx), 'cy': float(cy), 'ang': ang, 'len': Lm, 'wid': Wm, 'area': int(area)})
print('vakjes', len(boxes))

def glyphs(b, flip):
    """crop the box, rotate the long axis horizontal (text reading direction), split into glyph images"""
    r = int(max(b['len'], b['wid']) / 2 + 6)
    x0, y0 = int(b['cx']) - r, int(b['cy']) - r
    crop = img.crop((x0, y0, x0 + 2 * r, y0 + 2 * r))
    a = b['ang'] + (180 if flip else 0)
    rot = np.asarray(crop.rotate(a, resample=Image.BILINEAR, fillcolor=200))
    h = rot.shape[0]
    band = rot[int(h / 2 - b['wid'] / 2 + 2):int(h / 2 + b['wid'] / 2 - 2), int(h / 2 - b['len'] / 2 + 2):int(h / 2 + b['len'] / 2 - 2)]
    dark = band < 110
    cols = dark.any(0)
    out = []; x = 0
    while x < len(cols):
        if cols[x]:
            s = x
            while x < len(cols) and cols[x]: x += 1
            g = dark[:, s:x]
            rows = np.nonzero(g.any(1))[0]
            if len(rows) and g.sum() > 12: out.append((g[rows[0]:rows[-1] + 1], s, x, rows[0], rows[-1]))
        x += 1
    # aan elkaar geplakte cijfers: te brede tekens in gelijke delen splitsen
    if out:
        H = max(g[4] - g[3] for g in out) + 1
        split = []
        for g in out:
            w = g[2] - g[1]; k = int(round(w / (0.62 * H)))
            if k >= 2 and g[4] - g[3] + 1 > 0.75 * H:
                for j in range(k):
                    a, b2 = g[1] + j * w // k, g[1] + (j + 1) * w // k
                    sub = dark[:, a:b2]; rows = np.nonzero(sub.any(1))[0]
                    if len(rows): split.append((sub[rows[0]:rows[-1] + 1], a, b2, rows[0], rows[-1]))
            else: split.append(g)
        out = split
    return out, band.shape

def norm(g):
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((16, 24), Image.BILINEAR)
    v = np.asarray(im).astype(float).ravel(); v -= v.mean(); return v / (np.linalg.norm(v) + 1e-6)

# --- templates from the upright column 204..216
col = sorted([b for b in boxes if 2650 < b['cx'] < 2800 and 1950 < b['cy'] < 2900 and min(b['ang'] % 180, 180 - b['ang'] % 180) < 20], key=lambda b: b['cy'])
assert len(col) == 13, f'sjabloonkolom: {len(col)} vakjes'
T = {}
for num, b in zip(range(204, 217), col):
    b = dict(b, ang=((b['ang'] + 90) % 180) - 90)  # rechtop
    gs, _ = glyphs(b, False)
    gs = [g for g in gs if g[4] - g[3] > 0.5 * max(q[4] - q[3] for q in gs)]
    ds = str(num)
    if len(gs) != 3:  # 180 graden gedraaid?
        gs, _ = glyphs(b, True); gs = [g for g in gs if g[4] - g[3] > 0.5 * max(q[4] - q[3] for q in gs)]
    for d, g in zip(ds, gs): T.setdefault(d, []).append(norm(g[0]))
T = {d: np.mean(v, 0) for d, v in T.items()}
print('sjablonen', sorted(T))

def read(b):
    best = None
    for flip in (False, True):
        gs, shp = glyphs(b, flip)
        if not gs: continue
        hmax = max(g[4] - g[3] for g in gs)
        txt = ''; score = 0; sup = False
        for g in gs:
            gh = g[4] - g[3]
            if gh < 0.75 * hmax:  # superscript A (217ᴬ) or slash noise
                if g[3] < shp[0] * 0.45: sup = True
                continue
            v = norm(g[0]); sc = {d: float(v @ t) for d, t in T.items()}
            d = max(sc, key=sc.get); txt += d; score += sc[d]
        score /= max(1, len(txt))
        if best is None or score > best[1]: best = (txt, score, sup, flip)
    return best

out = []
for b in boxes:
    txt, score, sup, flip = read(b)
    b.update({'text': txt + ('A' if sup else ''), 'score': round(score, 3), 'flip': flip})
    out.append(b)
json.dump(out, open('work/labels.json', 'w'), indent=0)
low = [b for b in out if b['score'] < 0.8 or len(b['text'].rstrip('A')) != 3]
print('gelezen', len(out), 'twijfel', len(low))
for b in sorted(low, key=lambda b: (b['cy'], b['cx'])): print(' twijfel', round(b['cx']), round(b['cy']), b['text'], b['score'])
vis = Image.open('work/plan_full.png').convert('RGB').point(lambda v: 140 + v // 2.5)
d = ImageDraw.Draw(vis)
for b in out:
    c = (0, 120, 0) if b['score'] >= 0.8 and len(b['text'].rstrip('A')) == 3 else (220, 0, 0)
    d.text((b['cx'] - 30, b['cy'] - 10), b['text'], fill=c, font_size=34)
vis.resize((vis.width // 2, vis.height // 2)).save('work/labels_vis.png')
