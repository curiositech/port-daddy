# international-code-of-signals

Expert skill on the International Code of Signals (Pub. 102, 1969 edition, revised 2003) — the IMO-adopted system for maritime communication across flag hoists, flashing light, sound, radiotelephony, and hand flags — plus two transfer layers: adapting ICOS mechanisms to **inter-agent communication protocol design** and to **Port Daddy's maritime symbology** (`SIGNAL_FOR_STATE`, hoists, alert tiers).

## What's inside

| Path | Contents |
|---|---|
| `SKILL.md` | Core workflow, non-negotiables, anti-patterns, reference index |
| `data/signals.json` | Machine-readable corpus parsed from Pub. 102: 26 single-letter + 645 two-letter + 445 medical signals, complements, procedure signals, Morse, phonetics, tables |
| `scripts/icos_lookup.py` | CLI: exact code lookup, BM25 meaning search, phonetic/Morse spelling, hoist rendering with substitute logic, complements tables |
| `scripts/rebuild_corpus.py` | Regenerates the corpus from `pdftotext -layout` output of the Pub. 102 PDF |
| `references/` | Chapter distillations (transmission, single letters, general code, medical code, distress) + the two adaptation references |
| `examples/worked-examples.md` | Encode/decode walkthroughs across methods and both transfer layers |

## Quick start

```bash
python3 scripts/icos_lookup.py code NC        # I am in distress and require immediate assistance.
python3 scripts/icos_lookup.py search pilot   # ranked matches across all 1100+ signals
python3 scripts/icos_lookup.py hoist 1100     # substitutes computed per Ch.1 §5 ¶6
```

## Provenance

Parsed from *Pub. 102, International Code of Signals for Visual, Sound, and Radio Communications*, United States Edition 1969 (Revised 2003), National Imagery and Mapping Agency — a US Government publication (no copyright claimed under 17 U.S.C.). Parser coverage verified against the raw extraction: all 645 unique two-letter codes and all 445 medical codes captured; hoist substitute logic matches the book's three worked examples.
