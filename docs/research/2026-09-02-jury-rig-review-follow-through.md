# Jury-rig review follow-through — 2026-09-02

This is a dated evidence census and bounded implementation report, **not roadmap
authority**. It preserves the useful proposals from [PR #9965](https://github.com/curiositech/port-daddy/pull/9965)
without turning historical review suggestions into new execution permission.

The PR merged on 2026-09-01 at `deadc124e4f1a59f51fad498af4124ac54616fd5`
from head `4deaa7b1eb6ffd04344a7f08a239041942d8a71c`. The 19 issue comments
were reread on 2026-09-02; there were zero inline review comments and zero formal
reviews in the original census. Historical verdicts below belong to their cited
heads, not to every subsequent build. Current source was checked at
`3edf96d5a813312f81b36aa9e901f8b7d8960cd2`.

The manager's local source note is 23543, created at `1788378423824`, with content
SHA-256 `63ce5083a8c21dc93095943d32c8fcb26b3f2e5abbe6125d533d8e1c2345bd5a`.
This document is a sanitized projection, not a raw note export. The existing
item `codex-jury-rig-skill-runtime` (ID
`a8b4d281-7efe-43d4-8fa0-80caac5914a4`, harbor `port-daddy`) is the local
coordination link. Neither a local link nor the committed CI snapshot proves a
Relay D1 receipt. This slice does not replace its status, owner, or other links.

## All 19 comments, with dispositions

| Source comment | Finding or proposal | Disposition |
| --- | --- | --- |
| [Roadmap gate](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5467654088) | Item linkage and missing downstream declaration | Historical CI signal; keep current typed linkage and truthful spawn trailer, not a new authority store. |
| [Fleet request](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5467654130) | Review-request signal | Request evidence only, not substantive approval. |
| [Preview](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5467658919) | Pages deployment | Historical preview evidence, not machine bootstrap proof. |
| [QA](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5467664417) | Custodian registration; restore removed API | Registration follow-through belongs to the Unify/custodian owner. Compatibility restoration is rejected by the operator's replacement direction. |
| [Spark](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5467693596) | Migration automation, health dashboard, metadata filters | Bootstrap skill in this slice; Retrieval Architect owns status/filter work, manager owns UI staffing. No bulk replacement CLI. |
| [Spider](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5467726814) | Native names, roots, guarded references, API/docs | Existing source already has the replacement surfaces. Root precedence is clarified here; do not resurrect aliases or duplicate APIs. |
| [Lookout](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5467771760) | Root guidance, old help, containment audit, test name | Explicit-root example and discovered `.test.js` rename here. Historical help nits are absent; PR Admiral owns containment/undo cross-check. |
| [Skill truth](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5478532279) | Stale dispatch compatibility guidance | Historical replacement direction, not an invitation to expand this slice into unrelated dispatch changes. |
| [Distribution roots](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5478711460) | Docs disagreed with discovery roots | Source-linked README example here; no removed implicit source restoration. |
| [Author update](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5487792299) | Fleet keys, bad roots, parser/test corrections | Historical implementation receipt. Retain current source behavior and focused tests. |
| [Admiral cutover review](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5487917939) | Remaining machine-authority replacement gaps | Followed by later bootstrap implementation and security review; green CI alone was insufficient. |
| [Snipe](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5488307681) | Reusable migration/bootstrap, custodian, query skills | One first-party lifecycle skill here. Custodian/handover skill stays with Unify; query/reference skill with Retrieval Architect. |
| [Code reviewer](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5488317983) | Unused test variable | No current matching defect found; do not recreate old code to fix it. |
| [Replacement response](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5488431819) | Import claim rebuttal, aliases intentionally removed, skill deferred | Preserve exhaustive replacement; deliver the deferred skill now. |
| [Bootstrap implementation](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5488571086) | Plan/status/apply/rollback and machine gates | Existing CLI/library reused here. The source receipt explicitly did not claim a live machine cutover. |
| [Purser](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5488770055) | Alias/Fleet tests; comparison benchmarks; sandbox failure | Tests were initially unexecuted. Later author receipt covers corrected tests; compatibility remains rejected. Same-catalog performance work belongs to Retrieval Architect. |
| [Security HOLD](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5488806248) | Executable trust, crash recovery, rollback drift, scanner, bounds, status | Preserve these acceptance boundaries in the lifecycle skill; later source receipt is distinct from installed validation. |
| [Purser response](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5492233305) | Actual imports and removal tests | Historical 275-test source claim; no compatibility promise and no fresh test result inferred here. |
| [Admiral response](https://github.com/curiositech/port-daddy/pull/9965#issuecomment-5492233479) | Source corrections and crash test | Historical source/build evidence; explicitly no live cutover. Reverify installed proof before any machine change. |

## What this slice delivers

**Jury-rig bootstrap** ([CLI](../../cli/commands/skill-graft.ts),
[implementation](../../lib/jury-rig-bootstrap.ts)) is the existing receipt-backed
machine-authority cutover. The new [lifecycle skill](../../skills/jury-rig-bootstrap-lifecycle/SKILL.md)
selects inspection, scoped apply, exact rollback, or an evidence-preserving handoff.
It does not add a second implementation, new authority, or an old-name command.

The source-root example follows `defaultSkillCatalogRoots()` in
[`lib/skill-sync.ts`](../../lib/skill-sync.ts): existing colon-separated explicit
roots are prepended, defaults remain, and duplicate real paths collapse. Root
order is not a collision-winner guarantee: query discovery currently uses
[`loadSkillCatalog()`](../../lib/shipwright/skill-index.ts), whose later root wins
for duplicate IDs. Runtime-link `collectSkillUnion()` has a separate first-party
preference. The fixture explicitly preserves this distinction rather than
claiming both consumers implement one policy. `--root`/`--dir`
on the query CLI instead select project-local roots; those flags do not mean
“append this directory to every default.”

The CLI suite becomes `tests/unit/jury-rig-cli.test.js`, not `.spec.js`:
[`jest.config.js`](../../jest.config.js) discovers unit files ending in
`.test.js` or `.test.ts`. Historical run logs retain their original filenames.
Source fixtures check handwritten prose, unrelated settings, provenance, exact
rollback, unsupported recovery, and test discovery. No host catalog is imported
or installed by this publication.

## Still owed, with explicit ownership

- **Retrieval Architect:** metadata filtering, truthful status/coverage/lease DTO,
  focused query/reference guidance, and same-catalog performance evidence. No
  automatic remote generation is authorized by these historical proposals.
  Reconcile query-versus-runtime-link duplicate-ID precedence before promising a
  unified ownership/override policy; this slice changes neither implementation.
- **Manager / UI owner:** real operator health and evidence panes based on that
  DTO, with visible scope and user testing; this document is not a UI prototype.
- **Unify / custodian owner:** attributable registration, receipt-backed handover,
  and a repair skill. A markdown ship definition is not a running durable agent.
- **PR Admiral:** compare containment/undo boundaries with #9898 and #9817 before
  assigning another implementation; do not duplicate authority.
- **Bootstrap recovery owner:** `recoverInterruptedJuryRigBootstrap()` remains a
  library-only seam. There is no CLI recovery verb. A missing terminal receipt
  must not trigger blind apply replay, lock deletion, or fixture-key recovery.
- **Bootstrap preview owner:** CLI `plan` does not supply the installed hook and
  therefore reports `NATIVE_HOOK_REQUIRED`; `apply` verifies native proof and
  creates its own plan. There is no CLI binding from a reviewed plan to apply.
  A verified preview plus exact approval binding is still a product gap, not
  something this skill or source test can pretend is installed.
- **Installed-runtime owner:** packaged native bootstrap and fresh per-harness
  startup proof. This skill, its fixtures, and a GitHub merge cannot attest that
  the operator's installed Codex/Claude/Gemini/agy sessions were cut over.

The sparse-worktree prerequisite [PR #10019](https://github.com/curiositech/port-daddy/pull/10019)
merged on 2026-09-02 at `486dda7602a97802dd04cf112f5a7ed89f9a014a`. Its runtime
symlink policy is distinct from checked-in mirror generation. This new canonical
skill declares no generated mirrors; the native catalog reads `skills/` directly.
