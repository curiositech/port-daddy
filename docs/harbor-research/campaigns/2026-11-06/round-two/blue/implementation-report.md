# Blue implementation evidence

Scope: the registered synchronous SQLite mutations of the actual dispatch
queue, legacy-row import, and Harbormaster conflict recovery. This is a source
implementation and offline SQLite result. No Port Daddy runtime, worker,
provider, Git effect, merge, or deployment was started or observed by Blue.

Worktree verified before writes:

- Root: `/Users/erichowens/coding/tmp/research-admission-binding-20261106`
- Branch: `codex/research-admission-binding-20261106`
- Git metadata: `/Users/erichowens/coding/port-daddy/.git/worktrees/research-admission-binding-20261106`
- Base assigned by root: `8ec96b55a`

Applied offline: `skills/blue-team-research/SKILL.md`, both Port Daddy
contributor/agent skills, and ADR-0120. The implementation is TypeScript product
logic using ordinary SQLite transactions; it creates no cryptographic primitive.
Teams share this host identity. No team privacy or hostile-code isolation is
claimed. Reports contain visible commands and results, not private reasoning.

## Implementation boundary

`lib/dispatch/admission.ts` holds the complete operation-labeled state relation.
The public `canTransition` and `nextStates` project this relation, including
recovery, rollback, conflict recovery, and existing worker settlement shortcuts.
The historical conformance test now explicitly removes both recovery edges to
form its negative mutant. The current public model must contain them.

Every exported queue mutator uses the admission controller. Initialization
installs its clock before the nonempty legacy import can run. Harbormaster uses
the same persisted authority and controller for its actual SQL writer. A
restricted executable policy specifies forbidden dispatch states and an
exploration bound. Its full canonical specification and the compiled model
bytes are stored with a monotone authority epoch; neither request-supplied
hashes nor serialized certificates install authority. Omitted constructor
configuration preserves the installed policy. Policy replacement, including an
A-to-B-to-A replacement, invalidates older receipts.

SQLite triggers advance a global revision for every dispatch insertion,
update, or deletion, including equal-value metadata updates. The global clock
is deliberately conservative: an unrelated dispatch change also invalidates a
pending receipt. Startup checks the exact retained clock-trigger definitions
and refuses missing or changed triggers when authority already exists. Clock
and epoch exhaustion fail through SQLite constraints. An administrative schema
reset, arbitrary database owner, or in-process malicious code is outside the
boundary; direct SQL is not mediated by these wrappers, though intact triggers
invalidate outstanding receipts after such writes.

`prepareAdmission(operation, args)` copies exact input, snapshots target IDs,
evaluates the complete finite future model, and returns an opaque immutable
object. Proposal IDs are generated at issuance. Only the issuing controller
can consume that object; copying/serialization does not copy authority.
`commitAdmission(receipt)` requires safe and complete exploration, compares the
global revision plus policy/model/epoch under `BEGIN IMMEDIATE`, invokes only
the registered synchronous effect, and checks the resulting journal before
commit. Every observed row ID must belong to the captured target set, every
state must have been explored, and every non-stuttering transition must belong
to the exact registered operation. The revision delta must equal the observed
mutation count, and policy/model/epoch must remain unchanged. Any failed check
rolls back the row and clock. An attempted receipt is consumed even if its
transaction fails or an outer transaction later rolls back. Completed journal
entries are compacted; the revision is never compacted or reset.

The ordinary APIs prepare and consume inside one transaction. Two actual
asynchronous callers retain the original admission across awaits:

- `prepareForRun(id)` returns `{ dispatch, rollback }`; its rollback receipt is
  issued in the same transaction after preparation. `restorePreparedRun` accepts
  only that original receipt. Public issuance of snapshot-selected rollback is
  denied. The CLI request path consumes it after a failed daemon request.
- Harbormaster admits the exact potential conflict-recovery mutation before its
  first command await. Cancellation, approval ABA, metadata change, row
  replacement, or policy replacement invalidates it. The bound SQL reason is
  known before the await; subsequently observed filenames remain in the conflict
  event and note. This does not make the intervening Git commands atomic.

Failed dispatches cannot resurrect into settled, and rejected dispatches cannot
escalate into settled. Existing worker settlement shortcuts remain explicit in
the model. Generic state reachability does not authorize a specific operation.

## Executed evidence

Focused command, with a read-only compatible native SQLite dependency selected
by the worktree-local Jest configuration:

```sh
TMPDIR="$PWD/.cache/test-tmp" /Users/erichowens/.nvm/versions/node/v22.17.1/bin/node \
  --experimental-vm-modules node_modules/jest/bin/jest.js \
  --config .cache/jest-admission.config.mjs --runInBand --runTestsByPath \
  tests/unit/dispatch-atomic-admission.test.js \
  tests/unit/dispatch-queue.test.js \
  tests/unit/dispatch-state-machine.test.js \
  tests/unit/harbormaster.test.js \
  tests/unit/future-admission-conformance.test.js \
  tests/unit/dispatch-cli-daemon-run.test.js
```

Result: **173 tests passed in six suites**, zero snapshots. The complete visible
output is `focused-tests.log`. Thirty-five new Blue cases exercise the real
queue, controller, SQLite, and injected Harbormaster. They include a nonempty
policy that accepts the real `produced -> review_pending` mutation while
rejecting recovery-capable `claimed` and `in_progress` futures. Positive results
therefore require a nonempty exploration and an observed persisted change.

Other controls cover forged/serialized receipts, nested input aliases,
metadata stutters, state ABA, delete/recreate, policy ABA, model replacement,
unknown exploration, rollback and clock preservation, target/state/operation
escape, same-connection policy replacement, failed/rejected escalation, the
ordinary writer paths, a real two-connection same-timestamp rollback ABA, and
Harbormaster approval ABA across an injected command await. Existing suites
exercise nonempty legacy import, queue preparation and review/settlement paths,
recovery guards, and the inert mocked CLI callback. Red independently preserved
a failing wrong-row-handler probe; Blue repaired target binding before handing
the probe back for retest. Root, not Blue, adjudicates that finding.

Default TypeScript validation stopped on missing implicit `commander` types.
Running `tsc --noEmit --pretty false --types node` reached source checking and
reported only four unavailable-dependency errors in unrelated files:
`onnxruntime-node` in the two entrypoints and semantic resolver, and `commander`
in `cli/commands/demo.ts`. No owned implementation file had a diagnostic. These
are dependency-limited checks, not a clean repository typecheck. Outputs are
preserved beside this report. Shared `node_modules` was never modified.

The bounded follow-up resolved those dependency gaps without source edits.
Exact locked packages `commander@14.0.3`, `onnxruntime-node@1.24.3`, and
`@types/commander@2.12.0` were installed under `.cache/typecheck-deps` with
installation scripts disabled. Only worktree-owned per-package symlinks were
added. The worktree's `@types` namespace link became a local directory of
per-entry links, preserving every other type package while selecting the locked
Commander stub, which explicitly declares `typings: null`. The shared checkout
and shared dependency targets were not written. The unchanged full command
`node node_modules/typescript/bin/tsc --noEmit --pretty false` then **passed with
exit 0 and empty stdout/stderr**. The earlier failures remain archived as
historical evidence; `runtime-typecheck-receipt.json` and
`typecheck-overlay-receipt.json` record the successful follow-up.

The runnable `sqlite-runtime-smoke.mjs` independently imports the production
`lib/sqlite-runtime.ts` adapter and the actual queue/admission modules. The same
seven cases passed under both **Node 22.17.1 / native SQLite 3.53.2** and
**Bun 1.2.21 / CompatDatabase SQLite 3.51.0**, with identical implementation
source digests. Each run uses two connections to one worktree-local SQLite
file. Cases prove restrictive-policy progress visible from the peer connection,
equal-value metadata invalidation, state ABA invalidation, wrong-target rollback
with unchanged clock, single-use idempotent no-op receipts, a competing writer
blocked while the admitted effect holds its immediate transaction, and policy
ABA invalidation. Both stderr files are empty. The Bun output's
`process.versions.node` value is compatibility metadata, not a separate Node
runtime tested here. Complete stdout and exact commands are preserved beside the
smoke and in `runtime-typecheck-receipt.json`.

## Limits and handoff

The checker proves only the finite forbidden-state policy over the declared
state abstraction. It is not the general R17 policy engine, a semantic account
of worker leases or retry budgets, a spend constraint, or a proof of external
effects. Overapproximation can refuse safe concrete operations, including
failure/cancellation from a state with a forbidden reachable future. Empty
target/no-op checks do not count as positive safety evidence. The runtime
checks establish observed operation/ID/state coverage, not exact values for
every metadata column; the concrete registered handler still implements those
arguments. The API registry, generated-ID binding, state labeling, SQLite
semantics, and trusted constructor installation are assumptions named by the
conditional proof.

Whole-database copy/restore, schema manipulation, migration tooling, and the
operator's administrative authority require the separate inventory and root
review. Root owns seed deletion, Omni/report updates, publication, CI, and
landing. Blue performed no staging, commit, push, merge, or deployment. Source
hashes and independent final evidence are recorded by White/Red/root after
their final review; this report is not a signature or independent seal.
