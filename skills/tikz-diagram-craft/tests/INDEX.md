# Tests: TikZ Diagram Craft

Automated test suite asserting near-miss linting, design review gating, and compilation invariants.

| File | Purpose |
|---|---|
| [test_beauty_lint.py](test_beauty_lint.py) | Verifies near-miss detectors (B1-B10: moat, crowding, text gap, weights, hues, hyphenation, provenance). |
| [test_review_status.py](test_review_status.py) | Asserts that automated check clearance cannot grant design approval without manual review. |
