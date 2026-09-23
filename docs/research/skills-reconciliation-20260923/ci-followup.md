# CI follow-up for PR #10310

Initial published head: `4aa09e6deccbd553817a9a642f28ef3b4296726b`, base `42bbdc2382a8f934b4ceffe1dddfc28acda84234`. This note distinguishes findings introduced by the import from a reproduced base failure and a hosted dependency failure. It does not assert that all PR checks pass.

## Introduced findings

- The skill mirror check found a stale canonical path in port-daddy metadata and nine missing files across the three tracked Swiss-design skill mirrors. Repairs preserve canonical contents and do not alter installed links in the primary checkout.
- The documentation checker found 52 unresolved citations in new files: 51 imported-skill diagnostics and one new research-report diagnostic. Repairs correct real links or explicitly distinguish hypothetical, external, or absent example paths from local repository files. The checker remains unchanged.
- Three [CodeQL review comments](https://github.com/curiositech/port-daddy/pull/10310#pullrequestreview-5296340532) concern the same unused variable in the pixel-art batch-scaling helper. Removing its three assignments and the resulting empty branch preserves the actual scaling, save, warning, and output logic. Python AST parsing and whitespace validation pass. No review-thread mutation is represented as completed.

## Local repair validation

- `python3 -m unittest discover -s skills/skill-hygiene/tests -p 'test_*.py' -v`: 11/11 pass.
- `node scripts/sync-skill-mirrors.mjs --check`: 16 targets across five mirrored skills, zero drift. Parent independently compared all nine added mirror files with their canonical bytes.
- `node scripts/check-doc-citations.mjs`: 3,307 changed Markdown files clean. Explicit checks also cover the newly added CI report.
- `python3 skills/skill-hygiene/scripts/audit_skill_library.py --root skills --no-persist --deterministic`: 777/777 bundles pass; 218 bundles carry non-failing warnings. This extends the earlier 755 requested-entry audit to the entire canonical library.
- Python AST parsing of the changed batch-scaling helper passes; its removed variable had no reads. No image processing was needed for this dead-store-only edit.
- `git diff --check` passes for this follow-up. The first import's separately disclosed formatting findings remain part of its source-retention receipt.
- The PR body requirements check passes, and all 102 generation-record hashes were verified. The single DSPy parser annotation has both its prior and current canonical hashes retained in the provenance receipt.

The checks do not run Port Daddy, execute all imported helpers, certify inherited scientific/legal claims, or resolve GitHub review threads. CI and review state for the published successor are read back after the push; local passing results do not imply a green hosted run.

## Reproduced base failure

[Library Checks](https://github.com/curiositech/port-daddy/actions/runs/35915070709/job/107364371709) fails on ten uncited bibliography entries in the existing paper8 manuscript. The manuscript, checker, workflow, and all three input corpora are byte-identical to the base commit. Executing the exact base checker in memory against these unchanged clean inputs reproduces exit 1, ten orphan entries, zero dangling citations, zero duplicate entries, and two non-blocking advisories. [Blob identities and reproduction output](ci-base-reproduction.json) provide the evidence.

No paper8 bibliography entry was deleted and no unsupported citation was inserted to make this unrelated check pass. No manuscript or citation gate was changed.

## Hosted dependency failure

[Release Candidate E2E hostile job](https://github.com/curiositech/port-daddy/actions/runs/35915070678/job/107365361800) failed during dependency installation. The ONNX Runtime installer could not download its GPU package from NuGet: IPv4 timed out and IPv6 was unreachable. The product-journey test steps were skipped. This is an observed download failure, not evidence of either passing or failing product assertions. No local Port Daddy runtime was started to investigate it.
