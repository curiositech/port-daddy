#!/usr/bin/env python3
"""Round 8, one more slot: the sealed room's chapter wash, same register as the rest."""
import json, os, subprocess, sys, time
from pathlib import Path
SP = Path(os.environ['SP']); OUT = SP / 'covers' / 'r8'
GEN = Path('/root/.claude/skills/nano-banana-image-gen/scripts/generate.py')
sys.path.insert(0, str(SP / 'covers'))
WASH = ("A faded watercolor wash landscape reproduced on aged, lightly embossed paper stock: visible paper tooth, salt "
 "texture and pigment blooms in the washes, offset print grain, colors muted and slightly bled as in an old lithographed "
 "reproduction, no hard outlines, no ink linework, no bright saturated color. Space-opera scale: one colossal, smooth, "
 "unearthly presence dominates the picture, rendered as soft masses of pale wash with almost no detail, and one small "
 "everyday human-scale thing sits beneath or beside it, tiny and exact. Most of the picture is open pale wash, mist and "
 "water. No people's faces, no crews, no lettering of any kind, no border; the wash runs to all four edges.")
SCENE = ("Scene: a vast smooth windowless vault the size of a headland rests in a pale bay, seamless and featureless except "
 "for one hair-thin horizontal slot of warm light near its waterline, and on the flat water before it one small rowboat "
 "with a single lantern, waiting; mist over everything else.")
VARIANT = {'a': " Palette: pale greys, cobalt and violet washes faded almost to paper, one warm lamp-glow.",
           'b': " Palette: pale ochre and sea-green washes faded almost to paper, mist everywhere, one warm lamp-glow. Composition even sparser: the small thing in a lower corner, the colossal thing cut off by the frame."}
for v in ('a', 'b'):
    name = f'ch-sealed-{v}'; out = OUT / f'{name}.png'; prompt = WASH + SCENE + VARIANT[v]
    if out.exists() and out.stat().st_size > 20_000: print('skip', name); continue
    for _ in range(3):
        t0 = time.time(); r = subprocess.run([sys.executable, str(GEN), '--scene', prompt, '--out', str(out), '--aspect', '3:2'], capture_output=True, text=True)
        (OUT / f'{name}.log').write_text(r.stderr[-3000:])
        if r.returncode == 0 and out.exists():
            (OUT / f'{name}.json').write_text(json.dumps({'name': name, 'aspect': '3:2', 'prompt': prompt}, indent=2)); print(f'ok {name} {time.time()-t0:.0f}s', flush=True); break
        time.sleep(10)
    else:
        print(f'FAILED {name}: {r.stderr[-200:]}')
