# premium-deck-builder

Operational guidance for constructing PowerPoint / Keynote / Reveal.js / Marp decks that are both legible and feel premium.

## Files

- `SKILL.md` — the entry point. Load this for the decision flow, anti-patterns, quality gates.
- `references/typography.md` — type sizes by context, contrast, case rules, numeric figures.
- `references/composition.md` — grids, focal modes (Reynolds / Duarte / Minto), assertion-evidence, slide-type catalog.
- `references/premium-aesthetic.md` — exemplar decks, margins, color discipline, what reads as cheap.
- `references/bibliography.md` — annotated reading list (Duarte, Reynolds, Tufte, Alley, Knaflic, Minto).
- `references/tooling.md` — copy-pasteable patterns for python-pptx, Reveal.js, Marp, plus the verification pipeline.
- `examples/notebook-deck.md` — walks through the 15-slide ET-Book interview deck applying the skill.
- `scripts/render_deck.sh` — `.pptx` → PDF → per-slide PNGs via `soffice` + `pdftoppm`.
- `scripts/check_deck_quality.py` — automated audit (font sizes, palette size, ALL-CAPS titles, "Thank you!" closer, etc.).

## Provenance

Authored from a 4-agent parallel research pass (typography / composition / premium aesthetic / bibliography), synthesized via the `skill-architect` skill conventions. Worked example built and verified live during authoring — the lessons in FM-1 (web-to-PPTX grid translation) and FM-5 (fabricated content) come from real failures caught during the worked-example build.

## Adjacent skills

- `typography-expert` — general web/print typography; this skill is its slide cousin.
- `tech-presentation-interview` — for *delivering* a presentation, not building one.
- `frontend-design`, `web-design-expert` — for the web property *about* the deck.
- `color-theory-palette-harmony-expert` — for picking the accent color with care.
- `data-viz-2025`, `mermaid-graph-writer` — for chart and diagram specifics.
- `example-skills:pptx`, `claude-api:pptx` — generic PPTX building tooling that this skill prescribes WHAT to put in.

## License

MIT. Use, fork, improve.
