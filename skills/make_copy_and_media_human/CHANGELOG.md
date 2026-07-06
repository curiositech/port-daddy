# Changelog

## 0.2.0 — 2026-07-04

Upgraded to the port-daddy agentic-family bundle standard. Frontmatter-only
upgrade — `scripts/humanize_review.py` already is this skill's deterministic
auditor (structural checks + merge point for judge-pass findings), so no
second `.mjs` scorer was added.

- Frontmatter: added `metadata.io-contract` (consumes draft copy/media +
  judge findings; produces humanized copy/media, audit findings, and the
  HTML fix-plan report).
- Frontmatter: replaced dangling `pairs-with` entries (`vibe-matcher`,
  `design-critic`, `seo-content-blogging` — none exist under `skills/` in
  this repo) with verified in-repo skills: `port-daddy-marketing-copy`,
  `port-daddy-expository-writer`, `web-design-expert`.
- Confirmed `metadata.provenance` was already block-style (compliant).
- Added `README.md`, `agents/openai.yaml`, and
  `templates/output-template.md` for bundle completeness; cross-referenced
  both new template/agent files from `SKILL.md`.

## 0.1.0 — 2026-06-12

Initial release. Catalog of 70 AI-isms across 10 model dialects and 10 media,
built by a six-lens research team (Claude prose tropes; GPT/Codex; Gemini,
Kimi, DeepSeek, Qwen, Llama, Grok dialects; visual design; document/deck
structure; published stylometry catalogs — 66 cited sources).

- `skills/make_copy_and_media_human/scripts/humanize_review.py`: structural detector layer + static HTML
  line-item fix-plan renderer, stdlib only, selftested.
- `skills/make_copy_and_media_human/scripts/regenerate_references.py`: references/*.md derive from catalog.json.
- Two-layer detection honors the no-keyword-NLP rule: scripts measure,
  the model judges.
