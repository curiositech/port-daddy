# Changelog

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
