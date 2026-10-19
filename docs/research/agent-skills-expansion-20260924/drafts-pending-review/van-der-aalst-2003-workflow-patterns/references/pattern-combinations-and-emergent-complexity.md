# Test interactions with bounded trace suites

Pattern combinations have extra state: an OR-split must communicate its activation set
to its merge; a discriminator must distinguish winner, late arrival, and reset; a
cancellation request requires a separate terminal disposition. Build a small suite from
the combinations the product actually supports rather than claiming that every pair is
exhaustively covered.

A useful interaction fixture names inputs, activated branches, event order, expected
successor count, late-result handling, and cleanup authority. Vary order and duplicates
where the engine admits concurrency. This is a test-design method, not a claim of
general non-composability.

## Constructed interaction fixtures

| Combination | Event sequence | Expected observation | Boundary exposed |
|---|---|---|---|
| Multiple Choice + Synchronizing Merge | Select B,C; B ends; inactive E never starts; C ends | D enabled once after C | Active-set identity and cycle scope |
| Discriminator + repeated cycle | B arrives; C arrives; new cycle's C arrives | One D per cycle, first cycle resets only after both arrivals | Late arrival must not reset or fire another cycle |
| Parallel Split + cancellation profile | B ends; cancel requested for C; C returns late | Record separate task, cancel and effect dispositions | Request is not termination or rollback |
| External choice + timeout | Completion event and timeout race | One chosen control outcome under declared arbitration | Late effects still require reconciliation |

For a cancellation region beyond Patterns19/20, specify exactly which activities are
included and whether any atomicity is actually provided. Asynchronous cancellation need
not be all-or-nothing; the contract can expose partial termination and pending effects.
Never present a control-flow cancellation as automatic distributed rollback.

## Original discriminator versus accepted-result race

The original first-arrival discriminator does not validate domain results. In a local
accepted-result extension, branch B can return an invalid result before C returns a
valid one. Specify whether invalid B counts toward the remaining-members set, whether
all-invalid closes as failure, and when the cycle can reset. A canceled member cannot
silently disappear from accounting. Do not reuse an original Pattern9 proof for this
changed state machine without establishing the extension's semantics.

## Diagnose without inventing causes

A successor that fires twice may reflect a duplicated observation, repeated activity
execution, mixed cycle IDs or a non-atomic transition. Capture identifiers to separate
these. Passing an active set as data is a possible correct encoding, not proof that an
engine is fundamentally defective. Scheduler-dependent choice may be permitted
nondeterminism; reproducible replay needs the actual arbitration result recorded.

Test only the combinations the product claims, with ordinary, reversed, concurrent,
duplicate, missing and late observations as applicable. Report untested combinations.
