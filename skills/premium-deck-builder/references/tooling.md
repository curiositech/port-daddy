# Tooling — Build Pipelines for Decks

Load when picking a build tool or writing the generator script.

## Decision: which tool

| Tool | Best for | Cost | Token-friendly? |
|---|---|---|---|
| **python-pptx** | Programmatic decks from data; templated content; reproducible builds | free | yes — deck-as-code, easy to diff |
| **Reveal.js** | Web embeds, live demos, audience-controllable, conference talks | free | yes — Markdown source |
| **Marp** | Engineers who want pure Markdown → PPTX/PDF/HTML | free | yes — Markdown with directives |
| **Keynote (native)** | One-off polish, image-heavy decks, designer-handoff | Mac only | no — binary |
| **PowerPoint (native)** | Client deliverables that need to be editable on Windows | $ | no — binary |
| **Google Slides** | Real-time collaboration | free | no — proprietary |
| **Pitch.com** | Modern collaborative web-native | $ | no — proprietary |
| **Figma slides** | Designers who already live in Figma | $ | no — proprietary |

**Default choice for an agent**: python-pptx. It's reproducible, version-controllable, diffable, and the worked example below shows the pattern.

**Sibling skills already in the catalog:**
- `example-skills:pptx` — generic PPTX building.
- `claude-api:pptx` — same.
- This skill (`premium-deck-builder`) is the design-aware layer on top: it tells you WHAT to put on each slide.

## python-pptx pattern (recommended)

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

# ── Tokens (from the brand / portfolio if one exists) ────────────────────
PAPER = RGBColor(0xFA, 0xF7, 0xF0)   # warm off-white
INK   = RGBColor(0x1A, 0x25, 0x40)   # navy
RED   = RGBColor(0xB8, 0x39, 0x2B)   # accent

FONT_DISPLAY = 'Georgia'              # universally available; stand-in for ET Book / Tiempos
FONT_BODY    = 'Helvetica Neue'       # falls back to Helvetica / Arial / Liberation
FONT_MONO    = 'Menlo'                # macOS; PowerPoint substitutes on Windows

SLIDE_W, SLIDE_H = Inches(13.333), Inches(7.5)  # 16:9 widescreen

# ── Set slide size + background ──────────────────────────────────────────
prs = Presentation()
prs.slide_width, prs.slide_height = SLIDE_W, SLIDE_H
slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank layout
slide.background.fill.solid()
slide.background.fill.fore_color.rgb = PAPER

# ── Add a textbox with one styled paragraph ──────────────────────────────
def add_text(slide, *, text, left, top, width, height, font=FONT_BODY,
             size=18, color=INK, bold=False, italic=False,
             align=PP_ALIGN.LEFT, tracking_em=0):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0)
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    f = run.font
    f.name = font; f.size = Pt(size); f.bold = bold; f.italic = italic
    f.color.rgb = color
    if tracking_em:
        # No python-pptx helper for letter-spacing; set via XML directly.
        rPr = run._r.get_or_add_rPr()
        rPr.set('spc', str(int(tracking_em * 100)))  # spc is 1/100 pt
    return box

# ── Tabular figures + slashed zero on a numeric run ──────────────────────
# Set in run.font._element XML, or set the font choice to one that defaults
# to those features (Geist Mono, Berkeley Mono ship `tnum zero` by default).

# Output
prs.save('deck.pptx')
```

**Worked example using exactly this pattern**: see `examples/notebook-deck.md` and `~/coding/some_claude_skills/erichowens_com/scripts/build_interview_deck.py` — a 15-slide interview deck for a Staff+EM applicant.

## Reveal.js pattern

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Deck</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/white.css">
  <style>
    :root {
      --paper: #FAF7F0; --ink: #1A2540; --red: #B8392B;
      --grid: rgba(143, 166, 199, 0.28);
    }
    .reveal { font-family: 'Helvetica Neue', system-ui, sans-serif; color: var(--ink); }
    .reveal section {
      background-color: var(--paper);
      background-image:
        linear-gradient(var(--grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    .reveal h1, .reveal h2 { font-family: 'Georgia', serif; font-weight: 400; }
    .reveal .eyebrow {
      font-family: 'Menlo', monospace; font-size: 0.6em; font-weight: 600;
      letter-spacing: 0.18em; text-transform: uppercase; color: #6B7791;
    }
    .reveal .accent { color: var(--red); }
    .reveal .numeric { font-variant-numeric: tabular-nums slashed-zero; }
  </style>
</head>
<body>
  <div class="reveal"><div class="slides">
    <section>
      <p class="eyebrow">§ 01 / Cover</p>
      <h1>Slide title here<span class="accent">.</span></h1>
      <p>Subtitle in serif italic.</p>
    </section>
    <!-- more sections -->
  </div></div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
  <script>Reveal.initialize({ hash: true });</script>
</body>
</html>
```

## Marp pattern (Markdown → PPTX/PDF/HTML)

```markdown
---
marp: true
theme: default
size: 16:9
paginate: true
backgroundColor: '#FAF7F0'
color: '#1A2540'
header: '§ 01 / Cover'
footer: 'erichowens.com'
style: |
  section { font-family: 'Helvetica Neue', system-ui, sans-serif; }
  h1, h2 { font-family: 'Georgia', serif; font-weight: 400; letter-spacing: -0.02em; }
  .eyebrow { font-family: 'Menlo', monospace; font-size: 0.7em; letter-spacing: 0.18em; text-transform: uppercase; color: #6B7791; }
  .accent { color: #B8392B; }
  .numeric { font-variant-numeric: tabular-nums slashed-zero; }
---

# Slide title here<span class="accent">.</span>

<span class="eyebrow">subtitle in mono</span>

---

## § 02 — Comment ranking

Conclusion in the title, not the body.

![bg right:40%](./illustration.png)

- Single assertion supported by the image.
- Three bullets max if you need them.
- Otherwise: chart, quote, or image carries it.

---

# Discussion<span class="accent">.</span>

<span class="numeric">02 / 15</span>
```

Build:
```bash
npm install -g @marp-team/marp-cli
marp deck.md -o deck.pptx       # → PowerPoint
marp deck.md -o deck.pdf        # → PDF
marp deck.md -o deck.html       # → standalone HTML
```

## Verification pipeline (ALWAYS run before declaring done)

```bash
# Prereq (one-time):
brew install --cask libreoffice    # macOS
brew install poppler                # for pdftoppm

# Render any .pptx (or .key after converting) → PDF → per-slide PNG.
soffice --headless --convert-to pdf deck.pptx --outdir /tmp/render/
pdftoppm -png -r 144 /tmp/render/deck.pdf /tmp/render/slide

# Then ACTUALLY LOOK at the PNGs.
```

The skill ships `scripts/render_deck.sh` which wraps this. Reading the deck source is not the same as seeing the slide — render-and-look is mandatory.

## Quality audit (programmatic)

`scripts/check_deck_quality.py <deck.pptx>` runs an automated audit checking:
- Body font sizes (flags <18pt anywhere)
- Number of distinct fonts (flags >3)
- Number of distinct colors (flags >6 across the whole deck)
- "Thank you" / "Questions?" on the final slide
- Title case patterns (flags ALL CAPS titles >3 words)
- Tabular-figures usage on numeric runs (warns if absent)

Run it. Treat its warnings as defect signals, not noise.

## Font embedding caveats

- **PowerPoint .pptx embedding**: File → Options → Save → "Embed fonts in the file." Reliable for Latin, breaks on CJK, fails silently on Mac → Windows round-trips.
- **Keynote**: System fonts only by default. Custom fonts require installing on the playback machine.
- **Google Slides**: Limited to Google Fonts. Foundry fonts substituted silently.
- **PDF export**: The safe delivery. All fonts embedded, no substitution. Lose interactivity, gain reliability.

When in doubt: **deliver a PDF**. Keep the editable file (`.pptx` / `.key` / `.md`) for the maker; ship the PDF to the audience.

## Audio / video / animations

Out of scope. If you need them:
- Video embedded in PPTX: native PowerPoint Insert Video. Test on the playback machine.
- Reveal.js fragments / transitions: built-in; respect `prefers-reduced-motion`.
- Marp doesn't do transitions. Use Reveal.js if you need them.
- Anything more involved → `motion-design-web` or `animation-system-architect`.
