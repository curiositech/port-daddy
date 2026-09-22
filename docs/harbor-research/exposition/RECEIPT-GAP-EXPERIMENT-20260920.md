# Missing-receipt experiment: local evidence, not runtime certification

## Result

An actual local SQLite mock receiver was exercised across four declared
process-crash schedules with three recovery policies. Each operation requested
ten **synthetic units**. No network, payment provider, model, Port Daddy runtime,
credential or paid service was used.

| Crash point | Sender journal + retry | Sender journal + hold | Receiver deduplication + retry |
|---|---|---|---|
| No crash | 1 effect; done | 1 effect; done | 1 effect; done |
| After intent, before effect | 1 effect; done | 0 effects; pending | 1 effect; done |
| After effect, before local receipt | **2 effects; done** | 1 effect; pending | 1 effect; done |
| After local receipt | 1 effect; done | 1 effect; done | 1 effect; done |

Before recovery, the two middle crash histories had identical local state:
`["principal-1:payment-1", "pending", null]`. The receiver had zero committed
effects in one and one in the other. The recovery policy could not inspect
that hidden receiver state; only the post-run test controller did so.

The intact receiver atomically retained the key, request payload, effect and
receipt. Replaying an identical request returned its stored receipt. Changing
the payload under that key was rejected. The assertions check those bindings,
not merely a `done` flag or a count.

## Negative and restoration evidence

- Removing the receiver's retained key after commit allowed a second effect.
- Marking the sender done before sending caused a false completion with no effect.
- Disabling payload binding accepted a mismatched request.
- Nine corruptions of receipt/key/payload links or retained-key presence were
  rejected by the post-run oracle. These are oracle tests, not nine crash runs.
- All four intact receiver schedules passed again in fresh restoration databases.

Final run: 12 primary cases, two crash/recovery mutants, four restoration cases,
plus payload and oracle tests; **22 top-level checks** passed. This finite matrix
was enumerated, not randomly sampled. There is no confidence interval or
inference about live agents. The parent independently read all 18 retained
sender/receiver database pairs and matched their rows to the result JSON.

## Reproduce and inspect

Original retained experiment directory:
`/Users/erichowens/coding/tmp/book-human-review-20260920/research-graft-next/`.
The detailed `PROTOCOL.md` specifies the cutpoints, observation boundary,
predictions, stop conditions and excluded regimes. `REVIEW.md` retains the
source/proposal comparison and exact observations. Repository reuse now starts
at [the packaged protocol and runner instructions](../experiments/receipt-gap-20260920/README.md).
The original source and run-02 records are byte-exact archival evidence; do
not run the archived source in its source directory. Use the guarded runner:

```sh
/usr/bin/python3 -B scripts/harbor-research/receipt_gap_experiment.py \
  --out .cache/receipt-gap-my-fresh-run
```

Choose a previously nonexistent output directory. The runner refuses existing
outputs, broad/source paths, aliased stores and unmarked workers. These are
accidental-misuse guards, not a hostile-filesystem security boundary. The
receiver runs as a mock request interface within the worker process, not in
an OS-isolated service. No automatic retry follows a worker timeout.

The packaged suite passes 19 tests, including a separate 36-worker fresh
reproduction, wrong-payload rejection, effect/key rollback, observer-interface
separation and deliberate lies. Parent re-execution also passed; its fresh
result is `.cache/receipt-gap-tests/reproduction-9ln8fo9n/matrix/experiment-results.json`,
SHA256 `e0d93a0061c1ed6b0d2fe127f2e246e6b152c49d20ffcd5736dcc959b94af216`.
All 22 experiment gates passed, with measured records equal to run-02 but
distinct provenance. Fresh checks are not retroactively claimed for run-02.

| Artifact | SHA256 |
|---|---|
| Final `run-02/experiment-results.json` | `e93863430b6b09d7845aa637304e719114e60c9444529deb3fc1ed6cadbc7a38` |
| Executed `receipt_gap_experiment.py` | `8fcbe645943730e4473a050c6f54710892a502c55ae0ca42513e0002e176a880` |
| Preregistered amended `PROTOCOL.md` | `b4e2dc03efbb9842a2a2f41b8bf8bee91fc269d8a9de71959c36e77c44fbadc1` |

Run-01 is preliminary: the parent rejected its count/state-only receiver
oracle. The strengthened protocol and script preceded run-02, and all three
final hashes were independently checked. No run directory was erased.

## What transfers to the Book

Harbor Paper 8 is a gated systems prospectus, not an executed eighth paper:
`docs/harbor-research/tex/doc4_papers.tex`, Paper 8 section. The product roadmap's
`doc2_product.tex` Phase 1 bullet promises at-most-once external effects from
an operation journal without stating the necessary receiver/reconciliation
contract for useful retry-based recovery. That underqualification is flagged,
not silently promoted into the Book.

The Book already distinguishes deduplication from arbitrary external-effect
recovery in `fig:swk-idempotency-gap` and the redelivery exercise solution.
The proposed extra marginal paragraph was withdrawn as substantially redundant.
The two-history witness and measured finite crash matrix now replace the old
figure, with clear scope labels, concrete journal slips and unchanged figure
number. The parent inspected Figure 1.9 on physical page 55 / folio 27 in the
693-page receipt-gap proof. The neighboring prose now distinguishes message
IDs and replay guards from operation keys bound to effects and receipts.
No new theorem or implementation guarantee follows from this experiment.

Excluded: power loss, concurrent requests, expiring keys, malicious receivers,
irreversible effects outside the receiver transaction, provider adapters,
cancellation, indefinite unavailability, and the canonical runtime. At-most-once
safety alone is possible by never retrying; the experiment tests the additional
obligation of useful recovery without duplicates or false completion.
