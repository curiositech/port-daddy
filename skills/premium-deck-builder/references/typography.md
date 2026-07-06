# Typography for Slides

Loaded when picking type or auditing legibility for a deck.

Slide typography is **not** web typography. Audiences are 6–20 feet from a projection, viewing a screen-share at 25–50% scale on someone else's display, or skimming a slidedoc on a phone. The math changes.

## Minimum sizes (points, at native slide resolution)

| Context | Body | Title | Caption | Eyebrow |
|---|---|---|---|---|
| **Projection** (6–20 ft) | 24pt floor, 28–32pt comfortable, 36pt+ for key takeaways | 36–44pt | 18pt absolute floor | 14pt (≥600 weight, all-caps OK) |
| **Screen-share** (Zoom/Meet, 25–50% downsampled) | 28pt floor, 32pt comfortable | 40–48pt | 20pt | 16pt |
| **Slidedoc** (read at 18″) | 10–12pt | 18–24pt | 9pt | 9pt |

**Kawasaki's 10/20/30 rule** (guykawasaki.com, 2005): *"Find the oldest person in the audience, divide their age by two — that's your minimum point size."* For a 60-year-old in row 3: 30pt floor.

**Why screen-share is MORE demanding than in-room projection:** the viewer's effective rendering is roughly half your nominal — your 24pt body becomes their 12pt. Treat Zoom decks like the audience is far AND has bad eyes.

**Slidedoc as a distinct format** (Duarte, *Slidedocs*, 2014, free PDF at duarte.com): a deck designed to be *read* asynchronously, not presented. The ONLY context where sub-18pt body is defensible. Tag the file so nobody projects it (`-SLIDEDOC.pptx` suffix is a good convention).

## Serif vs sans at distance

- **Sans wins at projection.** Low-resolution projectors, bulb falloff, and dim ambient light destroy serif terminals. Use humanist sans: Calibri, Aptos, Source Sans, Inter, Helvetica Neue, Söhne.
- **Serif wins for slidedocs and high-DPI screen reading.** The same reasons serifs aid long-form print reading apply when the deck is a document. Georgia, Charter, Source Serif, Tiempos.
- **Editorial / "thoughtful" pitch decks can use serif display + sans body** on screen-share or PDF — the contrast itself signals craft (Sequoia memos pattern).
- **Michael Alley** (*Craft of Scientific Presentations*, Springer 2nd ed. 2013) recommends sans-serif throughout for technical decks in lecture halls.

## Line length

Print's 45–90 character rule does **not** transfer. Slides are scanned, not read.

- **Target:** 6–8 words per line, max ~40 characters.
- **Hard caps:** 6 lines per slide (Reynolds), 40 words total per slide (Duarte's "glance test" — comprehensible in 3 seconds).
- **Slidedoc mode exception:** 75–150 words per page is fine because it's being read at 18″.

## Contrast

| Surface | Minimum |
|---|---|
| Projector | **7:1** (WCAG AAA). Bulb age + ambient light eat 2–3 stops; pure black on pure white is correct here. |
| LCD screen-share | **4.5:1** body, **3:1** for 24pt+ titles (WCAG AA). |
| OLED slidedoc on phone | **4.5:1**. Avoid #FFF on #000 — the halation is fatiguing. Use #F0F0F0 on #121212. |

## Font pairing

- **One display + one body** is the ceiling. Optional third: mono for metadata. Nancy Duarte: *"Two fonts. Maybe three. Never four."*
- **System-font-safe stack** (when you cannot embed):
  - macOS: SF Pro Display + SF Pro Text + SF Mono
  - Windows: Aptos Display + Aptos + Cascadia Mono
  - Universal: Helvetica Neue + Helvetica + Menlo (with Arial fallback)
- **PowerPoint font embedding is unreliable** across PPT/Keynote/Google Slides round-trips. Assume substitution. The two safe paths:
  1. Embed-and-test on the actual playback machine.
  2. Export to PDF for delivery; keep `.pptx` only for the maker.
- **Foundry-licensed type for premium feel:** Söhne (Klim), Tiempos (Klim), GT Sectra (Grilli), Berkeley Mono (US Graphics), Inter Display (Rasmus Andersson). Per-style desktop licenses run from low double digits per cut; verify on the foundry's purchase page.

## Case for titles

- **Sentence case beats ALL CAPS** for titles longer than 3 words.
- All-caps loses word-shape cues and tests ~13–20% slower for reading (Tinker, *Legibility of Print*, Iowa State 1963; reconfirmed by Arditi & Cho, "Letter case and text legibility in normal and low vision," *Vision Research* 47, 2007).
- **All-caps is acceptable only for** short eyebrow labels (≤2 words) at ≥600 weight with letter-spacing ≥0.1em — the "tracked-out small caps" pattern that consulting decks use for section markers.

## Numeric typography

Slide decks live or die on the credibility of their numbers. Three rules:

1. **Tabular figures** for any column of numbers. Prevents digit jitter between rows.
   - In python-pptx: set `font-feature-settings: 'tnum' 1` via the run's XML `rPr`.
   - In PowerPoint: Font dialog → "Number forms: Tabular."
   - In Reveal.js: `font-variant-numeric: tabular-nums;` in the slide CSS.
2. **Slashed zero** (`zero` OpenType feature) for slides showing IDs, hashes, ports, serial numbers, anything 0/O-adjacent. Fonts with built-in slashed zero: Source Code Pro, JetBrains Mono, Geist Mono, Consolas (alt), Inter (`ss02`).
3. **Lining figures (`lnum`)** for titles and KPIs — digits align to cap height. Old-style figures only for body text in editorial / book-like slidedocs.

## Variable-font axes for slides (when supported)

- **Optical size (`opsz`)** — bind to type roles so display sizes get the Display cut (looser spacing, less hairline contrast) and body gets the Text cut. Inter, Roboto Flex, Fraunces, Source Serif all expose this. Most foundry decks ignore it; turning it on is a craft signal.
- **Grade (`GRAD`)** — for dark-mode slides, set GRAD to -25 to -50 to compensate for the "thinning illusion" white text on black shows. Roboto Flex and SF Pro support GRAD.
- **Width (`wdth`)** — useful for fitting long titles on a single line without dropping weight. Use cautiously; can read as "I ran out of space."

## Anti-patterns to refuse

1. **12pt body for projection** — the cardinal sin.
2. **The wall of bullets** — 8+ full-sentence bullets at 14pt. Tufte's indictment in *Cognitive Style of PowerPoint*. Convert to slidedoc or split.
3. **ALL CAPS title that wraps to two lines** — loses word shape AND eats vertical space.
4. **Light grey on white** (#999 on #FFF ≈ 2.8:1) — fails AA on LCD, invisible on projector. Designers ship this constantly because it looks elegant on their Retina display in a dim office.
5. **Embedded designer font with no fallback** — Gotham/Proxima/Founders Grotesk render as Calibri on the client's Dell.
6. **Mixed figure styles in a KPI row** — proportional old-style 1 next to tabular lining 7 makes revenue look like a typo.
7. **Smart quotes mixed with straight quotes** — single most-grepped tell of a deck assembled from multiple sources without an editor.

## Sources

- Nancy Duarte, *Slide:ology* (O'Reilly, 2008); *Slidedocs* (2014, free PDF, duarte.com).
- Garr Reynolds, *Presentation Zen*, 3rd ed. (New Riders, 2019).
- Edward Tufte, *The Cognitive Style of PowerPoint: Pitching Out Corrupts Within*, 2nd ed. (Graphics Press, 2006).
- Michael Alley, *The Craft of Scientific Presentations*, 2nd ed. (Springer, 2013).
- Guy Kawasaki, "The 10/20/30 Rule of PowerPoint" (guykawasaki.com, 2005).
- Tinker, *Legibility of Print* (Iowa State, 1963).
- Arditi & Cho, "Letter case and text legibility in normal and low vision," *Vision Research* 47 (2007).
