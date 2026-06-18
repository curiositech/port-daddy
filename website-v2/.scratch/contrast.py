def _lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

def lum(hexc):
    h = hexc.lstrip('#')
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)

def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def grade(r, large=False):
    if r >= 7: return "AAA"
    if r >= 4.5: return "AAA-large" if large else "AA"
    if r >= 3: return "AA-large/UI"
    return "FAIL"

# --- candidate palette (light theme) ---
PAPER   = "#faf8f4"   # warm paper
INK     = "#15130f"   # body ink
MUTED   = "#5c5448"   # meta / eyebrow on paper (darkened for AAA)
HAIR    = "#e2ddd4"   # hairline rule (non-text)
ACCENT_INK  = "#a8311a"  # deep vermilion: links/text on paper + button fill
ACCENT_DECO = "#e8482b"  # bright vermilion: large/non-text decoration only

# --- dark surfaces (code blocks + dark theme) ---
CODEBG  = "#1b1a17"
CODEINK = "#ece7dd"   # code text on dark
ACCENT_BRIGHT = "#ff9d76"  # accent as text/mark on dark (needs to be light)
WHITE = "#ffffff"

checks = [
    ("body ink on paper",        INK, PAPER, False),
    ("muted/eyebrow on paper",   MUTED, PAPER, False),
    ("link/accent-ink on paper", ACCENT_INK, PAPER, False),
    ("white on accent-ink (CTA)",WHITE, ACCENT_INK, False),
    ("hairline rule on paper",   HAIR, PAPER, True),    # non-text/UI -> 3:1
    ("accent-deco rule on paper",ACCENT_DECO, PAPER, True),  # non-text -> 3:1
    ("code text on codebg",      CODEINK, CODEBG, False),
    ("accent-bright on codebg",  ACCENT_BRIGHT, CODEBG, False),
    ("paper text on codebg(darkmode body)", "#e8e3d9", CODEBG, False),
]
print(f"{'combo':38} {'ratio':>6}  grade")
print("-"*60)
allpass = True
for name, fg, bg, large in checks:
    r = ratio(fg, bg)
    g = grade(r, large)
    needtext = (not large)
    ok = (r >= 7) if needtext else (r >= 3)
    allpass = allpass and ok
    flag = "" if ok else "   <-- below target"
    print(f"{name:38} {r:6.2f}  {g}{flag}")
print("-"*60)
print("ALL TARGETS MET" if allpass else "SOME TARGETS MISSED")
