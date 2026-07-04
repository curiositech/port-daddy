# Changelog

## 1.0.0 — 2026-07-04

- Initial release, built from Pub. 102 (International Code of Signals, US Edition 1969, Revised 2003, NIMA).
- `data/signals.json`: parsed corpus — 26 single-letter signals (+12 numeral-complement forms), 645 two-letter General Code signals + 723 complements, 445 Medical Code signals, procedure signals, Morse, phonetic tables, Complements Tables 1–3, icebreaker session table. Parser verified against raw text (645/645 unique two-letter codes; substitute-hoist logic matches all three worked examples in Ch.1 §5 ¶6).
- `scripts/icos_lookup.py`: code lookup, BM25 meaning search, phonetic/Morse spelling, hoist rendering with substitute logic, complements tables.
- `scripts/rebuild_corpus.py`: regenerates the corpus from a `pdftotext -layout` extraction.
- References: signaling instructions, single-letter + procedure signals, General Signal Code, Medical Signal Code, distress and lifesaving, agent-protocol adaptation (10 mechanisms), Port Daddy symbology audit.
