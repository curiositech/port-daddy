# CI follow-up for PR #10310

Initial published head: `4aa09e6deccbd553817a9a642f28ef3b4296726b`, base `42bbdc2382a8f934b4ceffe1dddfc28acda84234`. This note distinguishes findings introduced by the import from a reproduced base failure and a hosted dependency failure. It does not assert that all PR checks pass.

## Initial introduced findings (before the operator follow-up)

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

## Historical base reproduction (now repaired)

[Library Checks](https://github.com/curiositech/port-daddy/actions/runs/35915070709/job/107364371709) fails on ten uncited bibliography entries in the existing paper8 manuscript. The manuscript, checker, workflow, and all three input corpora are byte-identical to the base commit. Executing the exact base checker in memory against these unchanged clean inputs reproduces exit 1, ten orphan entries, zero dangling citations, zero duplicate entries, and two non-blocking advisories. [Blob identities and reproduction output](ci-base-reproduction.json) provide the evidence.

At that checkpoint no manuscript or citation gate had changed. The operator then explicitly requested repair; the final disposition is below. The citation gate remains unchanged.

## Historical hosted dependency failure

[Release Candidate E2E hostile job](https://github.com/curiositech/port-daddy/actions/runs/35915070678/job/107365361800) failed during dependency installation. The ONNX Runtime installer could not download its GPU package from NuGet: IPv4 timed out and IPv6 was unreachable. The product-journey test steps were skipped. This is an observed download failure, not evidence of either passing or failing product assertions. No local Port Daddy runtime was started to investigate it.


## Operator-requested repair

The inherited bibliography failure is repaired in the manuscript itself. The
[primary-record audit and rendered proof](paper8-citation-repair/README.md)
record each disposition. Nine verified bibliography entries now support actual
claims; the unused, unlocated proposal entry is removed. Solver qualifications
are propagated to the affected discussion and analytical figure. The corrected
PDF and website metadata are rebuilt together.

The corpus manifest now declares the existing sheaf repair fixture, and the
hosted proof loop executes it. The library index includes Paper 8's standard
lemma/definition, and the research program and website mirror include all eight
papers. The fixture's ten numerical assertions passed locally with the recorded
Python/numeric environment; this is bounded fixture evidence, not a certificate
for all manuscript claims.

The broader import repairs and authority decisions are documented in
[repair-contracts.md](repair-contracts.md). They preserve all requested source
entries, replace the duplicate coordination manual with a semantic merge,
repair portable paths/frontmatter, and preserve accurate source attribution
under a narrow hash-pinned contract. The independent attribution review caught
nested harness-config eligibility, external symlink traversal, unnecessary
whole-repository memory retention, and Windows path separators; all were
corrected before publication.

All three original CodeQL review threads are resolved and outdated. At the
previous published head, the subsequent RC E2E run also passed, superseding the
initial dependency-download failure. Neither statement substitutes for checking
the new head after this repair is published.

The [final local repair validation](repair-validation.json) records all six
previously failing unit suites passing together (75 tests), all 755 source
entries covered, and all 776 canonical bundles passing hygiene. All blocking
Library Checks pass with the pinned reader stack. The two explicitly advisory
Book checks retain their findings; their status has not been concealed or
converted to a claim that the full Book is certified.


## Generated PDF follow-up

The source repair at `0f60fd36c7809aa95d646152d856d33b95df7e09` passed
[CI](https://github.com/curiositech/port-daddy/actions/runs/35928002372),
[Library Checks](https://github.com/curiositech/port-daddy/actions/runs/35928002476),
[Proofs](https://github.com/curiositech/port-daddy/actions/runs/35928002391), and
[Release Candidate E2E](https://github.com/curiositech/port-daddy/actions/runs/35928002409).
These are source-parent receipts, not checks on every successor.

The Harbor build then published `b1e838012ee9257557e47dd06c8689d25b4ec772`,
changing only 29 PDF files. The TeX and figure inputs were unchanged, but PDF
creation/modification dates advanced. The Harbor workflow lacked the source-date
discipline already used by the main whitepaper builder. Its generated push left CI absent from the ordinary check summary. The Actions
API revealed CI, Library Checks, Proofs, Harbor Build, and RC E2E runs with
`action_required` on that exact head. Current [GitHub built-in-token event rules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
explain that these PR updates create approval-required runs. That live evidence
supersedes the initial assumption that no workflows had been created.

The follow-up repairs the build recipe itself: source-bound author timestamps,
a clean repeated-build hash check, compilation failure propagation, exact event
checkout, and a guard against replaying artifacts over changed inputs. Final
hosted artifact bytes, metadata, and checks are read back after publication;
local and hosted TeX stacks need not produce identical bytes.

The [build repair receipt](harbor-build-repair/README.md) includes the four new
regression cases, 460 passing research-library tests, and the actual execution
report page inspected after repairing the shared pgfplots style. Local full-corpus
compilation is limited by the BasicTeX installation's missing `titlesec.sty`; the
pinned hosted toolchain supplies the full-corpus verification.
