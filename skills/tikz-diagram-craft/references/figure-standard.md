# The figure standard (v2)

The rulebook behind `figures/pd-figure-language.tex`. Each rule has a number so a
review can cite it ("fails S4"). The five-point legibility rubric in
`skills/harbor-chartwork/references/craft-rules.md` §1 still applies on top of
these; this file adds the house style.

## S1 Page and measure

- The Book is 7 × 10 in with a 4.5 in text column and a 1.3 in margin column on
  the right. A figure is drawn to the column: ink ≤ 4.5 in (11.43 cm).
- Full width (≤ 6.0 in, column + gutter + margin) is a deliberate choice for a
  figure whose reading direction needs it (a long timeline, a wide sequence).
  Say so in the brief. The margin column may carry notes on that page; a
  full-width figure pushes them down.
- Never `\resizebox`, never `scale=` to fit, never rely on the preamble's
  overflow safety net (it scales, and scaling is how v1 got 5 pt labels).

## S2 Type

- One size, `\footnotesize`, set by `pd figure`. Nothing smaller: no `\scriptsize`,
  no `\tiny`, no `font=\fontsize{6}`. figcheck T1 fails anything under 7 pt.
- Three voices at most in one figure: `pd title` (bold), `pd label` (upright),
  `pd note` (italic, one per figure). Plus `pd tag` (a label knocked out of the
  page) and `pd kind` (a one- or two-word small-caps tag).
- Mixed case everywhere; no ALL-CAPS state names; sentence case titles.
- `\texttt` only for literal identifiers (`fs:read`, `git push`); math only for symbols.
- No hyphenation inside a figure (the language sets the penalties); if a label
  needs to break, give it `text width=` and break it by hand at a word.
- Swiss and technical editions set labels in Heros; maritime in Palatino. Never
  set a font inside a fragment.

## S3 Hue

- The figure's own subject is drawn with `pd focus …`, which resolves to the
  chapter hue (Part I cobalt, II teal, III violet, IV gold). Keep
  `\pdfigurehue{…}` on the line before the tikzpicture as the standalone fallback.
- Other named things take the concept hue for what they are (`pd truth`,
  `pd legible`, `pd ready`, `pd protocol`, `pd identity`, `pd reputation`,
  `pd value`, `pd breach`, `pd warn`). The meaning is the same in every chapter.
- Two to four hues a figure. If a figure needs five, it is two figures.
- Every hue is doubled by a second channel: breach is dashed and its marks are
  diamonds; warn is dashed; regions carry a word; series are named at their ends.
- Amber is never text. A hue as text (`X label`) is mixed 85 % with ink.
- No raw colours in a fragment: not `hhteal`, not `blue!20`, not `pdcobalt!40`.
  A raw colour does not follow the edition overrides.

## S4 Weight

- Three weights: .5 pt (hairline, guide, tick), .9 pt (rule, state edge),
  1.6 pt (spine, focus). The subject is the heaviest line in the figure.
- Arrow tips come from `pd figure` and scale with the stroke; do not set tips inline.

## S5 Surface

- `pd artifact` (white fill, grey edge) is subordinate; `pd state` (neutral
  pale surface, ink edge) is an ordinary thing; `pd focus outline` is a member
  of the subject set; `pd focus state` and `X state` use a pale field with a
  strong same-hue edge; `pd climax state` is the one solid subject the reader
  should retain. `pd terminal` is categorically final and may also be solid.
- Every fill has an edge. Text on ordinary and focus fills is ink. Knocked-out
  white type belongs only on `pd climax state`, a breach/refusal, or a terminal
  state. Swiss must preserve the white/pale/outline/hatch/solid ladder rather
  than flattening every role into an unedged chapter-colour rectangle.
- Regions: `pd focus fill`, `X fill`, `pd neutral fill` (warm grey band), `pd hatch`.
- `pd panel` (dashed, grey) groups things; it never carries a fill.
- Cross-edition parity is semantic, not pictorial: Swiss must retain as many
  visibly distinct surface roles as maritime and technical. It may translate
  texture into edge weight or a pale field, but it may not flatten unlike
  roles into one solid chapter-colour box.

## S6 Ground and knockouts

- The page is white. `pd tag` knocks a label out in white; use it only where a
  label must sit on a rule. Everywhere else, place the label in clear space.
- No cream, sand or paper-coloured backings: on a white page they read as stickers.

## S7 Layout

- Declare the grid once (`\def` pitches and columns) and place every node on it.
  Equal roles get equal geometry: same width, same height, same pitch.
- One reading direction. Straight or orthogonal edges; one controlled curve at
  most; a crossing only when the crossing is the claim.
- A relation word sits beside its edge (half-pitch gutter), never on it; a
  guard or step is a numbered badge on the edge, keyed to a legend.
- Legends are ruled `tabular`s (booktabs rules, badge in the first column) set
  under the picture inside the figure environment, never a paragraph of prose
  inside the tikzpicture.
- 5–8 pt clear space between text and any line or border at final size.

## S8 Content

- Real names and numbers from the chapter: state names from the code, commit
  numbers, the worked example's own values. No anonymous dots, no empty boxes,
  no arrows into white space.
- The figure agrees with the paragraph that cites it and with the caption.
- Remove one element; if the claim survives, leave it removed.

## S9 Caption

- Sentence 1: what is drawn (kind, axes, participants). Sentence 2: what it
  shows, with the number. Then the idealisation, if any. Then `[provenance]`:
  `[internal]`, `[verified, script.py]`, `[internal, closed form]`.
- No caption sentence is the figure's only readable fact.

## S10 Proof

- `book_figure_qa.py` PASS in swiss, maritime and technical: compiles, figcheck
  T1–T5 and T8 clean, ink ≤ column (or ≤ 6.0 in with `--width-in 6` for a
  declared full-width figure).
- `beauty_lint.py` (run by the driver): no fail; every warning (B1 moat,
  B2 crowding, B3 text gap, B4 weights, B5 hues, B6 sizes, B7 near-miss
  alignment, B8 height, B10 provenance) fixed or justified in the report.
- Then a person looks at the contact sheet at 100 %. The machine cannot see a
  label that says the wrong thing, a hierarchy that is backwards, or a figure
  that is a table.

## S11 Plots

- Computed, never sketched: the points come from a committed script, cited in
  the provenance bracket. A curve with no script behind it is a sentence.
- `pd axis`: two spines, ticks out, no box, no grid unless `pd grid`; tick
  words in the label voice; `clip=false` so labels may sit outside the box.
- Series named at their ends (direct labels), not in a legend. The subject
  series is `pd focus series`; others `pd series` or a concept series.
- The worked point is marked (`pd focus datum`) and dropped to its ticks
  with `pd guide`; the tick list includes its coordinate.
- Regions between curves with `fillbetween`, edged; small multiples with
  `groupplots`, same scales in every panel.
- The plot box (`width=` with `scale only axis`) leaves room in the column
  for tick words and direct labels: about 7.5-9 cm of the 11.4 cm.

## S12 Conventions every chapter shares (Critical Analysis, 2026-09-08)

- Automata: states are circles (`pd automaton state`, `pd automaton focus`),
  terminal states double circles (`pd automaton terminal`), an initial arrow
  (`pd initial`); edge words are short action names; guards live in an aligned
  legend table under the picture. Named lifecycle phases with long names may
  stay rounded rectangles (`pd state`), terminal ones double-bordered (`pd terminal`).
- Ledgers: asset pools are rectangular buckets open at the top (`pd bucket`)
  joined by directed pipes (`pd pipe`, `pd focus pipe`); the conserved sum is an
  equation set under the rails.
- Trust boundaries: a dashed rectangle (`pd trust boundary`) is the Dolev-Yao
  interface; any vector that escapes it is drawn in `pd breach` and named.

## S13 The K&R register (pedagogical advice, 2026-09-08)

- A figure is a mental model of the machine, the way K&R's memory diagrams and
  SICP's box-and-pointer drawings are: concrete records, the epoch counter, the
  bytes of a card, the rows of the journal, with real values.
- Each canonical term (the fencing lease, digest-with-zoom, the float plan, the
  laundering residual, ...) gets one iconic drawing, defined where the term is
  introduced; later chapters cross-reference it rather than redraw it.
- No schema is drawn twice. A figure that two chapters need is drawn once and
  referenced; a variant draws only the difference.
- Density over decoration: every mark carries data or orients the reader.
