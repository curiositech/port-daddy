# Dispatch recovery defeats table-only future admission

Research date: 6 November 2026. Work record: NEXT-P6. Executable case: [future-admission-conformance.test.js](../../../tests/unit/future-admission-conformance.test.js).

## Result and scope

The real dispatch queue contains a recovery edge absent from its central transition table. For a row already in `claimed` or `in_progress`, `recoverStranded()` can write `proposed`. A finite model built only from `nextStates()` cannot reach `proposed` from either starting state. Adding the two recovery edges makes that future reachable.

A constructed positive policy exposes the consequence: the table-only provider returns `safe`, while the provider with the recovery edges returns `unsafe` with a one-transition witness. The test replays that witness through the actual queue methods against in-memory SQLite and reads the resulting row back. This is an executable counterexample to using the central table alone as an implementation-complete future model. It is not a claim that production dispatches currently carry conflicting obligations, and it is not full runtime conformance.

The [central table](../../../lib/dispatch/state-machine.ts) describes its legal transitions for direct writers. The [queue implementation](../../../lib/dispatch/queue.ts) separately enforces preconditions in SQL; its recovery writer resets eligible `claimed` and `in_progress` rows to `proposed` without consulting that table. This experiment records the discrepancy without changing either production component.

## Reproducible contract

Each test has a fresh `:memory:` SQLite database, a deterministic dispatch ID, and an injected clock starting at `1700000000000`. Setup materializes a row, claims it, and, for the second case, starts it. Only then does the test capture the current row and construct the model's initial set. The initial set is exactly `{claimed}` or `{in_progress}`. The earlier proposal is setup history, not an initial model state; starting at `proposed` would make the comparison vacuous.

The abstraction retains the row's dispatch state. Its current label is `{dispatch_is_proposed}` precisely at `proposed`, and empty elsewhere. Two fixed deontic rules use that positive fact to activate `O(execute_dispatch)` and `F(execute_dispatch)` over the same synthetic scope and closed interval `[0,1]`. There are no baseline facts, Horn rules, resource claims, or temporal constraints. These labels and rules are test declarations, not discovered production policy.

The table model obtains edges by calling the actual `nextStates()` implementation over ten explicitly declared dispatch states. The second model adds `claimed -> proposed` and `in_progress -> proposed`, each named for `queue.recoverStranded`. The unchanged [finite provider](../../../skills/harbor-results/scripts/future_fact_reachability.py) runs with at most ten states and one hundred examined transitions. Its subprocess has a five-second wall-clock limit and a one-megabyte output limit; the reviewed input is fixed and small.

For the witness replay, the injected clock advances by 60,001 ms. Recovery uses a 60,000 ms grace window and permits one requeue; the fresh row has no prior recovery marker. The test requires a one-edge witness with the matching operation name, invokes that queue method, reads the final row, compares the observed state sequence and label with the witness, and verifies that the worker/session/start fields were cleared. No worker death is inferred from elapsed time: the test deliberately supplies an eligible row to an isolated recovery function.

## Controls

| Case | Expected finite-provider result | Required observed queue result |
| --- | --- | --- |
| Central table, current `claimed` | Safe after complete exploration | Recovery writes `proposed`, which fails table conformance |
| Central table, current `in_progress` | Safe after complete exploration | Recovery writes `proposed`, which fails table conformance |
| Table plus both recovery writers, either current state | Unsafe with the direct recovery witness | The actual recovery step matches the witness |
| Both recovery edges removed from the second model | Safe after complete exploration | The same actual step fails conformance against the deletion mutant |
| Row still inside grace window, either current state | No provider invocation needed | Recovery changes nothing; abstract stutter is accepted |
| Zero remaining requeues, either current state | No provider invocation needed | Recovery writes `salvage`, an edge present in the table |
| Attempt to claim an `in_progress` row | No provider invocation needed | Claim throws and the persisted row remains unchanged |

The suite has nine test cases: two admission/witness comparisons, two deletion mutants, two grace-window controls, two salvage controls, and one rejected-operation control. The mutant removes both recovery edges because deleting only `claimed -> proposed` leaves the indirect table edge to `in_progress` followed by its recovery edge.

The observed-step assertion checks the same dispatch identity, declared states, current fact labels, and an edge or explicit abstract stutter. This is a bounded trace check. It does not establish that unobserved steps, other writers, or all concrete rows simulate the model.

## Uncovered boundaries

The second graph is only a model with the tested recovery writers added. It remains unsuitable as a complete admission authority. In particular:

- `queue.prepareForRun()` has a separate back-edge for an unleased auto-claim; `restorePreparedRun()` has compare-and-set rollback behavior. Neither is exercised here.
- Other queue methods, settlement shortcuts, nonempty legacy migrations, projection insertion, administrative repair, and direct database writes need a complete writer inventory and separate conformance cases. The successful setup calls do not cover their other inputs.
- [Harbormaster](../../../lib/harbormaster.ts) has `backDispatchToProduced()`, called on a merge-conflict path after selecting an accepted dispatch. That direct SQL writer is excluded from both the experiment and the added-edge model. The test neither imports Harbormaster nor runs Git, merge, review, or conflict-repair effects.
- Lease ownership, retry counters and marker history, timestamps, worker liveness, multiple rows, concurrent connections, transactions racing with recovery, restarts, persistence across processes, and worker eligibility are not represented by the state-only graph. Adding recovery edges without retry counters also admits abstract cycles that need not be concretely repeatable. The one-step witnesses are the concrete evidence.
- There is no atomic binding of an admission to a policy version, model digest, current row revision, or effect. No effect boundary consumes the result. Detection here does not prevent dispatch or authorize execution.

A broader conformance argument would need every in-scope implementation step to map to a model edge or label-preserving stutter, complete initial-state coverage, and a justified fact-label abstraction. A production admission gate would additionally need fresh atomic binding and complete mediation of all effects. These remain open obligations; the provider's complete graph traversal proves none of them.

## Execution boundary

Local validation on 6 November 2026 passed all nine cases in one suite (zero snapshots) under Node v22.17.1. The local runner reused the repository's unit configuration with an isolated native SQLite dependency, roots restricted to `tests/unit`, and worktree-local caches. An initial attempt with the shared dependencies stopped at the missing native SQLite binding before queue construction; that was a dependency failure, not a conformance verdict.

From a verified linked worktree with compatible dependencies, the focused suite runs under the repository's Jest unit project:

```sh
mkdir -p .cache/test-tmp
TMPDIR="$PWD/.cache/test-tmp" node --experimental-vm-modules node_modules/jest/bin/jest.js \
  --selectProjects unit --runInBand --cacheDirectory "$PWD/.cache/jest" \
  --runTestsByPath tests/unit/future-admission-conformance.test.js
```

Use dependencies with a native `better-sqlite3` build matching the selected Node runtime. Keep temporary files and the Jest cache in the dedicated worktree, and restrict Jest roots if retained research dependency caches contain unrelated snapshots. Selecting the unit project avoids the repository's integration setup.

Only the queue module, the inert central-table module, SQLite, Node built-ins, and the bounded Python checker participate. There is no imported worker/runner/spawn adapter, daemon, local Port Daddy CLI, service, hook, network request, or launched agent. Stored worktree and session strings are fixture metadata; they create no filesystem worktree or runtime session.

Skill guidance applied offline: [Port Daddy agent](../../../skills/port-daddy-agent-skill/SKILL.md), [internal contributor](../../../skills/port-daddy-internal-dev/SKILL.md), and [runtime verification](../../../skills/runtime-verification-for-agents/SKILL.md). The latter supplies the distinction between a finite observed trace, complete event/writer coverage, and compulsory effect mediation. Its live-runtime examples remain suspended by the operator halt.
