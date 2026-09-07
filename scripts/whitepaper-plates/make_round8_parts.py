#!/usr/bin/env python3
"""Round 8, part openers: the same register as the chapter plates, composed tall so the page's type
sits in open wash at the top, as on the cover. Two options per part."""
import json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
SP = Path(os.environ['SP']); OUT = SP / 'covers' / 'r8'; OUT.mkdir(parents=True, exist_ok=True)
GEN = Path('/root/.claude/skills/nano-banana-image-gen/scripts/generate.py')
WASH = ("A faded watercolor wash landscape reproduced on aged, lightly embossed paper stock: visible paper tooth, salt "
 "texture and pigment blooms in the washes, offset print grain, colors muted and slightly bled as in an old lithographed "
 "reproduction, no hard outlines, no ink linework, no bright saturated color. Palette: pale greys, cobalt and violet washes "
 "faded almost to paper, one warm lamp-glow. Space-opera scale: one colossal, smooth, unearthly presence dominates the "
 "picture, rendered as soft masses of pale wash with almost no detail, and one small everyday human-scale thing sits beneath "
 "it, tiny and exact. Tall vertical picture: the upper third is open, nearly empty pale wash (sky and mist), the colossal "
 "presence occupies the middle, the small thing sits low. No people's faces, no crews, no lettering, no border; the wash "
 "runs to all four edges.")
SCENES = {
 'part-I':   "Scene: a sphere the size of a small moon descending through cloud over a flat grey sea, its underside smooth and featureless, and far below it one small sailing vessel with a single lamp lit, its sail the only crisp shape in the picture.",
 'part-II':  "Scene: an immense ring, kilometers wide, hanging on edge in a hazy sky, its top cut off by the frame, over a low headland where one small stone watchtower stands; a single thin beam from the tower touches the ring; everything else is mist.",
 'part-III': "Scene: the hull of a derelict machine the size of a mountain range half-buried in a tidal flat under a pale dawn, its top lost in mist, and leaving its shadow, one small boat with a lit cabin window, trailing a wake.",
 'part-IV':  "Scene: two colossal smooth masses, one dark and one pale, facing each other across a narrow strait in evening haze, their tops lost in cloud, and between them, low in the picture, one tiny sail crossing under a single hair-thin line of light strung from one to the other.",
}
VAR = {'a': "", 'b': " Even sparser: more mist, the colossal presence fainter and larger, the small thing smaller."}
JOBS = [(f'{slot}-tall-{v}', WASH + ' ' + scene + VAR[v]) for slot, scene in SCENES.items() for v in ('a', 'b')]
def run(job):
    name, prompt = job; out = OUT / f'{name}.png'
    if out.exists() and out.stat().st_size > 20_000: return f'skip {name}'
    cmd = [sys.executable, str(GEN), '--scene', prompt, '--out', str(out), '--aspect', '2:3']
    for attempt in range(3):
        t0 = time.time(); r = subprocess.run(cmd, capture_output=True, text=True)
        (OUT / f'{name}.log').write_text(r.stderr[-3000:])
        if r.returncode == 0 and out.exists():
            (OUT / f'{name}.json').write_text(json.dumps({'name': name, 'aspect': '2:3', 'prompt': prompt}, indent=2))
            return f'ok {name} {time.time()-t0:.0f}s'
        time.sleep(10)
    return f'FAILED {name}: {r.stderr[-200:]}'
with ThreadPoolExecutor(max_workers=4) as ex:
    for res in ex.map(run, JOBS): print(res, flush=True)
