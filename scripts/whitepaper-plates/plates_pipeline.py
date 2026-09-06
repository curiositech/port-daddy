#!/usr/bin/env python3
"""Select, correct, and encode the Book's plates; write provenance.
Cover: the beached-moon wash, cropped inside its sheet edges, full bleed.
Frontispiece: the colossus-of-clerks etching, paper balanced to the page stock.
Chapters: round-8 faded watercolor washes, paper balanced to the page stock and feathered into it (bled).
Parts: round-8 tall washes, full page behind the part's type, paper balanced to the page stock.
CHOICE names the render picked per slot; every option stays in the scratchpad renders directory.
Usage: SP=... python3 plates_pipeline.py <repo>"""
import json, os, sys, datetime
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
SP = Path(os.environ['SP']); REPO = Path(sys.argv[1]); PL = REPO / 'website-v2/public/whitepaper/plates'; PL.mkdir(exist_ok=True)
R3, R8 = SP / 'covers/out', SP / 'covers/r8'
PAGE = (0xFB, 0xF7, 0xEF)            # hhpaper
HUE = {'I': (0x00, 0x3F, 0xB8), 'II': (0x00, 0x6B, 0x5F), 'III': (0x93, 0x3F, 0xA5), 'IV': (0x66, 0x6A, 0x00)}  # pdcobalt, pdteal, pdviolet, pdgold

def autocrop(im, corner_max=236):
    """If the render shows a sheet on a darker surface (desk, grey), crop to the sheet; never crop to the drawing."""
    import numpy as _np
    a = _np.asarray(im.convert('RGB')).astype(_np.int16); lum = a.mean(2); h, w = lum.shape
    corners = [lum[2, 2], lum[2, w-3], lum[h-3, 2], lum[h-3, w-3]]
    if min(corners) > corner_max: return im            # already drawn on paper: leave the margins alone
    bright = lum > (max(corners) + 12)
    rows = _np.where(bright.mean(1) > 0.5)[0]; cols = _np.where(bright.mean(0) > 0.5)[0]
    if len(rows) < h * 0.3 or len(cols) < w * 0.3: return im
    return im.crop((cols.min(), rows.min(), cols.max() + 1, rows.max() + 1))

def inset(im, frac):
    w, h = im.size; dx, dy = int(w * frac), int(h * frac)
    return im.crop((dx, dy, w - dx, h - dy))

def fit(im, ratio, long_edge):
    im = ImageOps.fit(im, (int(1000 * ratio), 1000) if ratio >= 1 else (1000, int(1000 / ratio)), Image.LANCZOS, centering=(0.5, 0.5))
    w, h = im.size; s = long_edge / max(w, h)
    return im.resize((round(w * s), round(h * s)), Image.LANCZOS)

def paper_balance(im, target=PAGE, pct=96):
    """Map the plate's paper tone (bright percentile per channel) onto the page stock; ink stays ink."""
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    paper = np.percentile(a.reshape(-1, 3), pct, axis=0)
    gain = np.array(target, dtype=np.float32) / np.maximum(paper, 1)
    out = np.clip(a * gain, 0, 255)
    return Image.fromarray(out.astype(np.uint8))

def feather(im, ground, frac=0.05):
    """Blend the plate's borders into the ground color so no rectangle edge prints."""
    a = np.asarray(im.convert('RGB')).astype(np.float32); h, w = a.shape[:2]
    fy, fx = max(2, int(h * frac)), max(2, int(w * frac))
    ry = np.ones(h, np.float32); rx = np.ones(w, np.float32)
    ramp_y = np.linspace(0, 1, fy, dtype=np.float32); ramp_x = np.linspace(0, 1, fx, dtype=np.float32)
    ry[:fy] = ramp_y; ry[-fy:] = ramp_y[::-1]; rx[:fx] = ramp_x; rx[-fx:] = ramp_x[::-1]
    m = (ry[:, None] * rx[None, :])[..., None]
    g = np.array(ground, dtype=np.float32)
    return Image.fromarray((a * m + g * (1 - m)).astype(np.uint8))

def plate_crop(im, dark_thresh=110, frac=0.35):
    """Crop a print to its plate: the bounding box of rows/cols that are mostly darker than the paper."""
    a = np.asarray(im.convert('L')).astype(np.float32); h, w = a.shape
    dark = a < dark_thresh
    rows = np.where(dark.mean(1) > frac)[0]; cols = np.where(dark.mean(0) > frac)[0]
    if len(rows) < h * 0.4 or len(cols) < w * 0.4: return im
    return im.crop((cols.min(), rows.min(), cols.max() + 1, rows.max() + 1))

def tone_on_hue(im, hue, ink_scale=0.30):
    """A black-ink print re-inked in a dark shade of the part hue on the hue itself: the plate merges into the page."""
    g = np.asarray(paper_balance(im).convert('L')).astype(np.float32) / 255.0
    cov = np.clip(((1.0 - g) - 0.06) * 1.25, 0, 1)[..., None]
    hue_a = np.array(hue, dtype=np.float32); ink_a = hue_a * ink_scale
    return Image.fromarray((hue_a * (1 - cov) + ink_a * cov).astype(np.uint8))

def cream_on_hue(im, hue, ink=PAGE):
    """Line art as cream ink on a flat hue: ink coverage from darkness, then alpha-composite."""
    g = np.asarray(paper_balance(im).convert('L')).astype(np.float32) / 255.0
    cov = np.clip(((1.0 - g) - 0.07) * 1.4, 0, 1)[..., None]   # paper noise below 7% darkness vanishes
    hue_a = np.array(hue, dtype=np.float32); ink_a = np.array(ink, dtype=np.float32)
    out = hue_a * (1 - cov) + ink_a * cov
    return Image.fromarray(out.astype(np.uint8))

PLATES = {
 'jacket':       dict(src=R3 / 'G2-wash-machine.png', ratio=0.707, long=2300, q=88, fn=lambda im: inset(im, 0.055), note='cover wash (the beached moon), sheet edges cropped away, full bleed at A4'),
 'frontispiece': dict(src=R3 / 'E2-etch-clerks.png', ratio=0.667, long=2000, q=88, fn=lambda im: feather(paper_balance(inset(im, 0.06)), PAGE, 0.03), note='frontispiece etching, the colossus of clerks, paper balanced to the page stock'),
}
CHOICE = {'part-I': 'tall-a', 'part-II': 'tall-a', 'part-III': 'tall-b', 'part-IV': 'tall-a',
          'ch-swk': 'b', 'ch-anchor': 'a', 'ch-ls': 'a', 'ch-stp': 'a', 'ch-he': 'a', 'ch-bonded': 'a', 'ch-fh': 'a'}
for numeral in ['I', 'II', 'III', 'IV']:
    PLATES[f'part-{numeral}'] = dict(src=R8 / f"part-{numeral}-{CHOICE[f'part-{numeral}']}.png", ratio=0.707, long=2300, q=86,
        fn=lambda im: paper_balance(inset(im, 0.045)), note=f'Part {numeral} wash, full page behind the part type, sheet edges cropped away, paper balanced to the page stock')
for prefix in ['swk', 'anchor', 'ls', 'stp', 'he', 'bonded', 'fh']:
    PLATES[f'chapter-{prefix}'] = dict(src=R8 / f"ch-{prefix}-{CHOICE[f'ch-{prefix}']}.png", ratio=1.5, long=1800, q=85,
        fn=lambda im: feather(paper_balance(inset(im, 0.05)), PAGE, 0.07), note=f'chapter {prefix} wash, sheet edges cropped away, paper balanced to the page stock, borders bled into it')

prov = {'generated': datetime.date.today().isoformat(), 'model': 'gemini-3-pro-image-preview (Nano Banana) via nano-banana-image-gen/scripts/generate.py',
        'post': 'crop inside the painted sheet edges, paper-tone balance to #FBF7EF (percentile white), border feather into the page stock on chapter plates, Lanczos resize, JPEG', 'plates': {}}
total = 0
for name, spec in PLATES.items():
    src = spec['src']
    if not src.exists(): print('MISSING', name, src); continue
    im = spec['fn'](Image.open(src).convert('RGB')); im = fit(im, spec['ratio'], spec['long'])
    out = PL / f'{name}.jpg'; im.save(out, 'JPEG', quality=spec['q'], optimize=True, progressive=True)
    side = src.with_suffix('.json'); prompt = json.loads(side.read_text())['prompt'] if side.exists() else None
    prov['plates'][name] = {'file': out.name, 'source_render': src.name, 'size': im.size, 'bytes': out.stat().st_size, 'note': spec['note'], 'prompt': prompt}
    total += out.stat().st_size; print(f'{name:16s} {im.size} {out.stat().st_size // 1024:4d} KB  <- {src.name}')
(PL / 'PROVENANCE.json').write_text(json.dumps(prov, indent=2) + '\n')
print('total KB', total // 1024)
