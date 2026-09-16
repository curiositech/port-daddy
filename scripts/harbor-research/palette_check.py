#!/usr/bin/env python3
"""Six-checks palette validation for the Book's categorical story colors.

Implements the dataviz skill's runnable check in Python because its own
validate_palette.js is not extracted in this container. Method per the skill:
OKLab delta-E x100, CVD simulation, adjacent-pair separation, normal-vision
floor, contrast against the surface. Nothing here is eyeballed.
"""
import math, itertools

def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4))

def srgb2lin(c):
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4

def lin2srgb(c):
    c = max(0.0, min(1.0, c))
    return 12.92*c if c <= 0.0031308 else 1.055*(c**(1/2.4)) - 0.055

# Machado et al. 2009, severity 1.0, applied in linear RGB.
CVD = {
 'protanopia':   ((0.152286, 1.052583, -0.204868),
                  (0.114503, 0.786281,  0.099216),
                  (-0.003882, -0.048116, 1.051998)),
 'deuteranopia': ((0.367322, 0.860646, -0.227968),
                  (0.280085, 0.672501,  0.047413),
                  (-0.011820, 0.042940, 0.968881)),
 'tritanopia':   ((1.255528, -0.076749, -0.178779),
                  (-0.078411, 0.930809, 0.147602),
                  (0.004733, 0.691367, 0.303900)),
}

def simulate(rgb, kind):
    r, g, b = (srgb2lin(c) for c in rgb)
    M = CVD[kind]
    out = tuple(m[0]*r + m[1]*g + m[2]*b for m in M)
    return tuple(lin2srgb(c) for c in out)

def oklab(rgb):
    r, g, b = (srgb2lin(c) for c in rgb)
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l_, m_, s_ = (math.copysign(abs(v)**(1/3), v) for v in (l, m, s))
    return (0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
            1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
            0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_)

def dE(c1, c2):
    a, b = oklab(c1), oklab(c2)
    return 100*math.sqrt(sum((x-y)**2 for x, y in zip(a, b)))

def relL(rgb):
    r, g, b = (srgb2lin(c) for c in rgb)
    return 0.2126*r + 0.7152*g + 0.0722*b

def contrast(c1, c2):
    a, b = sorted((relL(c1), relL(c2)), reverse=True)
    return (a+0.05)/(b+0.05)

# The Book's categorical "story" colors, from the preamble's own comments.
SERIES = [
 ('pdcobalt',  '#003FB8', 'kernel / truth'),
 ('pdteal',    '#006B5F', 'legibility'),
 ('pdgold',    '#666A00', 'economy / value'),
 ('pdhealth',  '#1F7A4D', 'ready / coordinated'),
 ('pdindigo',  '#353A85', 'protocol / federation'),
 ('pdrust',    '#7A4514', 'reputation / trust earned'),
 ('pdviolet',  '#933FA5', 'identity / continuity'),
]
SURFACE = ('pdcream', '#F2EEE6')

def audit():
    """Return the six checks as data: {series, pairs, counts}. No printing, so
    build_figure_desk.py can import this module without a console report."""
    surf_ = hex2rgb(SURFACE[1])
    series = []
    for n, h, role in SERIES:
        L, a, b = oklab(hex2rgb(h))
        series.append({
            "name": n, "hex": h, "role": role,
            "L": round(L, 4), "chroma": round(math.sqrt(a*a + b*b), 4),
            "contrastOnSurface": round(contrast(hex2rgb(h), surf_), 3),
        })
    pairs = []
    for (n1, h1, _), (n2, h2, _) in itertools.combinations(SERIES, 2):
        c1, c2 = hex2rgb(h1), hex2rgb(h2)
        norm = dE(c1, c2)
        cvd = {k: dE(simulate(c1, k), simulate(c2, k)) for k in CVD}
        worst = min(cvd.values())
        if norm < 15:
            v = "fail-normal-floor"
        elif worst < 6:
            v = "fail-cvd"
        elif worst < 8:
            v = "floor-only"
        else:
            v = "ok"
        pairs.append({
            "a": n1, "b": n2, "normal": round(norm, 2),
            "cvd": {k: round(x, 2) for k, x in cvd.items()},
            "worst": round(worst, 2), "verdict": v,
        })
    pairs.sort(key=lambda p: min(p["normal"], p["worst"]))
    counts = {
        "pairs": len(pairs),
        "fail": sum(1 for p in pairs if p["verdict"].startswith("fail")),
        "floorOnly": sum(1 for p in pairs if p["verdict"] == "floor-only"),
        "clear": sum(1 for p in pairs if p["verdict"] == "ok"),
    }
    return {"surface": {"name": SURFACE[0], "hex": SURFACE[1]},
            "series": series, "pairs": pairs, "counts": counts,
            "floors": {"normalVision": 15, "cvdTarget": 8, "cvdFloor": 6,
                       "contrastOnSurface": 4.5}}


if __name__ == "__main__" and "--json" in __import__("sys").argv:
    import json as _json
    print(_json.dumps(audit(), indent=2))
    raise SystemExit(0)

def _console_report():
    print(f"Surface {SURFACE[0]} {SURFACE[1]}   series n={len(SERIES)}\n")
    surf = hex2rgb(SURFACE[1])

    print("CHECK 1-2  lightness band / chroma floor / contrast vs surface")
    print(f"{'name':10}{'hex':9}{'OKLab L':>9}{'chroma':>8}{'contrast':>10}  verdict")
    for n, h, _ in SERIES:
        L, a, b = oklab(hex2rgb(h))
        C = math.sqrt(a*a + b*b)
        cr = contrast(hex2rgb(h), surf)
        v = 'ok' if cr >= 4.5 else ('WARN' if cr >= 3.0 else 'FAIL')
        print(f"{n:10}{h:9}{L:>9.3f}{C:>8.3f}{cr:>10.2f}  {v}")

    print("\nCHECK 3-5  pairwise separation, normal vision and simulated CVD")
    print("           normal floor 15 (hard fail below); CVD target 8, floor 6")
    rows = []
    for (n1, h1, _), (n2, h2, _) in itertools.combinations(SERIES, 2):
        c1, c2 = hex2rgb(h1), hex2rgb(h2)
        norm = dE(c1, c2)
        cvd = {k: dE(simulate(c1, k), simulate(c2, k)) for k in CVD}
        worst = min(cvd.values())
        rows.append((min(norm, worst), n1, n2, norm, cvd, worst))
    rows.sort()
    print(f"\n{'pair':24}{'normal':>8}{'prot':>7}{'deut':>7}{'trit':>7}{'worst':>8}  verdict")
    for _, n1, n2, norm, cvd, worst in rows:
        if norm < 15:
            v = 'FAIL normal-vision floor'
        elif worst < 6:
            v = 'FAIL cvd'
        elif worst < 8:
            v = 'floor only w/ 2nd encoding'
        else:
            v = 'ok'
        print(f"{n1+'/'+n2:24}{norm:>8.1f}{cvd['protanopia']:>7.1f}"
              f"{cvd['deuteranopia']:>7.1f}{cvd['tritanopia']:>7.1f}{worst:>8.1f}  {v}")

    fails = [r for r in rows if r[3] < 15 or r[5] < 6]
    marg = [r for r in rows if not (r[3] < 15 or r[5] < 6) and r[5] < 8]
    print(f"\n{len(rows)} pairs: {len(fails)} FAIL, {len(marg)} floor-only, "
          f"{len(rows)-len(fails)-len(marg)} clear")


if __name__ == "__main__":
    _console_report()
