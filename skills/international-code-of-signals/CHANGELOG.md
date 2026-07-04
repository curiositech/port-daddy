# Changelog

## 1.1.0 — 2026-07-04

- `search` is now hybrid per the repo search policy: BM25 + semantic cosine over Port Daddy's shared local embedding model (`pd embed`, ADR-0061), fused with weighted RRF (0.7 lexical / 1.3 semantic, symmetric top-50). Corpus embeddings are computed once and cached under `~/.port-daddy/cache/` keyed by corpus hash. When the model is unavailable, search degrades to lexical-only with a loud stderr warning pointing at `pd doctor`. Probe suite: "person fell into the sea" now surfaces `O` (Man overboard) — invisible to BM25 alone.

## 1.0.0 — 2026-07-04

- Initial release, built from Pub. 102 (International Code of Signals, US Edition 1969, Revised 2003, NIMA).
- `data/signals.json`: parsed corpus — 26 single-letter signals (+12 numeral-complement forms), 645 two-letter General Code signals + 723 complements, 445 Medical Code signals, procedure signals, Morse, phonetic tables, Complements Tables 1–3, icebreaker session table. Parser verified against raw text (645/645 unique two-letter codes; substitute-hoist logic matches all three worked examples in Ch.1 §5 ¶6).
- `scripts/icos_lookup.py`: code lookup, BM25 meaning search, phonetic/Morse spelling, hoist rendering with substitute logic, complements tables.
- `scripts/rebuild_corpus.py`: regenerates the corpus from a `pdftotext -layout` extraction.
- References: signaling instructions, single-letter + procedure signals, General Signal Code, Medical Signal Code, distress and lifesaving, agent-protocol adaptation (10 mechanisms), Port Daddy symbology audit.
