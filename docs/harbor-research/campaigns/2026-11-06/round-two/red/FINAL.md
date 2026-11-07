# RED independent admission audit

Date: 6 November 2026. Status: **bounded implementation probes pass; source-contract audit passes within the explicit scope below**. Root adjudicates the research claim. These results do not establish mathematical truth, complete mediation of arbitrary SQL, external-effect atomicity, deployed behavior, hostile-host confinement or team privacy.

## Verified work boundary and method

All work used `/Users/erichowens/coding/tmp/research-admission-binding-20261106`, branch `codex/research-admission-binding-20261106`, linked metadata `/Users/erichowens/coding/port-daddy/.git/worktrees/research-admission-binding-20261106`. No primary-checkout write, commit, push, Port Daddy CLI/MCP/runtime/hook/app, provider invocation or agent process was used. The RED tests run only synthetic SQLite fixtures and injected synchronous functions. Test scratch lives in the linked worktree's `.cache/test-tmp`.

Applied the redteam-review skill's target/probe/observation/impact procedure and blue-team-research's independent regression/nonvacuity/evidence distinction. No old orchestration scripts ran. Teams shared the host and filesystem; separation was procedural, `privacyEnforced=false`. RED trusted the earlier `INVENTORY.md` discovery, then inspected the current admission and generic-writer boundaries and wrote independent probes. BLUE did not edit RED's tests. ROOT owns the seed and retention repairs and their tests.

## Reproduced findings and responses

| Finding | Concrete observation | Response and independent result |
| --- | --- | --- |
| RED-R2-ID: descriptor did not constrain affected IDs | Original controller admitted `recordSpawnedAgent(first.id, 'expected')` while an injected registered handler wrote `other.id`. Both rows were `proposed`, so the state-only journal check passed. Initial RED result: 36 passed, 1 failed, `Expected function toThrow; received function did not throw`. | BLUE added required `targets(args)`, issuance-time proposed-ID binding and journal `dispatch_id` comparison. The original wrong-row probe now refuses and rolls back. This demonstrated insufficient defense against a faulty trusted handler, not a known production handler targeting the wrong ID. |
| RED-R2-GENERIC: generic retention builders could select protected tables | Source review found exported `ttlPolicy`, `maxAgePolicy`, and `capPolicy` accepted arbitrary table strings. Existing registrations selected other tables, so there was no demonstrated active dispatch-retention caller. | ROOT added strict identifier validation and refusal of `dispatches`, `nightshift_intents`, and `dispatch_admission_*`. RED inspected those guards and independently ran all 36 target/disguise/ordinary-table controls. |
| Inventory RED-10: seed plus legacy import resurrected executable rows | ROOT preserved a two-case failure: copied dispatches were deleted but legacy `nightshift_intents` reimported three executable rows. | ROOT always scrubs both tables in one immediate transaction, including `scrubLocalOnly=false`. RED inspected the bounded table selectors and independently reran all 11 seed tests, including reconstruction and source preservation. |
| Journal/policy reentrancy | A nested controller could prune observations; a handler could install different policy bytes inside the outer transaction. | Current post-effect epoch/policy/model and revision-delta versus observation-count checks reject both independent RED probes and roll back. |
| Trigger initialization and registry integrity | Missing/replaced existing revision triggers and a mutable caller registry would undermine a trusted descriptor boundary. | Current startup validation rejects missing/replaced built-in clock triggers. Copied frozen registry entries prevent callback replacement. RED independently tested both. Privileged schema changes after initialization remain outside the trust claim. |

The source-contract audit deliberately refused the provisional contract after a comment changed the pinned admission function. Before refreshing that one hash, RED reconstructed the old function bytes by reversing the reported comment-only edit and verified the prior SHA-256. No blind hash update was used.

## Independent executed results

`EVIDENCE.json` retains the first freeze: exact argument vectors, worktree, exit codes, output artifact names and source SHA-256 values. Its contract bytes are preserved in `writer-contract.first-freeze.json`. `EVIDENCE.adapter-followup.json` records the current source-audit extension and anchors the first evidence receipt. Outputs from both freezes remain as distinct adjacent `.stdout.txt` and `.stderr.txt` files.

| Check | Observed result |
| --- | --- |
| RED SQLite attack suite | **42/42 passed** |
| Independently rerun ROOT seed suite | **11/11 passed** |
| Independently rerun ROOT generic-retention suite | **36/36 passed** |
| Source-audit controls | **16/16 passed** |
| Full source-contract scan | **PASS: 1,784 non-test TS/JS/SQL files, 89 reviewed sites/boundaries** |

The 42 RED cases include: a nonempty accepted proposal; both unsafe and exhausted/unknown refusal through prepared and ordinary APIs; an accepted terminal metadata write under a nonempty forbidden-state policy; an accepted produced-to-review transition under forbidden `proposed`, paired with refused claimed recovery; forged/copied/serialized/prototype-looking receipts; copied nested input/argument aliases; metadata no-op writes; state ABA; delete and exact reinsertion; two controllers and two file-backed connections; competing receipts; `BEGIN IMMEDIATE` lock refusal and burn; constructor policy preservation; explicit trusted policy replacement invalidation; model/policy byte corruption; revision and epoch exhaustion; copied-database receipt rejection; throw/thenable/illegal-edge/escaped-state rollback; outer transaction rollback; old snapshot rollback API refusal; opaque rollback freshness; nested journal pruning; in-effect policy replacement; wrong-row target refusal; missing target binding; trigger integrity and frozen registry substitution.

One additional *scope negative control* is intentionally successful at violating the installed forbidden-state policy through raw SQL. It then proves the previously issued receipt is stale. That test demonstrates that a privileged database handle is outside admission mediation; it must never be cited as proof of SQL confinement.

Zero explored states on an empty/no-op path are not counted as positive safety evidence. All cited positive safety controls mutate a real row and explore a nonempty reachable state set. No unavailable or skipped test is counted as passing.

## Independent writer-contract gate

The gate imports TypeScript's parser, not the runtime admission model. It visits source literals/templates/concatenations and tokenizes SQLite-shaped SQL, including comments, quoted identifiers, schema qualification, CTE mutation heads, `RETURNING`, dynamic selectors, DML, schema creation/alter/drop/rename, built-in clock-trigger removal and `VACUUM INTO`. It scans Git's tracked **and untracked** non-test TypeScript, JavaScript and SQL paths, including scripts, migration files and checked-in bundles. Sink spelling (`prepare`, bracket access, `get`, `all`, `query`) cannot hide a literal writer from this discovery.

The independent `writer-contract.json` classifies every discovered site with its exact hash, mutation targets, rationale and probe. The 89 entries include the two queue inserts, fourteen queue updates, Harbormaster conflict recovery, admission clock/journal writers, schema/bootstrap migrations, generic seed deletion, known database-copy/restore/consolidation functions, currently bounded nondispatch selectors, two retention call sites, exact nonexecuted diagnostic/fixture-parser literals, six SQL sites in the offline production-adapter smoke, and exact function/module boundaries including that entire smoke module. Whole function pins detect deletion of the mandatory wrapper even when its SQL literal stays unchanged. Generic-selector module pins bind the reviewed constant tables/callers; the source contract is not inferred from the runtime transition graph.

There is no auto-bless/update command and no blanket ignored writer pattern. Synthetic mutation controls reject an unknown writer in a new `routes/future/direct-writer.ts`, an omitted writer, changed SQL with the same abstract state relation, wrong target/operation classification, dynamic targets, replaced schema, admission-wrapper deletion and a new aliased retention-builder call. The new-file control exercises the same discovery function used by the full scan; it does not add executable code to a production directory.

## Runtime-adapter fixture extension

After the first freeze, BLUE added `blue/sqlite-runtime-smoke.mjs` to exercise the actual production SQLite adapter. RED independently read the complete script, verified the six direct UPDATE sites and their synthetic two-connection setup/cleanup, and first reran the unmodified contract. The gate correctly failed with exactly six unclassified-writer errors (88 discovered sites at that point). Those failure outputs are preserved in `writer-coverage-adapter-unreviewed.*`.

RED then classified each SQL site explicitly: same-value metadata invalidation; two halves of state ABA; a deliberately wrong-target handler; the refused competing-connection writer; and the admitted winning writer. A seventh entry pins the entire fixture module so that unchanged SQL literals cannot silently acquire a different setup, database target, or execution context. The final audit passed at **1,784 source files and 89 reviewed sites/boundaries**, and all **16 independent audit controls passed again**. The earlier 82-site contract, report and failure history remain intact as the first freeze.

ROOT separately reported independent execution of the smoke's seven cases under Node and seven under Bun. This RED follow-up establishes source review and audit classification; it does not relabel ROOT's adapter runs as RED executions or add them to the 42 RED SQLite probes.

## Exact remaining assumptions and limits

1. This is a source-contract audit of recognizable TS/JS/SQL syntax, **not a complete static dataflow proof**. SQL built without recognizable mutation syntax, reflective helper aliases, arbitrary/generated SQL and ignored output can escape the syntactic subset. Swift, Rust, Python, shell and inline HTML JavaScript are not parsed. The baseline inventory found no additional native dispatch SQL writer; a new native writer requires separate review.
2. Known whole-database functions are exact-hash pinned. Arbitrary new native/filesystem replacement calls are not discovered by a general filesystem taint analysis. Restore/rescue/consolidation and standalone SQL migrations remain explicitly trusted lifecycle/bootstrap boundaries, not per-row admitted transitions. Fresh controllers reject old receipt objects; in-place privileged rollback of an open database is not proved safe.
3. The database handle, mutation registry, state-root/target descriptors, synchronous handlers and installed schema remain trusted implementation. Journal validation catches the tested incorrect effects; it does not make arbitrary JavaScript callbacks or hostile schema owners safe. A thenable return is refused, but that cannot undo effects outside SQLite or contain a scheduled continuation.
4. The safety abstraction is dispatch state reachability under the installed finite forbidden-state policy. Metadata mutation invalidates receipts conservatively; this does not prove arbitrary metadata-sensitive policies or artifact/lease correctness.
5. GitHub merge, provider launch, worktree cleanup and other external side effects do not join the SQLite transaction. The earlier inventory's await/revocation concerns remain outside this round's proven local database boundary unless a separately named regression addresses them.
6. No OS team privacy, network isolation, independent signer, deployed runtime, hosted CI, merge or release evidence was produced here. Hashes bind these bytes to root's separately retained seal; they are not signatures or proofs of authorship.

Root should retain these qualifications when accepting the finite result. A green source gate says the reviewed syntactic writer inventory did not change; it does not authorize a broader completeness claim.
