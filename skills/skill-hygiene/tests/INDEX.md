# Tests

Smoke tests for the skill-hygiene scripts. stdlib-only `unittest`, no external dependencies.

| Test file | Covers |
|---|---|
| `test_audit_skill_bundle.py` | The per-bundle auditor's CLI surface. Builds synthetic skill bundles in a tempdir and asserts on the JSON the auditor emits. Catches regressions in orphan detection, broken-link parsing, typo suggestions, ghost-entry detection, missing-INDEX warn-vs-fail, asset exemption, and the exit code contract. |

Run all:

```bash
python3 skills/skill-hygiene/tests/test_audit_skill_bundle.py
```

Or via unittest discovery from the repo root:

```bash
python3 -m unittest discover -s skills/skill-hygiene/tests -p 'test_*.py'
```

CI runs these on every PR as part of the `skill-hygiene` workflow job.
