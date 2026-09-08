#!/usr/bin/env python3
"""Round 8: the cover's own register for every interior plate.
Faded, bled watercolor reproduced on aged stock. Stark alien strangeness meeting the mundane:
a colossal unearthly presence and one small quotidian thing, coexisting. Space-opera scale,
no clear lines, no bright full colors, gentle and stark, abstract but detailed, sparse.
No sailors, no crews, no crosshatching, no engraving."""
import json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
SP = Path(os.environ['SP']); OUT = SP / 'covers' / 'r8'; OUT.mkdir(parents=True, exist_ok=True)
GEN = Path('/root/.claude/skills/nano-banana-image-gen/scripts/generate.py')

WASH = ("A faded watercolor wash landscape reproduced on aged, lightly embossed paper stock: visible paper tooth, salt "
 "texture and pigment blooms in the washes, offset print grain, colors muted and slightly bled as in an old lithographed "
 "reproduction, no hard outlines, no ink linework, no bright saturated color. Space-opera scale: one colossal, smooth, "
 "unearthly presence dominates the picture, rendered as soft masses of pale wash with almost no detail, and one small "
 "everyday human-scale thing sits beneath or beside it, tiny and exact. Most of the picture is open pale wash, mist and "
 "water. No people's faces, no crews, no lettering of any kind, no border; the wash runs to all four edges.")

SCENES = {
 'part-I':   "Scene: a sphere the size of a small moon descending through cloud over a flat grey sea, its underside smooth and featureless, and below it one small sailing vessel with a single lamp lit, its sail the only crisp shape in the picture.",
 'part-II':  "Scene: an immense ring, kilometers wide, hanging on edge in a hazy sky over a low headland where one small stone watchtower stands; a single thin beam from the tower touches the ring; everything else is mist.",
 'part-III': "Scene: the hull of a derelict machine the size of a mountain range half-buried in a tidal flat under a pale dawn, and leaving its shadow, one small boat with a lit cabin window, trailing a wake.",
 'part-IV':  "Scene: two colossal smooth structures, one dark and one pale, facing each other across a narrow strait in evening haze, and between them one tiny sail crossing under a single hair-thin line of light strung from one to the other.",
 'ch-swk':   "Scene: a small stone lighthouse at the end of a mole, its lamp lit at dusk, and behind it, filling the whole sky, the smooth curved flank of a descended sphere so vast its edge cannot be seen; the harbor water flat and pale.",
 'ch-anchor':"Scene: a procession of immense smooth monoliths floating above a calm sea, each smaller and fainter than the one before, receding into haze; at the front a single rowboat holds one taut rope to the nearest monolith.",
 'ch-ls':    "Scene: a small wooden pier with one hanging lantern at night, its light a small warm circle on the water, and beneath the whole bay, dimly through the water, a single vast pale shape the size of the town, only its curve visible.",
 'ch-stp':   "Scene: the ribs of an immense wrecked machine rising from a mist-covered estuary like a range of hills, and in the foreground one small sailboat at anchor with a lit cabin, its laundry on a line, the morning continuing.",
 'ch-he':    "Scene: a vast smooth platform hangs low over a fishing harbor at dawn, casting a soft shadow over the quay, and on the quay one small table with two chairs and a lamp, set for a meeting, nothing else moving.",
 'ch-bonded':"Scene: a single colossal pillar of pale light stands from a night sea into cloud, and on the near shore a small village of a dozen roofs, every window dark but one; the pillar's reflection crosses the water to that window.",
 'ch-fh':    "Scene: two vast spheres, one on each horizon, in morning haze over a small harbor town going about its day, a few boats out; a single thin line of light passes from sphere to sphere high above the roofs.",
}
VARIANT = {
 'a': " Palette: pale greys, cobalt and violet washes faded almost to paper, one warm lamp-glow.",
 'b': " Palette: pale ochre and sea-green washes faded almost to paper, mist everywhere, one warm lamp-glow. Composition even sparser: the small thing in a lower corner, the colossal thing cut off by the frame.",
}
JOBS = [(f'{slot}-{v}', '3:2', WASH + scene + VARIANT[v]) for slot, scene in SCENES.items() for v in ('a', 'b')]

def run(job):
    name, aspect, prompt = job; out = OUT / f'{name}.png'
    if out.exists() and out.stat().st_size > 20_000: return f'skip {name}'
    cmd = [sys.executable, str(GEN), '--scene', prompt, '--out', str(out), '--aspect', aspect]
    for attempt in range(3):
        t0 = time.time(); r = subprocess.run(cmd, capture_output=True, text=True)
        (OUT / f'{name}.log').write_text(r.stderr[-3000:])
        if r.returncode == 0 and out.exists():
            (OUT / f'{name}.json').write_text(json.dumps({'name': name, 'aspect': aspect, 'prompt': prompt}, indent=2))
            return f'ok {name} {time.time()-t0:.0f}s'
        time.sleep(10)
    return f'FAILED {name}: {r.stderr[-200:]}'
with ThreadPoolExecutor(max_workers=4) as ex:
    for res in ex.map(run, JOBS): print(res, flush=True)
