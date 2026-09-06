# Harbor Chartwork

Deterministic figure-QA tooling for the three Harbor TikZ figure corpora
(`website-v2/public/whitepaper/figures/`, `whitepaper/figures/`,
`docs/harbor-research/figures/`). See `SKILL.md` for the QA loop and script
CLIs.

## Structure

```
harbor-chartwork/
├── SKILL.md                    # Core instructions, script CLI table, references
├── CHANGELOG.md                # Version history
├── README.md                   # This file
├── references/
│   ├── corpus-audit.md         # Generated inventory -- see build_corpus_audit.py
│   ├── taxonomy.md             # Pending (book's author)
│   ├── craft-rules.md          # Pending (book's author)
│   └── research-notes.md       # Pending (book's author)
├── scripts/
│   ├── compile_fragment.sh     # Wrap + compile one fragment standalone
│   ├── figcheck.py             # T1-T7 rendered-geometry checks
│   ├── tikz_precheck.py        # Source-level lint, no TeX needed
│   ├── contact_sheet.py        # Batch review grid
│   └── build_corpus_audit.py   # Regenerates references/corpus-audit.md
└── tests/
    ├── test_figcheck.py
    └── test_tikz_precheck.py
```

## Quick start

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 scripts/build_corpus_audit.py --skip-compile   # fast, lint-only pass
python3 scripts/build_corpus_audit.py                  # full loop, needs tectonic
```
