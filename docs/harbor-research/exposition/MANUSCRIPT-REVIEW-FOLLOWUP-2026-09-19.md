> Review-before-fix record. The four findings below were subsequently repaired by the lead. See MANUSCRIPT-REVIEW-RECONCILIATION-2026-09-18.md for final disposition and verification.

# Bounded manuscript follow-up — 2026-09-19

Read-only source review, completed approximately 00:09 PDT. Worktree: `/Users/erichowens/coding/tmp/book-figures-reconciled`, HEAD `8d117db10c3cdc0be14087de42ae5c9f6da16599`, with the lead's uncommitted revisions. This report is the only file written by this follow-up. No manuscript changes, compilation, agents, Port Daddy, or dependency installation.

Scope: revised mathematical statements and their immediate examples, exercises, implementation-status claims, local/federated Float Plan boundary, and Kani harness. Not a complete reread or acceptance of the pending rendered Book. Hodge exposition, Appendix OP routing, and .342 rounding were excluded as requested.

## Remaining substantive findings

All four findings are P2 manuscript correctness/consistency defects. They do not establish a newly introduced runtime vulnerability. Findings 1 and 2 should be addressed first because they directly misstate money ownership and verification coverage.

### 1. P2 — The canonical local Float Plan still changes the collateral payer and overstates deployment

- `website-v2/public/whitepaper/harbor-economy.tex:564–600`, labels `def:float-plan`, `prot:escrow`: the requester R must hold and is debited **bounty + bond**; the text calls the described object Built and gives a no-running-without-escrow postcondition.
- Same file `:665–673`, worked settlement, and `:1971–1985`, `ex:he-partial-settlement-trace`: Bob supplies the bounty, Alice supplies the provider bond, and Alice bears the slash. The displayed conservation arithmetic is correct for those two funding sources, not for the stated R-only ceremony.
- Same file `:621–626`, `prop:nospawn`, explicitly says runtime enforcement is still caller discipline; `:2833–2846`, `app:impl`, grades the ledger Built, the running-state gate BuiltWeak, and the **Float Plan + signed ceremony Designed**.
- `website-v2/public/whitepaper/agent-transactions-whitepaper.tex:801–811`, `def:float-plan`, now correctly separates provider collateral, requester bounty, and a Designed federated 2-of-3 profile. That repair has not propagated back to Chapter 6's canonical protocol.
- Concrete implementation boundary: `lib/bonds.ts:89–100` accepts a project, agent ID, and bond amount; `:455–468` debits that project's wallet and inserts the bond atomically. This code slice does not implement the illustrated two-principal bounty/bond handshake or its signed manifest.

Why it matters: conservation alone does not determine whose wealth is at risk. The text cannot derive provider deterrence from a ceremony that only escrows the requester's funds, and the ledger's implementation does not establish the stronger signed-protocol or spawn-gate claim.

Modest fix: retain the ledger's Built status, explicitly mark the signed two-party Float Plan ceremony Designed, and make its funding preconditions/debits match the worked example: requester bounty and separately authorized provider collateral. Include the bond and funding principals in the signed terms. Keep the runtime admission postcondition a design obligation until the gate exists. No federation or 2-of-3 machinery is needed for the local accounting description.

### 2. P2 — Kani's corrected scope still conflicts with the explanatory example

- `website-v2/public/whitepaper/anchor-protocol-whitepaper.tex:554` and `:1725`, `ex:anchor-kani-scope`, correctly say the zero-byte decoder prevents successful acceptance; the source listing uses unwind 128.
- Same file `:832–850`, the “thirty-two symbolic bytes” example, still says acceptance may be reached because the stubs say so (`:844–845`) and explicitly includes **payload extraction and expiry comparison** among explored paths (`:850`).
- `core/harbor-card-rs/src/lib.rs:599–604`: the decoder can return only an error or 32 zero bytes. `:525–528`: the header is parsed as JSON and its error is propagated **before** payload parsing (`:532–535`) or timestamp guards (`:544` onward). Consequently even a successful signature stub cannot reach claims, expiry, or acceptance. `:625–637` confirms the three stubs and unwind 128.

Modest fix: replace the two stale sentences with the exact reached-path boundary: token splitting, stub outcome/error handling, and rejection at header JSON parsing. Payload, expiry, and successful acceptance remain outside this harness's reached paths. Preserve 128, the 32-byte bound, and the distinction from real cryptographic checks. No harness expansion is required to make the prose true.

### 3. P2 — Graduated-trigger instructions do not specify the joint punishment state assumed by the calculation

- `website-v2/public/whitepaper/agent-transactions-whitepaper.tex:884–891`, `sec:claim-signaling-ic`: each agent reacts to the **opponent's** last action; after seeing F, it punishes for three rounds, with a restart on deviation.
- Same file `:895–911`, `prop:claim-signaling-ic`: the calculation assumes **three subsequent rounds of mutual (F,F)** and common resumption of T. The corrected public-monitoring assumption is necessary but does not itself define this shared state machine.
- Literal one-step witness: after `(A:F, B:T)`, A saw T and rule 2 prescribes T; B saw F and rule 3 prescribes F. The first prescribed punishment round is therefore `(T,F)`, not the `(F,F)` used in the payoff calculation. Later punishment/restart timing is correspondingly ambiguous.
- `proofs/economics/claim_signaling.tla:220–234,258–261` instead uses a **single public `punishCountdown`**, and makes both agents play the punishment action while it is positive. This is a narrower one-shot-deviation witness, not a check of the literal two separate opponent-trigger instructions.

Modest fix: state a public mode/countdown: cooperation initially; a publicly observed deviation from the prescribed profile puts **both** agents into a three-round F phase; compliant punishment decrements the shared counter; a deviation during punishment resets it; at zero both return to T. This aligns the intended mutual-punishment calculation without changing its cubic, payoff table, or monitoring hypotheses. Do not infer that the existing bounded one-shot model proves arbitrary histories or the reset extension.

### 4. P2 — Federated partial settlement needs an explicit distinction between bond status and payout amounts

- `website-v2/public/whitepaper/federated-harbor-whitepaper.tex:865–873`, `prop:fh-cross-cons`: each of the posted, escrowed, cleared, and refunded buckets is restricted to `{0,a_b}`, with exactly one containing the whole amount.
- Same file `:823`, `sec:fh-escrow`, and `:899–904`, `sec:fh-settle-proto`: **clear** pays the beneficiary and refunds the remainder to the source; the worked migration at `:1012` also does this.
- Witness if these buckets denote actual cleared/refunded money: a 100 bond settling as 80 to the beneficiary and 20 refunded conserves value, but `(P,E,C,R)=(0,0,80,20)` violates both the individual bucket domain and one-whole-bucket invariant. The new example at `:882–888` only covers full clearance (including fees) or full refusal and therefore does not exercise this ambiguity.

Modest fix: preserve the bounded state-machine result by defining P/E/C/R as **whole-bond lifecycle status accounts**, with C meaning the complete resolved clear transaction, including any beneficiary payout, source remainder, and fee. State a separate recipient subledger whose nonnegative outputs sum to `a_b`; R then denotes a full refusal/refund outcome, not every payment back to A. Add the 80/20 example. Alternatively allow amount-splitting buckets and revise the model/invariant, but that is a larger change and must not inherit the present one-hot proof unchanged.

## Repairs checked without a further substantive objection in this slice

- C1 `whitepaper/single-writer-kernel.tex:2065–2101`, `thm:consistency`, and `:2711`, `ex:swk-linearizability-assumptions`: crash-free linearizability is separated from end-to-end crash recovery; FULL is not promoted to an application recovery proof.
- C2 Kani summary, listing, and exercise now use 128 and acknowledge the stubs; only the propagation gap above remains. Revocation text names expiry enforcement, skew allowance, and rollback constraints.
- C3 `website-v2/public/whitepaper/sealed-harbor.tex:831–848` explicitly separates real per-release DP mechanisms from a malicious worker's declared budget; `:1058–1080` qualifies timing-slot capacity, failed/no-result observations, and canary limits. A self-contained theorem statement would benefit from repeating the DP premise, but the surrounding text supplies the substantive boundary; this is not listed as a new major finding.
- C4 `whitepaper/legible-swarm.tex:1017–1070`, `hyp:spec-variance`: service mean is no longer scaled by variance, and the pooled comparison is explicitly approximate. `:1863–1884`, `thm:zoom-advantage`, fixes the strict density endpoint.
- C5 `website-v2/public/whitepaper/spawn-to-person.tex:1268–1397`, `thm:probation-dominance`: finite-horizon capacity, zero/exact-capacity cases, and distinct lifetime/period participation constraints are explicit. `:1414–1417` retains the uncapped-sweep limitation. `:2252–2293`, `thm:tower-imported`, explicitly assumes conditional detection and fixes strict target depth.
- C6 `website-v2/public/whitepaper/harbor-economy.tex:1195–1218`, `thm:ms` worked example: all-draw mass, conditional efficient-trade mass, and lost surplus are distinguished. `:2684–2743`, `eq:assurance-jensen` / `eq:assurance-beta`: conditional independence, the Beta mixture, and the pairwise-versus-joint counterexample are properly scoped. `:801–815`, `thm:deontic-detect`, distinguishes existence/one witness from complete output enumeration.
- C7 `website-v2/public/whitepaper/agent-transactions-whitepaper.tex:914–930` does not identify ledger order with perfect public monitoring; `:1473–1488` correctly limits the budget-breaker analogy and allows individual deterrence from buyer compensation.
- C8 `website-v2/public/whitepaper/federated-harbor-whitepaper.tex:686–744`, `thm:radius-soundness`, `thm:radius-localization`: the kernel is that of the projected operator; the upper bound uses its operator norm; and retaining the maximum requires a ranking gap rather than signal strength alone. The positive-eigenspace diffusion discussion does not claim a deployment gossip convergence proof.

## Checks and limits

- Ten independent standard-library, in-memory arithmetic witnesses passed: service/wait separation; finite probation capacity; capped schedule; lifetime versus period participation; zoom endpoint; the three trade denominators; Beta-mixture numbers; equal pairwise moments/different joint misses; strict tower depth; and the 80/20 bucket counterexample. These are mathematical spot checks, not new verification of the manuscript's full models.
- `tests/harbor-research/test_review_math_boundaries.py` could not execute because NumPy is absent from both existing `.cache/type-tools311` and `.cache/type-tools` environments (also absent from the default Python). No dependency was installed and no suite pass is claimed.
- Kani reachability and the TLA countdown comparison were inspected in source, not rerun. No runtime was started and no current CI pass was inferred.
- No complete exercise audit, full Book reread, rendered-page assessment, or compilation was performed. The previous PDF is not evidence for the pending source changes.

## Source fingerprints at final read

SHA-256; paths relative to the worktree root:

```text
238646ce3fc28f37fdf5de5e4174dd80ab64ca1476984c9d78fc96165f061378  website-v2/public/whitepaper/harbor-economy.tex
1930401163d560cee45c34a6bf5083bfcc0dd16025f790f99d728d57179872b9  website-v2/public/whitepaper/anchor-protocol-whitepaper.tex
c90d35ce416cbcb7ee22891bb0e53e522d06aba1fe35b02b926cccd4dc1d13ea  website-v2/public/whitepaper/agent-transactions-whitepaper.tex
02c21fea7393f2ba42919b33168539164bbca12e37c7012c623fb8f98b9a059e  website-v2/public/whitepaper/federated-harbor-whitepaper.tex
```

Concurrent lead edits may shift line numbers; the labels and witnesses identify the claims independently of pagination.

