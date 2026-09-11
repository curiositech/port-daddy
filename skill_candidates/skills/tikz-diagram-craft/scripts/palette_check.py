#!/usr/bin/env python3
"""palette_check.py -- the colour gate for a Book figure.

Two questions a figure's palette has to answer before it is drawn, both
answered here from the hexes in figures/pd-palette.tex:

  1. Can a reader tell these two hues apart?  CIEDE2000 (dE00) between every
     pair you put next to each other.  The Book's palette v2 was itself gated
     this way (website-v2/public/design-preview/proposal.html: the closest pair
     that never drew a complaint sits at 6.1, and v2 puts every semantic pair
     at 14.6-21.3).  This script uses 10.0 as the floor for two hues that must
     be told apart inside one figure, and reports the number either way.

  2. Is the text on it legible?  WCAG 2.x contrast ratio for ink on a tint and
     for a hue used as text.  4.5:1 is the floor for text below 18 pt, which is
     every word in a figure.

Usage:
  palette_check.py --pairs pdcobalt pdteal pderror      # every pair, dE00
  palette_check.py --on-fill pdcobalt 24                # ink on a 24 % tint
  palette_check.py --as-text pderror                    # hue used as text
  palette_check.py --figure pdcobalt pdteal pdgold pderror
                                                        # both, for one figure
  palette_check.py --list                               # the palette

Exit status: 0 when every reported pair and ratio clears its floor, 1 otherwise.
"""
import argparse
import itertools
import sys

# figures/pd-palette.tex, light values (source of record:
# website-v2/src/styles/tokens.semantic.css).
PALETTE = {
    "pdcobalt": "003FB8", "pdteal": "006B5F", "pdhealth": "1F7A4D",
    "pdindigo": "353A85", "pdviolet": "933FA5", "pdrust": "7A4514",
    "pdgold": "666A00", "pderror": "BF2F2F", "pdamber": "A66F00",
    "pdlime": "CAD900", "pdink": "121212", "pdinkmuted": "403B34",
    "pdcream": "F2EEE6", "pdcreamraised": "F7F3EB", "pdcreamstrong": "E9E2D5",
}
PAGE = "FFFFFF"          # a Book body page is \nopagecolor: white
DE_FLOOR = 10.0
CONTRAST_FLOOR = 4.5


def rgb(h):
    h = PALETTE.get(h, h).lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def mix(name, pct, onto=PAGE):
    """xcolor's `name!pct` mixes toward the surrounding colour (white here)."""
    a, b = rgb(name), rgb(onto)
    f = pct / 100.0
    return tuple(a[i] * f + b[i] * (1 - f) for i in range(3))


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(c):
    r, g, b = (_lin(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(c1, c2):
    l1, l2 = sorted((luminance(c1), luminance(c2)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def to_lab(c):
    r, g, b = (_lin(x) for x in c)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = (0.2126 * r + 0.7152 * g + 0.0722 * b)
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 216 / 24389 else (841 / 108) * t + 4 / 29
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def ciede2000(c1, c2):
    import math
    L1, a1, b1 = to_lab(c1)
    L2, a2, b2 = to_lab(c2)
    kL = kC = kH = 1.0
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7))) if Cb else 0.5
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360 if (b1 or a1p) else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360 if (b2 or a2p) else 0.0
    dLp, dCp = L2 - L1, C2p - C1p
    if C1p * C2p == 0:
        dhp = 0.0
    elif abs(h2p - h1p) <= 180:
        dhp = h2p - h1p
    else:
        dhp = h2p - h1p - 360 if h2p > h1p else h2p - h1p + 360
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp) / 2)
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    if C1p * C2p == 0:
        hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hbp = (h1p + h2p) / 2
    else:
        hbp = (h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2
    T = (1 - 0.17 * math.cos(math.radians(hbp - 30))
         + 0.24 * math.cos(math.radians(2 * hbp))
         + 0.32 * math.cos(math.radians(3 * hbp + 6))
         - 0.20 * math.cos(math.radians(4 * hbp - 63)))
    dTh = 30 * math.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) if Cbp else 0.0
    Sl = 1 + (0.015 * (Lbp - 50) ** 2) / math.sqrt(20 + (Lbp - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    Rt = -math.sin(math.radians(2 * dTh)) * Rc
    return math.sqrt((dLp / (kL * Sl)) ** 2 + (dCp / (kC * Sc)) ** 2
                     + (dHp / (kH * Sh)) ** 2
                     + Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pairs", nargs="+", metavar="HUE")
    ap.add_argument("--on-fill", nargs=2, metavar=("HUE", "PCT"))
    ap.add_argument("--as-text", nargs="+", metavar="HUE")
    ap.add_argument("--figure", nargs="+", metavar="HUE",
                    help="every pair's dE00 plus ink-on-24%%-tint for each hue")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args(argv)
    ok = True
    if a.list:
        for k, v in PALETTE.items():
            print(f"{k:16s} #{v}")
        return 0
    hues = a.pairs or a.figure
    if hues:
        for x, y in itertools.combinations(hues, 2):
            d = ciede2000(rgb(x), rgb(y))
            flag = "ok  " if d >= DE_FLOOR else "TOO CLOSE"
            ok &= d >= DE_FLOOR
            print(f"dE00 {x:14s} {y:14s} {d:6.1f}  {flag}")
    if a.figure:
        for h in a.figure:
            c = contrast(rgb("pdink"), mix(h, 24))
            ok &= c >= CONTRAST_FLOOR
            print(f"ink on {h}!24 tint {' ':6s} {c:6.2f}:1  "
                  f"{'ok' if c >= CONTRAST_FLOOR else 'TOO LOW'}")
    if a.on_fill:
        h, pct = a.on_fill[0], float(a.on_fill[1])
        c = contrast(rgb("pdink"), mix(h, pct))
        ok &= c >= CONTRAST_FLOOR
        print(f"ink on {h}!{pct:g} tint {c:6.2f}:1  "
              f"{'ok' if c >= CONTRAST_FLOOR else 'TOO LOW'}")
    for h in (a.as_text or []):
        c = contrast(rgb(h), rgb(PAGE))
        ok &= c >= CONTRAST_FLOOR
        print(f"{h} as text on the page {c:6.2f}:1  "
              f"{'ok' if c >= CONTRAST_FLOOR else 'TOO LOW -- rules and fills only'}")
    if not (a.pairs or a.figure or a.on_fill or a.as_text):
        ap.print_help()
        return 2
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
