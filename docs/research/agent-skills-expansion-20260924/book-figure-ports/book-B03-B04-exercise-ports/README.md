# Offline Book exercise ports

Two TikZ fragments, each in Swiss/maritime/technical. Six standalone PDF/PNG renders plus six 7-by-10 page previews. Start at index.html. Exact checks and limitations: VALIDATION.json. Source/import hashes: source-receipt.json. Font/bounds evidence: geometry-font-checks.json and renders/*-fonts.txt / *-bbox.html. Compile logs and resolved imports are retained in renders/*.log / *.fls.

Reproduce with python3 build.py from the assigned handoff directory. This writes only this artifact directory. Requires installed pdflatex and pdftocairo plus the copied Book styles; no Port Daddy runtime. The final build has no layout warnings. Full figcheck unavailable (PyMuPDF missing); Poppler and actual-page visual checks are explicitly narrower.

No Book edits or source integration. Earlier seven ports preserved. The active style sources use the vocabulary of the accepted ports; this is not a migration to the newer vocabulary described in the installed craft skill.
