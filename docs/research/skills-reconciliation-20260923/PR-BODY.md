<!-- Publication template: replace __SOURCE_HEAD__ with the committed source SHA in the external --body-file copy. -->

## Summary

The installed `.agy/skills` view contains linked bundles missing from or differing from the canonical library. This change represents all 755 requested source entries under `skills/`, with 754 canonical destinations after merging the duplicate Port Daddy manual. The initial import added 448 bundles and checked, retained, or reconciled 307 existing bundles; the follow-up preserves supporting files through explicit portable path mappings. It preserves supporting knowledge and records merge decisions without changing installed links.

Targeted primary-source research strengthens 15 agent-related skills, with four further merge corrections. The review artifacts include a complete catalog, substrate-study explanation, manuscript gap research, and three editable/rendered diagrams. Independent review resolved six findings, including unsupported FormalJudge attribution and mathematical/runtime overclaims.

The research now incorporates the existing WinDAGs 50-prompt paired graft study. All published pairs and both judges' tallies reconcile: overall outcomes favor the composite graft, while hallucination avoidance favors vanilla. The follow-up agenda is replication, component attribution, resource-matched comparison, and held-out executed tasks. This is positive existing evidence; it is not assigned indiscriminately to individual skill versions.

Start with `docs/research/skills-reconciliation-20260923/README.md` for inventories, sources, semantic dispositions, independent review, and the raw-data audit. No Book chapter, study result, installed link, or local runtime was changed.

## Test Plan

- Final follow-up: 755 source entries covered through explicit path mappings; all 776 canonical bundles pass hygiene (218 retain non-failing warnings); all blocking Library Checks pass locally with pinned PDF readers. The 49 filename repairs preserve source hashes. Paper 8 compiles in two passes to 24 pages, with no unresolved citations/references; changed pages were visually inspected.

- `verify-reconciliation.py` over all 755 source entries: canonical entrypoints present, no missing meaningful source paths or root symlinks. Exact command is in `validation-final.json`.
- `audit_skill_bundle.py`: 755/755 bundled navigation/hygiene checks passed; focused checks passed again for all three references amended with WinDAGs evidence.
- `node skills/provable-action-adjudicator/scripts/test-bundle.mjs`: 13 passing cases. `node skills/ai-engineer/scripts/ai_system_audit.mjs --input skills/ai-engineer/examples/sample-input.json`: sample contract audit passed.
- `validate_mermaid.py` over the research gallery: three diagrams, zero errors/warnings; actual desktop/mobile rendering inspected.
- Recomputed all 50 exported WinDAGs pairs, both overall and criterion tallies, sample integrity, usage, and judge agreement. No model calls or paid benchmark reruns.
- `python3 -m harness.pilot_summary`: stored substrate data reproduce 80/84 cells without count inconsistencies; experiments were not rerun and the defective merge-queue baseline prevents a rail-versus-queue conclusion.
- Scope checks and normal commit hooks pass. Gitleaks candidates were reviewed with redacted evidence. The cached whitespace check remains nonzero for preserved source formatting: all 17,143 retained trailing-whitespace lines match a source/base line, plus five final blank-line diagnostics. This exception is documented, not relabeled as a passing check.

The follow-up repairs the inherited Paper 8 bibliography failure: nine verified references now support specific claims, one unused/unlocated proposal entry is removed, and solver qualifications propagate through the affected prose and figure. The rebuilt PDF, website metadata, library index, research program, and proof manifest are reconciled. Import repairs cover portable filenames, frontmatter, canonical Port Daddy guidance, prohibited prose, and the refreshed convention seal. The all-source request supersedes an old platform-exclusion choice; exact hash-pinned source attribution preserves upstream provenance while native harness-authority checks remain enforced. See `docs/research/skills-reconciliation-20260923/repair-contracts.md` and `ci-followup.md`. All three original CodeQL threads are resolved; hosted checks for the final published head are read back separately.

Coverage and navigation do not certify every inherited claim or execute every imported script. Manuscript anchors refer to the hash-pinned active reading snapshot, which differs from the Book at this branch's base. Generation drafts are explicitly provenance-only.

## Visual Proof

Paper 8 was rebuilt in two passes and its affected pages visually inspected.

![Corrected Paper 8 bibliography](https://raw.githubusercontent.com/curiositech/port-daddy/__SOURCE_HEAD__/docs/research/skills-reconciliation-20260923/paper8-citation-repair/page-24.png)


Research diagrams are rendered from paired DOT sources; editable Mermaid sources validate. The gallery was inspected at desktop and narrow-screen sizes.

![Evidence classes](https://raw.githubusercontent.com/curiositech/port-daddy/__SOURCE_HEAD__/docs/research/skills-reconciliation-20260923/diagrams/research-evidence-classes.png)

[Desktop capture](https://raw.githubusercontent.com/curiositech/port-daddy/__SOURCE_HEAD__/docs/research/skills-reconciliation-20260923/diagrams/review-gallery-desktop.png) · [Mobile capture](https://raw.githubusercontent.com/curiositech/port-daddy/__SOURCE_HEAD__/docs/research/skills-reconciliation-20260923/diagrams/review-gallery-mobile.png)

The three imported generic LaTeX templates were compiled and all 12 rendered pages inspected at 150 dpi. Article citations/bibliography remain incomplete because the template requires an author-supplied `refs.bib` and Biber is unavailable; this is disclosed in the render review. Beamer's outline resolves on pass two; its title has no visible clipping despite an overfull-box warning. The template sources are unchanged.

![Article template, bibliography incomplete](https://raw.githubusercontent.com/curiositech/port-daddy/__SOURCE_HEAD__/docs/research/skills-reconciliation-20260923/template-renders/article-page-1.png)

![Beamer outline after second pass](https://raw.githubusercontent.com/curiositech/port-daddy/__SOURCE_HEAD__/docs/research/skills-reconciliation-20260923/template-renders/beamer-page-02.png)

![Standalone TikZ template](https://raw.githubusercontent.com/curiositech/port-daddy/__SOURCE_HEAD__/docs/research/skills-reconciliation-20260923/template-renders/tikz-page-1.png)

[All pages and compilation limits](https://github.com/curiositech/port-daddy/tree/__SOURCE_HEAD__/docs/research/skills-reconciliation-20260923/template-renders)

## Delivery owner & receipts

Responsible task: `codex:skillapalooza`. The repository-scoped Register claim is held with **proposed** provenance because no roadmap mirror is present. That is coordination evidence, not scheduled roadmap authority.

The operator explicitly authorized the existing `erichowens` login for this branch push and PR creation because the protected source publisher cannot carry the aggregate import. This is personal-account publication, not an App/Fleetbot receipt. No merge or runtime activation is authorized by that exception. Source author/committer attribution is retained in Git; exact GitHub head/base/author readback is saved separately after publication.

Roadmap-Item: none — operator-requested skill-library reconciliation and evidence review; no new product/runtime feature.
