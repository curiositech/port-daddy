# PR #9965 opportunity harvest

Evidence snapshot: PR #9965 current head `3a6f022d56e58976e8992f77588b8610a6d0b9b7`, queried 2026-09-01. Source is the live PR description, file list, and GitHub comments/reviews; proposals are not treated as implementation authority. PR #9965 is open and carries an Admiral HOLD for hostile native-authority, crash-recovery, scanner, transaction-boundary, and catalog-content proof.

## Opportunities and dispositions

| Source / proposal | Evidence path | Disposition | Dependency / conflict | Affected files or slice | Risk / cost | PR-sized next slice |
|---|---|---|---|---|---|---|
| pd-qa HIGH | `fleet/ships/jury-rig-custodian.md` lacks manifest/registry entry | Active gap | Fleet registration contract; no competing owner found | `fleet/ships/*`, `pd-fleet.yml`, manifest/parity tests | Medium; fleet availability | Register custodian ship, add manifest parity test, prove `pd fleet` discovery. |
| pd-qa HIGH | MCP rename `skill_graft_status` → `jury_rig_status` | Wrong under current operator supplant directive | Backward compatibility conflicts with exhaustive replacement; manager explicitly called removal intentional | `mcp/server.ts`, parity/docs | High API churn; do not restore alias | Document breaking replacement and update all first-party callers; defer third-party migration tooling. |
| pd-spark 1 / pd-spider 1 | WinDAGs-to-Jury-rig migration CLI | Active gap, but not this PR | Requires cross-repo lexical migration safety and explicit source-root preservation | New `pd migrate-windags` command + tests/docs | High; can rewrite user files | Separate design/implementation PR with dry-run, patch output, backups, and no silent writes. |
| pd-spark 2 | Jury-rig reconciliation dashboard | Active product idea | `/jury-rig/status` and `/reconcile` must be proven current; operator UI ownership unresolved | FleetBar/dashboard surface | High UI scope | Hypertree branch: status contract first, then dashboard prototype with visual artifact. |
| pd-spark 3 | Semantic filters for `pd jury-rig query` | Active gap | Must preserve BM25+Tool2Vec fusion and canonical embedding policy | CLI parser/query backend/tests | Medium | Add typed `--filter key=value` contract, benchmark, and CLI tests. |
| pd-spider 2 | Local catalog prioritization | Already satisfied in #9965 | `PORT_DADDY_SKILL_SOURCE_ROOTS` and project-local paths are in changed skill/docs | `lib/skill-sync.ts`, skill references | None | Close as satisfied; verify installed artifact only. |
| pd-spider 3 | Guarded skill reference system | Already satisfied in #9965 proposal/source | Native reference path exists; hostile proof remains part of Admiral HOLD | `cli/commands/skill-graft.ts`, `lib/jury-rig-bootstrap.ts` | Security-critical; proof cost high | Separate hostile containment test slice; no new implementation inferred. |
| pd-spider / snipe | Jury-rig custodian / bootstrap skills | Partly satisfied, partly gap | Custodian file registration is a QA finding; bootstrap lifecycle is in #9965 but held | `fleet/ships/jury-rig-custodian.md`, bootstrap docs/tests | Medium | Register custodian and add durable ledger/receipt contract tests. |
| pd-snipe | Skill catalog search/reference-loading skill | Active gap | Requires canonical Jury-rig query and guarded reads | New skill + references | Low/medium | Add a docs-only skill with decision tree and read-only examples; no runtime mutation. |
| pd-purser | Backward-compatible manifests, migration, benchmarks | Conflict / superseded | Purser steelman assumes compatibility, but operator doctrine and manager response require exhaustive supplant | PR #9965 contract | High if interpreted literally | Record explicit contract reconciliation in PR review; do not add compatibility shims. |
| Admiral HOLD | PATH-controlled `which`/`gh`, hook text proof | Active security gap | Must precede native authority and machine mutation | `lib/jury-rig-bootstrap.ts`, hostile tests | Critical | Verify packaged/root-owned executable and signed hook/artifact digests in a dedicated security PR. |
| Admiral HOLD | Hard-crash recovery and stale lock | Active security gap | Requires child-process kill fixture and write-ahead phases | bootstrap + tests | Critical | Implement crash fixture, owner liveness, recovery readback. |
| Admiral HOLD | Rollback compare-and-swap | Active security gap | Concurrent target drift must refuse compensation | bootstrap + tests | Critical | Add identity/content CAS rollback tests and refusal receipt. |
| Admiral HOLD | Scanner path trust / unbounded catalog | Active security gap | Packaged scanner, bounded counts, active-content quarantine | bootstrap + tests | Critical | Bind verified scanner and enforce size/file/import limits plus sanitization. |
| pd-code-reviewer LOW | Dead `redo` and unused `readOnly` in tests | Active low-risk cleanup | Exact files in #9965; no product behavior | `tests/unit/jury-rig-bootstrap.test.js` | Low | Remove dead assignment/import in a small test-cleanup PR after manager approval. |

## Current publication evidence

| Artifact | Evidence | Meaning |
|---|---|---|
| #9965 | Open, head `3a6f022…`; CI/test claims in PR body; Admiral HOLD comment | Source/review state only; native cutover not authorized. |
| #9989 | Referenced as concurrent publication in operator ledger | Must inspect live head/scope before linking any opportunity. |
| #9990 | Operator charge ledger PR | Not implementation evidence for #9965. |
| #9991 | Harbor Agent Runtime proposal publication | Proposal evidence only; not shipped runtime proof. |
| #9992 | Referenced concurrent PR | Must inspect live head/scope before claiming dependency. |

## Hypertree partition for later owners

1. **Security gate (hard prerequisite):** packaged executable/artifact identity, crash recovery, CAS rollback, verified scanner, bounded/sanitized catalog. One owner; held until all hostile tests pass.
2. **Fleet registration:** custodian manifest/registry and parity tests. Independent low-risk branch; can proceed without changing bootstrap security.
3. **Cross-harness truth:** Codex/Claude/agy/other instruction and attribution parity, plus persistent role ledgers. Depends on agreed actor identity contract.
4. **Developer tooling:** migration CLI, semantic filters, catalog-search skill. Depends on stable Jury-rig API and migration policy.
5. **Operator experience:** reconciliation dashboard and transcript/status panes. Depends on status contract and visual QA.

Wave 2 must wait for Wave 1 security/registration contracts where a hard edge exists. This harvest deliberately does not mix implementation across those branches.

## Unknowns and boundaries

- No canonical Chartroom roadmap item was minted: the installed roadmap JSON read-back was malformed/truncated in the prior ledger slice, and this audit does not edit the retired snapshot.
- Spark/Spider/Snipe comments are advisory generated proposals; evidence paths were checked against the live PR metadata but implementation status requires source/CI read-back.
- No claim is made that #9965’s tests, installed artifact, or native cutover are safe merely because conventional CI is green.
- No product code was changed by this harvest.
