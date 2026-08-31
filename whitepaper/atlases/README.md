# Corpus atlases

The corpus manifest registers two installed-skill satellites:

- `skills/whitepaper-figure-system/references/semantic-figure-atlas.md` records
  every figure's explanatory job, visual form, and chapter location. Its checker
  verifies that the atlas covers every figure in the seven source roots.
- `skills/high-quality-latex-whitepaper/SKILL.md` carries the reusable visual
  grammar and rendering discipline used across chapters.

They remain inside `skills/` because the installed skills must be portable and
self-contained. This directory is their corpus-facing index; it is not a copy.
The locations are enforced by `whitepaper/corpus.json`.
