> Historical baseline inventory. Its pending-fix rows describe the 705-page September 18 baseline. Consult [the reconciliation report](MANUSCRIPT-REVIEW-RECONCILIATION-2026-09-18.md) for subsequent changes and final verification. Original page/line references are intentionally preserved.

# Reconciliation of ManuscriptReview-09082026.pdf

Read-only review, 2026-09-18. Scope: the 30-page PDF alone, not the two separate Markdown reviews. No manuscript changes, build, agent launch, or Port Daddy operation was performed. This report is the only authored file.

## Witness and method

- Review: `/Users/erichowens/Library/Mobile Documents/com~apple~CloudDocs/phone_outbox/ManuscriptReview-09082026.pdf`, 30 pages, SHA-256 `7668398cec564b25b0310059592c2ddd1d409cf89a67459e8c7ee707fabfecc9`.
- Book: `/Users/erichowens/coding/tmp/book-figures-reconciled/.cache/book-flow-20260918/coordination-papers-mega-volume.pdf`, **705 pages**, SHA-256 `04c052f49e543037d73cd229e4ba2d9436c1d09979ce0fed724bf58bdcdc9b9e`.
- Worktree HEAD at inspection: `8d117db10c3cdc0be14087de42ae5c9f6da16599`. The worktree contains substantial pre-existing dirty changes. Evidence below describes the files actually read, not a claim that HEAD alone contains them. Preserve those changes.
- All 30 review pages were read with `pdftotext -layout`. Equations missing from extraction on review pp. 6–10 and 23 were also read from in-memory PyMuPDF renders. The Book's current `.aux` labels were resolved against its actual PDF destinations for exhibit placements. Selected current mathematical passages were checked against source, implementation/harness source where relevant, primary literature, and small independent arithmetic calculations. No proof suite or experiment was rerun.
- This is a reconciliation, not a new complete proof audit or aesthetic certification of 705 pages. “Addressed” means the requested explanation/exhibit is present at the identified location, not that its entire implementation has been validated.
- The Book-rewriter guidance influenced the review by keeping claim kind, implementation maturity, model scope, and deployment evidence separate. It did not authorize manuscript edits.

### Dispositions

**Addressed**: requested material exists now. **Gap**: a concrete correction or omission remains. **Partial**: useful response exists but leaves a stated defect. **Optional**: pedagogical preference or new research, not a correctness prerequisite. **Reject**: the review's inference/remedy is wrong or would overclaim. **Unresolved**: the available evidence does not discharge the claim. Mixed dispositions are intentional.

### Source key

All `C#:line` references below mean the exact canonical file in this table, followed by its source line number(s); the nearby stable LaTeX label is also supplied. Book labels add the chapter prefix shown. Ranges are source evidence, not assertions about PDF line numbers.

| Key | Canonical file | Book label prefix |
|---|---|---|
| C1 | [whitepaper/single-writer-kernel.tex](/Users/erichowens/coding/tmp/book-figures-reconciled/whitepaper/single-writer-kernel.tex) | `swk:` |
| C2 | [website-v2/public/whitepaper/anchor-protocol-whitepaper.tex](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/anchor-protocol-whitepaper.tex) | `anchor:` |
| C3 | [website-v2/public/whitepaper/sealed-harbor.tex](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/sealed-harbor.tex) | `sealed:` |
| C4 | [whitepaper/legible-swarm.tex](/Users/erichowens/coding/tmp/book-figures-reconciled/whitepaper/legible-swarm.tex) | `ls:` |
| C5 | [website-v2/public/whitepaper/spawn-to-person.tex](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/spawn-to-person.tex) | `stp:` |
| C6 | [website-v2/public/whitepaper/harbor-economy.tex](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/harbor-economy.tex) | `he:` |
| C7 | [website-v2/public/whitepaper/agent-transactions-whitepaper.tex](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/agent-transactions-whitepaper.tex) | `bonded:` |
| C8 | [website-v2/public/whitepaper/federated-harbor-whitepaper.tex](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/federated-harbor-whitepaper.tex) | `fh:` |
| ROOT | [coordination-papers-mega-volume.tex](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/coordination-papers-mega-volume.tex) | none |
| SEAMS | [coordination-papers-mega-volume-seams.tex](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/coordination-papers-mega-volume-seams.tex) | none |
| APP | [coordination-papers-mega-volume-appendices.tex](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/coordination-papers-mega-volume-appendices.tex) | none |

## 23:45 PDT handoff update — supersedes the pending-fix list below

The lead reports correcting queue service/wait variance separation, finite-horizon probation and participation, linearizability/crash wording, residual kernel/norm/noise ranking, the false tree-gap premise, Myerson–Satterthwaite denominators, correlated-panel assumptions, public monitoring, budget-breaker overclaim, timing channels and revocation TTL guards. **Do not re-open these as pending on the strength of the original rows below.** They are retained as a record of how every criticism was assessed against the 705-page snapshot. A subsequent live read independently found the revised public-monitoring paragraph and the corrected zoom endpoint; the rest of the lead's reported changes are not presented as a fresh full verification here. No rebuild was performed.

Additional issues still present in the live source at this handoff, beyond that correction list:

| Inventory row / review page | 705-page Book witness (PDF / folio) | Current source anchor | Smallest useful next action |
|---|---|---|---|
| 4 / review p. 2 | 476 / 448 | C7:801–819, `def:float-plan`, `def:settlement`; compare C6:564–598 and C8's candidate-multisig paragraph | Make C7 a collateral specialization of C6's definition; mark multisig as the Designed federation variant, not ordinary built local settlement. |
| 64 / review pp. 21,24 | 135 / 107 and 141 / 113 | C2:552 and 796 (`sec:correct`, `sec:implementation`); Rust `core/harbor-card-rs/src/lib.rs:630` | Change the historical ten-iteration claim/listing to current unwind 128, with the same 32-byte/stub limits. Explain zero-byte decoder stubs at Rust:599–604 as the reason acceptance is not exercised. |
| 46 / review pp. 14–16 | 550–551 / 522–523 | C8:537, `sec:fh-sheaf` | Replace the identification of the entire non-gradient residual with “curl” by cyclic/divergence-free residual; distinguish curl and harmonic components. |
| 33 / review p. 11 | 362 / 334 | C5:2386–2395, `sec:oracle`, following `thm:tower-imported` | Remove “the grading oracle … is no longer an assumption”; retain the honest-root, sealed-sampling and effective-detection assumptions the preceding paragraph names. |
| 41 / review pp. 13,15 | 399 / 371 | C6:713–718, near `tab:he-grossman-hart-roles` | Replace “By [GHM] … renter must hold” with a safety-motivated design allocation, not a derived efficiency theorem. |
| 72 / review pp. 25,29–30 | 324 / 296 | C5:1003, `tab:death-ladder` | Scope latent-state unavailability to the assumed provider interfaces; “out of reach in principle” is not true of every same-runtime exposed cache. |
| 34 / review pp. 11–12,17 | 401 / 373 | C6:801–805, `thm:deontic-detect` | Say “finds a conflict witness” at the given sorting bound, or add output-size +Z for enumerating every clash. |
| 27 / review p. 8 | 480 / 452 | C7:906–910,937,943, `prop:claim-signaling-ic` | Normalize the threshold to the exact root or 0.3425, not 0.342; reject the review's 0.3419. |
| 78 / review p. 26 | 9 / ix versus 657 / 629 | ROOT:245–247 versus APP:52–54, `app:volume-status` | Remove the total-order implication from frontmatter; assurance modes and evidence/maturity are separate axes. |
| 79 / review pp. 26–27 | 674 / 646 | APP:283–307, `app:open-concordance` | Optional completeness repair: individual labeled open-question links rather than grouped themes, or call the table a thematic index. Do not falsely close OP-4a, OP-5 or OP-11. |

The 94-row inventory is complete as a PDF-review mapping; further manuscript verification belongs to the owners applying changes. All eight named “missing visual” groups have current Book placements in rows 49–58. The two MD reviews were not read or edited.

## Original priority findings — snapshot record, not the current pending queue

Do not repeat the review's proposed wholesale mathematical rewrites. The highest-value modest corrections are:

1. **Float Plan / custody drift**: C7 defines a federated multisig instrument as the ordinary Float Plan, while C6 uses local daemon escrow and C8 expressly calls multisig a candidate design. See row 4.
2. **Incorrect heavy-tail extension**: scaling waiting time does not scale service time; replacing only `A` by `A/kappa` fails even inside the stated approximation. See row 21 and calculation A.
3. **Probation statement and participation inference**: finite-horizon feasibility is missing; strict-ratio uniqueness survives the cap; a lifetime participation inequality does not imply a per-period income floor. See rows 25–26 and calculation B. The named script checks the uncapped problem.
4. **Kani source/harness drift**: the source uses `unwind(128)`, while chapter prose/listing still say ten. The actual decoder stub supplies zero bytes, explaining rejection-only coverage more precisely than token length alone. See row 64.
5. **Sheaf qualifications**: the review's single-liar complaint is addressed, but the noise inequality does not preserve a full edge ranking; “curl” is not the whole Hodge residual; a connected tree does not have zero graph spectral gap. See rows 32, 46, 77 and calculation D.
6. **Smaller precision fixes**: zoom strictness at `d=1/12`; repeated-game root rounding; the denominator of the 21.9% trade figure; overstrong GHM/Holmström analogies; and the oracle-is-“no longer an assumption” sentence. See rows 24, 27, 33, 39–41.

## Exhaustive numbered reconciliation

Repeated criticisms in review summary tables are explicitly cross-mapped rather than counted as new discoveries.

### Structure, audience, and chapter responsibility

1. **Review p. 1 — three identities; proprietary architecture manual versus textbook/research collection. Addressed / clarification.** ROOT:215–219 explicitly says this is a mechanisms-and-limits book, not an installation guide or deployment approval; ROOT:240–253 separates evidence kinds. The review's 500-page snapshot is not this 705-page Book. `LICENSE:1–12` names FSL 1.1 with an MIT conversion after two years: call the repository **source-available under its current license**, not automatically OSI-open-source, and do not infer “proprietary” means unavailable source. No license change is proposed.

2. **Review p. 1 — uneven proof/evidence maturity, heuristics mixed with machine checks. Partial.** The complaint's general direction is right, but uniform proof strength is neither necessary nor honest. ROOT:240–253 and APP:28–33 (`app:volume-status`) already distinguish theorem, bounded model check, empirical hypothesis, and implementation. Fix individual label/claim drift in rows 25, 33, 64, 78; do not promote Python sweeps or TLC state counts into general mechanized proofs.

3. **Review p. 2 — Part I→II needs the sealed-black-box/operator-attention bridge. Addressed.** SEAMS:72–85, `\pdchapterhandoffsealed`, explicitly makes opacity the cost of sealing execution and makes Chapter 4 the response. Preserve the handoff and the part spread; no extra bridge essay is needed.

4. **Review p. 2 — competing Float Plan definitions. Gap.** C6:564–598 (`def:float-plan`, `prot:escrow`; PDF 395/folio 367) defines a signed work declaration and local daemon transaction. C7:801–819 (`def:float-plan`, `def:settlement`; PDF 476/folio 448) instead makes a **2-of-3 Harbor A/B/arbiter clearinghouse** part of its definition and ordinary settlement. C8:817 (`thm:fh-escrow-bound` discussion) calls that arrangement only a candidate design with capture/rail assumptions unanalysed. APP:272 already assigns Float Plan ownership to C6, but the prose violates it. Minimum fix: replace C7's second definition with a reference to C6 plus its collateral/manifest specialization; move the multisig sentences to an explicitly Designed federation variant pointing to C8. `lib/bonds.ts:190–221` shows local wallet/escrow tables, not evidence that the proposed multisig ceremony ships.

5. **Review p. 2 — duplicate four-message transfer in C6/C8. Addressed in Book.** C6:1241–1258 (`sec:anchor`, `sec:fh-xfer`) uses `\ifpdbook` to refer to C8's `sec:fh-xfer-ceremony`; the detailed figure/protocol is retained only for standalone-source use. Preserve that distinction. Do not delete the economic need for transfer.

6. **Review pp. 2, 4 — duplicate topology and threat-band exhibits. Addressed in Book.** C6:1329–1339 and 1487–1496 guard both repeated inputs with the non-Book branch. Current Book has `fh:tab:fh-topology` only as Table 8.1, PDF 533/folio 505, and `fh:fig:fh-threat-bands` as Figure 8.2, PDF 541/folio 513. No deduplication edit needed.

7. **Review p. 2 — duplicate Keystone Split. Addressed.** C6:1041–1051 (`sec:keystone`) explicitly declines to reprint C5's table in the Book. `stp:tab:keystone-split` is Table 5.7, PDF 344/folio 316. The short C6 application to market assumptions is useful, not another definition to remove.

8. **Review pp. 2–4 — C6 economics, C7 local commons, C8 federation. Partial.** APP:247–278 (`app:ownership`, `tab:primitive-ownership`) states exactly this ownership rule. Most repeated exhibits are gone, but row 4 remains a substantive breach. Minimum fix is the Float Plan/custody correction, not excising every federation motivation from C6.

9. **Review p. 3 — link synchronous decidability to capability brokering. Addressed.** C1:1164 (`thm:decidability`), 1242–1260 (`thm:regimentation-controllability`) and C2:533 explain accept/reject at a mediated boundary versus a holder's subsequent authorized conduct. C1:2211–2285 (`sec:enforcement-gap`) supplies the capability-removal distinction and layered exhibit. Preserve the complete-mediation hypothesis; a local predicate alone cannot force an unmediated effect through the daemon.

10. **Review p. 3 — C2 should own cryptographic attenuation used by C7. Addressed / bounded.** APP:269 assigns it to C2; C2:630–666 (`alg:delegation`, `thm:attn-sound`) separates per-hop subset logic, transitive reasoning, and model depth. C7:910 explicitly cites Anchor. A short cross-reference is sufficient; C2 is the Book's expository owner, not a substitute for the underlying primitive's security assumptions.

11. **Review pp. 3, 21 — C3 too brief because it has 23 visual-register rows. Reject metric; substantive requests addressed separately.** C3:291–306, 565–596, 1048–1103 (`sec:sealed-design`, `sec:sealed-noninterference`, `sec:sealed-budget`, `sec:sealed-limitations`) now cover ceremony, laundering, capacity and boundaries. Register-row counts do not measure adequate treatment. Remaining timing qualifications are row 67, not a mandate to inflate the chapter.

12. **Review pp. 3, 22 — C4 lacks channel-capacity framing and overwhelms with many concepts. Addressed / Optional.** C4:1725–1733 makes a digest a codebook-addressing message; 1785–1838 (`thm:pinned-joint`) states the two budgets; ROOT:225–235 provides example/express-lane reading guidance. Density preference is not a model defect. Optional: point unfamiliar readers to the named examples before theorems, without deleting technical detail.

13. **Review p. 3 — unify Parfit continuity with cryptographic key lineage. Addressed with an important limit.** C5:618–639 (`fig:parfit`) connects overlapping continuity to accountable outcomes; 1617–1644 (`thm:resurrection-soundness`) names credential/witness, engine and liability guards. Keep “engineering analogue,” not a proof that signatures establish psychological identity or subjective continuity. See row 72 for an overly absolute latent-state claim.

14. **Review p. 4 — C7 as canonical local collateral/recovery; “high empirical depth.” Partial / Reject evidence inflation.** C7:1288–1296 and 1431–1465 (`sec:conservation`) supply lifecycle and ledger. APP:273 assigns ownership. The records are formal-model checks and repository tests, not field evidence about deployment welfare. Fix row 4; call the evidence by its actual kind.

15. **Review p. 4 — C8 must own witness/gossip/sheaf story. Addressed.** APP:274–276 assigns those primitives; C8:533–766 (`sec:fh-sheaf`) distinguishes log intuition from real-vector computation and continuous diffusion from packet gossip. Remaining accuracy problems are rows 30–32, 46, 77, not missing ownership.

### Mathematical and formal claims

16. **Review pp. 4–5, 10 — linearizability requires total wall-clock invocation order and a synchronized monotonic clock. Reject.** C1:2062–2079 (`thm:consistency`; PDF 85/folio 57) correctly requires commit before successful response and preserves non-overlapping real-time order; overlapping calls may linearize in either order. Queue arrival reordering alone is no counterexample. Do not add clock synchronization or downgrade to sequential consistency on this basis. [Herlihy–Wing's definition](https://cs.brown.edu/~mph/HerlihyW90/p463-herlihy.pdf) supports this distinction.

17. **Review pp. 4–5, 10 — NORMAL commits can disappear after host/power failure, leaving external fencing evidence. Addressed, with a wording fix.** C1:610–635 separates process from power failure; 2063 explicitly restricts crash scope; 2082–2098 names durable linearizability. [SQLite's synchronous documentation](https://www.sqlite.org/pragma.html#pragma_synchronous) supports NORMAL's power-loss durability limit, not the review's process-failure generalization. Modest fix: define durable linearizability in terms of preserving completed pre-crash operations, rather than the potentially circular phrase “operations persisting across a crash.” Do not suggest discarded acknowledged writes are repaired by merely reordering surviving operations. Fencing epochs must not be reused after rollback without a recovery boundary.

18. **Review pp. 5, 10, 15 — full observation omitted; add Lin–Wonham condition. Addressed.** C1:1243–1260 explicitly says full observation and points to C1:1482–1497 (`thm:observability-regimentation`; PDF 68/folio 40), which states controllability plus projection-based observability. Hidden latent events illustrate the boundary; they do not refute a theorem whose observed alphabet is stated. No further theorem expansion needed.

19. **Review pp. 5, 10 — epsilon ledger mistaken for semantic noninterference; laundering. Addressed.** C3:788–801 puts the syntactic/semantic distinction **inside** `thm:sealed-conservation`; C3:565–588 bounds the model's committed-input, payload-free submit and finite search. Preserve those clauses. A balanced ledger cannot certify an arbitrary worker's declared epsilon or make an unapproved transformation DP.

20. **Review pp. 5–6, 11 — M/M/c specialization algebra. Addressed; no algebraic repair to the base theorem.** C4:876–900 (`thm:specialization`, `eq:specboundary`) states Poisson/exponential/FCFS and the mean objective; 916–940 gives `g(rho,2)=1+2rho-rho²`. The review confirms this correctly. Keep the exact theorem separate from extensions.

21. **Review pp. 6, 11 — realistic bursts/heavy tails require a variance extension. Partial; the existing extension is wrong.** C4:1017–1063 (`sec:spec-heavy-tails`, `hyp:spec-variance`; PDF 234/folio 206) already cites Kingman, Pollaczek–Khinchine and Allen–Cunneen and labels the unrun sweep. But 1035–1050 claims scaling waits by `kappa` leaves the boundary intact except `A→A/kappa`; service-time terms do not scale. Calculation A refutes it even within that approximation. Minimum fix: retain the bounded M/M/c theorem, print the correct approximate response-time comparison, and mark the crossing unmeasured. Do not assert all agent workloads follow Pareto laws without data; infinite-second-moment cases need a separate limitation, not a finite correction factor.

22. **Review pp. 6–7, 11 — expand the pinned mutual information; claims strict convexity. Addressed / Reject the review's proof shortcut.** C4:1797–1838 (`thm:pinned-joint`, `eq:pinned-rate`) contains all four logarithmic terms, positivity/domain conditions and zero-rate region. The source says convex, correctly; the review says strictly convex in the channel, which fails globally (distinct independent channels all have zero mutual information). Preserve the source's weaker claim. Optional proof improvement: explicitly justify spending each constraint's slack rather than leaning on generic convexity alone.

23. **Review p. 7 — zoom assumes perfect group tests; noisy linters can prune defects. Addressed; noisy extension Optional.** C4:1861–1866 (`thm:zoom-advantage`) defines an exact emptiness oracle; 1984–1988 explicitly excludes noisy/correlated checks and non-unit costs. Add the two words “error-free” in the theorem for skimmers if desired. Repeated testing only reduces error under an additional noise/dependence model; it is not a free repair for systematic false negatives.

24. **Review pp. 7, 17 — zoom advantage crosses one at density 1/12. Gap in source strictness.** C4:1876–1879 says the guarantee “exceeds 1 exactly on d≤1/12,” but at `d=1/12`, `ceil(log2 12)=4` and the displayed advantage is exactly **1**. C4:1916 already calls it a touch. Minimum fix: “at least one for d≤1/12; strictly greater for d<1/12” and use the corresponding weak/strict condition at 1948 and 1988. This does not refute the query bound.

25. **Review pp. 7–8, 11 — front-loaded probation needs a capital/liquidity cap. Partial; correct the existing capped statement.** C5:1270–1300 (`thm:probation-dominance`; PDF 331/folio 303) now has `0≤g_t≤L`, but the finite horizon needs `Gmax≤L sum(t=0..T) delta_f^t`. The infinite-horizon limit supplied there is not the full finite-horizon feasibility condition. With `0<delta_f<delta_h<1`, strict cost/deterrence ratios still give a unique fill-earliest schedule; 1293 wrongly withdraws uniqueness when the cap binds. State positivity/feasibility, retain uniqueness, handle `Gmax=0`. `skills/harbor-results/scripts/b6_probation.py:5–40,65–69` checks an uncapped spike, not this added capped theorem. Do not transfer that verification tag to the extension without a bounded-L regression.

26. **Review pp. 8, 11 — front-loading excludes honest poor entrants and favours funded attackers. Partial / unresolved empirical effect.** C5:1302–1333 correctly distinguishes withheld earning opportunity from posted capital and acknowledges participation. However, a lifetime inequality at 1318 does **not** imply `g0≤pi0-u` or the corollary at 1322. Minimum fix: either add an explicit per-period income/working-capital constraint `g_t≤max(0,pi_t-u_t)` and name it as additional, or remove that corollary. The honest/malicious entrant mix is unmeasured; wealth also does not automatically determine the assumed discount factors. See calculation B.

27. **Review p. 8 — repeated-game cubic root about 0.3419. Reject number; small source correction.** The root is **0.342508031368…**, independently bisected. `proofs/economics/delta-threshold.expected.txt:3–6` and C7:958–963 (`ex:bonded-threshold-hand`) agree. C7:906–910 (`prop:claim-signaling-ic`) still says approximately 0.342, which is misleading at the cutoff (normal three-decimal rounding is 0.343). Use 0.3425 or the exact root throughout; do not copy 0.3419. The stated grim-trigger threshold 1/3 remains the appropriate separate limit under its payoff model.

28. **Review pp. 8, 12 — perfect public monitoring versus noisy private monitoring; communication/review/forgiveness. Partial.** C7:913–944 explicitly states the restriction and says the cross-harbor equilibrium is open. Add “perfect public monitoring at decision rounds” directly to `prop:claim-signaling-ic` at 910. One ledger supplies a common record, not automatic simultaneous observation of it: replace 921–922's claim that architecture buys the whole assumption with a decision-round/read-completion assumption. Do not claim private monitoring universally causes collapse. Also change the Kandori–Matsushima attribution at 936 to “communication-based equilibria”; belief-free equilibria are a distinct construction. [Original communication paper](https://www.cirje.e.u-tokyo.ac.jp/research/dp/94/f33/dp.pdf), [Ely–Hörner–Olszewski](https://onlinelibrary.wiley.com/doi/10.1111/j.1468-0262.2005.00583.x).

29. **Review pp. 8–9, 12 — categorical conservation invalid across changing currencies. Addressed; reject the stronger assertion.** C6:1133–1163 (`thm:functor`, `thm:lax`) now proves per-native-unit composition with an in-flight bucket and separates valuation time, fees and slippage. Changing prices do not destroy native-unit conservation, and even a chosen numeraire does not freeze mark-to-market value. No new FX theorem is needed; keep the exposure bound Open.

30. **Review p. 9 — trees absorb every lie; cycle formula for arbitrary cellular sheaves. Clarification / Reject generalization.** C8:539–550 (`thm:sheaf-equivocation`) restricts to real stalks with coordinate-prefix restrictions, reducing to visible scalar incidence graphs. The review introduces general restriction maps and then treats the scalar-graph forest conclusion as universal. That is not true for arbitrary non-surjective maps. Minimum source clarification: explicitly attach the single-edge iff and effective-resistance expression to a nonzero single-coordinate edge offset in this prefix-incidence regime; one equivocator can otherwise emit several offsets, including an invisible uniform change. C8:756–759 already names uniform-lie blindness.

31. **Review pp. 10, 12 — elevate single-equivocator restriction from box into detection/localization theorems. Addressed.** C8:545 says single equivocator and immediately names two-liar cancellation; C8:694 says noise-free single equivocator (`thm:radius-localization`). C8:747–759 and 1252–1257 give the coboundary coalition and distinguish forensics. No missing-hypothesis edit is needed. Cancellation means the *combined offsets lie in the coboundary image*, not necessarily that the two edge vectors literally sum to zero as the review suggests.

32. **Review p. 10 — localization “to the equivocator” under the noise inequality. Partial / genuine source overstatement.** C8:692–704 (`thm:radius-localization`; PDF 557/folio 529) only localizes residual support to cycles, not a culpable endpoint; C8:751–755 explicitly forbids attribution. But the proof's final sentence says `2||eta||<max residual` preserves the **ordering of edges**. It does not bound the gap between two competing entries. Minimum fix: retain a detectable/nonzero-entry guarantee, or add a top-versus-runner-up gap exceeding `2||eta||` for ranking stability. See calculation D. Do not promise culprit identification from a cycle residual.

33. **Review p. 11 — audit tower needs a model-diversity/correlation index. Partial; added model is sensitivity, not proof of independence.** C5:2300–2322 (`thm:tower-imported` discussion) links C6's mixture; 2375–2383 leaves honest root, sealed sampling and cross-clique correlation as obligations. Minimum fixes: qualify “independence … always” to the stated positive common-latent model; replace “C holds theta near zero” with a testable diversification hypothesis; replace 2385–2387's “oracle … no longer an assumption” with “recursion is conditionally bounded, given an honest root and effective audit parameters.” Distinct clique labels alone do not imply independent errors.

34. **Review pp. 11–12 — deontic dichotomy lacks worked conflict/reduction visual. Partial / Optional extra visual.** C6:797–828 gives theorem/proof; 831 places `fig:he-deontic-frontier`; 911–945 gives the requested `write_prod` witness and `fig:he-conflict-witness`. The literal clause-selector bipartite reduction is not that regime figure; an extra tiny worked 3-SAT selector example is optional. Actual modest correctness fix: at 805 change “finds every clash” to finding a witness, or add output-size `+Z` when enumerating all clashes (quadratically many overlapping pairs can exist). Keep NP-complete **conflict-freedom** distinct from unsatisfiability.

### Prior art and cross-domain bridges

35. **Review pp. 12–13, 15 — Dennis–Van Horn, Miller, Macaroons lineage. Addressed.** C2:265,310–325 (`sec:delegation`, `alg:delegation`) credits the lineage and explicitly discusses Miller and SPKI/SDSI. Preserve the distinction between Macaroons' construction and this signed-card format; “inspired by” does not transfer a cryptographic proof.

36. **Review pp. 13, 15 — engage Ryoan's request-oriented stateless/DAG confinement. Addressed / Reject necessity inference.** C3:167–198 (`tab:sealed-ryoan`) now contrasts input-once stateless modules with stateful agents. Ryoan's chosen restriction is not a theorem that **only** DAG execution can prevent leakage or that single-writer mediation is the necessary universal solution. Keep a comparison of threat models, not that exclusivity claim. [Original Ryoan paper](https://www.usenix.org/system/files/conference/osdi16/osdi16-hunt.pdf).

37. **Review pp. 13, 15 — add SCONE comparison. Addressed.** C3:174–181 cites SCONE and distinguishes protecting an application from its host from protecting a data owner against the application itself. Keep the comparison qualified to that threat model; do not imply enclaves or transparent containerization alone control an application's intended outputs.

38. **Review p. 13 — connect SQLite serialization to TigerBeetle, Litestream/LiteFS. Addressed / minor precision.** C1:2827–2837 (related-work footnote) now names all three as engineering precedent, not proof. Minimum improvement: link the official projects and distinguish Litestream backup/recovery from LiteFS live replication; do not jointly call both “read replicas.” TigerBeetle explicitly documents its single-core/leader design in its [performance documentation](https://docs.tigerbeetle.com/concepts/performance/). This is contextual, not a kernel validation.

39. **Review p. 13 — Myerson–Satterthwaite, “21.9% of gains from trade foregone.” Reject that denominator; source needs a small clarification.** C6:1172–1218 (`thm:ms`, `sec:ms`; PDF 412/folio 384) properly conditions the theorem and uses one Chatterjee–Samuelson equilibrium, not a universal percentage. `7/32` is **all type pairs** that are efficient but rejected. Among efficient pairs it is `7/16`; the lost expected surplus fraction is `5/32`. C6:1203–1205's “one trade in five that would …” risks the same denominator confusion. Replace with “21.875% of all type pairs, or 43.75% of efficient pairs.” Also replace 1188–1189's identification of a quoted lease price as a realized private value/cost draw: price is a different variable. Calculation C gives the integrals.

40. **Review pp. 13, 15–16 — commons pool as Holmström budget breaker. Partial; analogy overclaims.** C7:1487–1513 now cites and explains it, but 1490–1491 and 1511–1513 imply compensating a buyer necessarily destroys deterrence. Holmström's team result has an unobservable-effort/output-sharing model; it does not prove that every breach-compensation arrangement loses individual incentives. Minimum fix: say retaining forfeits outside the contracting coalition *can prevent a compensating transfer within that coalition*, conditional on the pool not returning value to it; remove universal “would … lose the deterrent.” Keep the no-first-best claim at 1506–1508. [Holmström original](https://people.duke.edu/~qc2/BA532/1982%20Rand%20Holmstrom%20team.pdf).

41. **Review pp. 13, 15 — formalize Float Plan as a GHM residual-control contract. Partial / Reject deductive force.** C6:712–729 (`tab:he-grossman-hart-roles`) already invokes Grossman–Hart. “The renter must hold runtime control” at 716–718 is not derived without specifying investments, outside options and surplus. Minimum fix: label allocation as the safety-motivated design choice illuminated by incomplete-contract theory. Optional Hart–Moore citation can broaden context; it does not establish that this particular allocation is efficient.

42. **Review pp. 13–15 — ground sanctions/monitoring in Ostrom. Addressed / qualify.** C7:301–321 and 1479 (`sec:governance` and conservation discussion) already cite monitoring and graduated sanctions. Do not infer that implementing four daemon services establishes all eight institutional principles or empirical commons success. Minimum fix if retaining “satisfies”: name the selected principles being instantiated rather than full framework compliance.

43. **Review pp. 14, 16 — Sheridan/Parasuraman automation levels; shift 8→4 at risk threshold. Addressed framework; exact levels Optional.** C4:534–558 (`sec:consent` context, consent-grant protocol) already maps grants to action-specific automation and cites the four processing stages. A concrete 8→4 mapping would need the actual interface/control policy; do not invent one or conflate an SDT classification threshold with authorization. Retain the current semantic mapping.

44. **Review pp. 14, 16 — canaries as response to Mackworth vigilance decrement/Bainbridge automation irony. Addressed.** C4:1396–1439 (`sec:abdication`, vigilance discussion) names both and separates monitoring from active intervention. If claiming canaries actually preserve vigilance in operators, retain Empirical hypothesis status until tested; literature motivation is not a user study.

45. **Review pp. 14, 16 — cite Hansen–Ghrist and state Laplacian/kernel relationship. Addressed.** C8:766 (`sec:fh-sheaf`) explicitly defines `Delta=delta*delta` for real stalks, its H0 kernel, and the lack of a bridge to packet gossip. The spectral-gap notation should be the smallest **positive** eigenvalue, not unconditionally the second eigenvalue where the kernel has dimension greater than one. [Hansen–Ghrist](https://jakobhansen.org/publications/spectralsheaves.pdf).

46. **Review pp. 14–16 — identify completion residual with Jiang et al.'s curl component. Partial / Reject equivalence.** C8:537 adopts the suggested comparison but collapses curl and harmonic parts. In HodgeRank, the non-gradient residual decomposes into a curl part **and** a harmonic part; a cycle without filled triangles can have harmonic inconsistency and zero local curl. Minimum fix: call it the “cyclic/divergence-free residual”; explain the curl/harmonic split only if adding a 2-complex. Correct the cited title to *Statistical ranking and combinatorial Hodge theory*. [Authors' paper](https://arxiv.org/abs/0811.1067).

47. **Review p. 16 — Locke/Reid/Parfit personal-identity lineage. Addressed.** C5:375–383 and 597–639 (`fig:parfit`) explain the Brave Officer objection and continuity/connectedness distinction. Preserve it as a bounded design analogy, not a claim that an outcome ledger is a philosopher's complete criterion of personhood. No new literature survey needed.

### Visual register and requested exhibits

48. **Review p. 16 — 378 candidates, 141 extant, 237 missing, 64 Must-Have. Stale / unresolved as a current count.** These are counts from the review's other input, not evidence that current Book exhibits are absent. I did not reconcile either separate MD document. The placements below were resolved from current Book aux/PDF, so all eight named visual groups can be checked independently. Do not treat a candidate catalogue as a requirement to add 237 pictures.

49. **Review pp. 3, 16–18 — ch1-25 two-state taint automaton. Addressed.** C1:1389 inputs `whitepaper/figures/fig-swk-taint-automaton.tex`, label at fragment:51, `fig:swk-taint-automaton`. It is Figure 1.14, PDF **66**, folio **38**. C1:2285 also places the requested multilayer mechanism (`fig:swk-enforcement-layers`), Figure 1.22, PDF **92**, folio **64**. No replacement requested on this evidence.

50. **Review pp. 17–19 — ch2-35 root-only v6 versus per-hop v7 chain. Addressed.** C2:1513 retains the terminal witness and 1532 inputs `figures/fig-anchor-v6v7-escalation`; `anchor:fig:anchor-v6v7-escalation` is Figure 2.10, PDF **161**, folio **133**. Preserve attack evidence alongside the explanatory diagram rather than replacing evidence with a drawing.

51. **Review pp. 3, 17, 19 — ch3-12 honest gate versus laundering fork. Addressed.** C3:591–596; `website-v2/public/whitepaper/figures/fig-sealed-laundering-fork.tex:83`, `fig:sealed-laundering-fork`. Figure 3.7, PDF **184**, folio **156**. The caption/model distinction must remain consistent with row 19.

52. **Review pp. 3, 17, 19 — ch4-32 rate-distortion regime map. Addressed.** C4:1841–1842 inputs `figures/legible-swarm-rate-regime`; `ls:fig:rate-regime` is Figure 4.11, PDF **257**, folio **229**. Its region must stop at the independence boundary; source's statement at 1826–1827 does so.

53. **Review pp. 3, 17 — ch4-33 adaptive-halving advantage plot. Addressed, with row 24's endpoint correction.** C4:1919 inputs `figures/legible-swarm-zoom-advantage`; `ls:fig:zoom-advantage` is Figure 4.12, PDF **259**, folio **231**. Keep the ceiling-induced bound rather than draw a falsely smooth exact guarantee.

54. **Review pp. 3, 17, 19 — ch5-21/22 engine-swap paired payoff regimes. Addressed.** C5:1586–1590; `website-v2/public/whitepaper/figures/fig-stp-engine-swap-regime.tex:51`, `fig:stp-engine-swap-regime`, Figure 5.6, PDF **339**, folio **311**. The accompanying resurrection witness is row 70.

55. **Review pp. 11–12, 17, 20 — ch6-09 Horn/3-SAT phase diagram and witness. Mostly addressed; exact reduction picture Optional.** C6:831 and 945 place `fig:he-deontic-frontier` and `fig:he-conflict-witness`; the former is Figure 6.3, PDF **402**, folio **374**. The existing side-by-side rule inventory is not a literal clause/selector bipartite graph. Retain it; add a tiny selector example only if readers cannot follow 820–825. See row 34's output-sensitive complexity fix.

56. **Review pp. 4, 17–18, 20, 23, 25–26 — ch7-46 lifecycle before TLA+. Addressed.** C7:1288–1298 first gives five English sentences, then `fig:bonded-session-lifecycle`, then code. Figure 7.12, PDF **502**, folio **474**. Do not manufacture six states merely to meet the review's count; the model owns the state set.

57. **Review pp. 4, 18, 20 — ch7-47 wallet/escrow/commons stock-flow. Addressed.** C7:1435–1463 defines the accounting state, proves each delta, and places `fig:bonded-conservation-ledger`. Figure 7.13, PDF **506**, folio **478**. Preserve the explicit topUp boundary flow; not every arrow is conservative in the closed three-bucket total.

58. **Review pp. 4, 18, 20, 23, 26 — ch8-39 Acme/Beta/Staging flagship trace. Addressed.** C8:916–926 (`sec:fh-worked-example`) places `fig:fh-worked-example`, fragment label at `website-v2/public/whitepaper/figures/fig-fh-worked-example.tex:121`. Figure 8.12, PDF **569**, folio **541**. It is a worked incident, not evidence that a production federation handled that incident.

59. **Review p. 18 — unified state-machine circles/double-circle terminals and short edges/guard legend. Addressed policy; blanket geometry Optional.** `skills/tikz-diagram-craft/references/figure-standard.md:79–89,123–126` states the shared grammar and explicitly allows rounded rectangles for named lifecycle phases. Do not force UML lifecycle boxes into automata notation merely for uniformity. This pass establishes convention and named placements, not figure-by-figure visual QA.

60. **Review p. 18 — ledgers as buckets/pipes with a conserved equation. Addressed.** Figure standard:127–129; C7:1450–1463 and its placed ledger provide the actual transition accounting. A pipeline or payoff plot is not a ledger and need not use bucket shapes. No global restyle is justified by the old screenshot summary.

61. **Review p. 18 — dashed trust boundaries, explicit escapes, unified security geometry. Addressed policy / semantic caution.** Figure standard:130–131; C1:2211–2285 distinguishes advisory, brokered and actual isolation; C3's fork names the escape. A dashed boundary does not itself establish Dolev–Yao powers or OS confinement. Keep trust-boundary labels explicit and avoid treating a grouping panel as a security perimeter.

### Chapter-specific tactical recommendations

62. **Review pp. 20–21, 24 — delegation chain conflates authorization with task lineage. Addressed.** C1:996–1019 separates authorization chain from coordination/task lineage and names the signed-field caveat. A word-for-word rename to the review's preferred “task lineage” is optional because the existing term is defined. Preserve the distinction between a proposed signed lineage field and a shipped implementation.

63. **Review pp. 21, 24, 28 — same-UID bypass makes OP-9 essential, not an optional nice-to-have. Addressed as a prerequisite; implementation remains Open.** C1:2267–2278 and 2326–2374 (`sec:enforcement-gap`, `sec:merkle`) explain capability removal and lack of shipped isolation. C1:2988–2994 explicitly makes OP-9 a precondition for Confined claims. Do not “close” it by stronger prose, or equate cgroups alone with denying filesystem/credential access.

64. **Review pp. 21, 24 — “verified code is running code” overstates Kani; 32-byte mocked parser. Partial; real bound drift found.** C2:677–704 (`sec:implementation`) withdraws the old headline and gives the correct scope; 837 and 1709–1726 separate parser/no-panic, two-vector subset check and source branch inspection. But C2:541 and the listing use ten unwindings while **`core/harbor-card-rs/src/lib.rs:620–637` uses `#[kani::unwind(128)]`**. Minimum fix: update the bound and abridged listing, or identify ten as historical. The decoder stub at Rust:599–604 returns 32 zero bytes or error; at Rust:525–535 those cannot parse as valid header/claims JSON. Explain rejection-only coverage from those stubs, not token length alone. Keep crypto, acceptance, arbitrary depth, constant-time binary behavior and FFI outside the proof claim. Do not claim a symbolic model proves deployed Ed25519 implementation correctness.

65. **Review p. 21 — revocation log GC/TTL retention missing. Addressed design, not shipped.** C2:366–397 (`def:revocation-truncation`; PDF 128/folio 100) gives expiry-based truncation, live-card comparison and the rate/window limitation. Modest clarification: require non-reused card identifiers, trusted expiry/clock-skew policy and the maximum validity of every affected descendant before deletion; say this compacts the serving revocation state, not necessarily the audit history or a witness log. A time window alone is not an absolute memory cap at unbounded issue rate.

66. **Review pp. 3, 21–22, 24–25 — dual-attested key-release ceremony absent. Addressed.** C3:291–306; `website-v2/public/whitepaper/figures/fig-sealed-dual-attestation.tex:41–88` names hardware root, guest init/attester, verifier and the two relying-party appraisals/releases. Figure 3.3, PDF **176**, folio **148**. Do not turn two appraisals into one shared approval or claim the diagram validates attestation deployment.

67. **Review p. 22 — timing-channel literature and bucketed batch release. Partial; neutralization overstates.** C3:1048–1070 (`sec:sealed-budget`) cites predictive mitigation and counts `log2(s)` timing choices; 1093–1103 (`tab:sealed-not-promised`) explicitly leaves timing/physical channels open. Minimum fix: specify whether the bucket count, deadline/timeout, termination signal, job count and other observable releases are fixed and included. Coarse buckets bound declared resolution; they do not neutralize every timing channel or make leakage zero. A real-valued mathematical duration is not automatically an infinite-capacity physical measured channel without a noise/resolution model.

68. **Review pp. 22, 25 — distinguish oversight regret, successor continuation and candidate fit. Addressed.** C4:2008–2055 (`tab:ls-three-losses`) now gives inputs, objectives, units and consumers. Table 4.9, PDF **262**, folio **234**. No additional taxonomy is needed.

69. **Review pp. 22, 25 — r1-floor.csv uncommitted; add empirical overlay. Addressed availability / Reject empirical relabeling.** Both `whitepaper/figures/r1-floor.csv` and `whitepaper/figures/data/r1-floor.csv` are tracked. `whitepaper/figures/legible-swarm-readpoverty.tex:62–75` plots computed points and explicitly says they evaluate the same closed form, **not independent observations**. Figure 4.10, PDF **252**, folio **224**. Keep that truthful caption. The distinct miss-probability experiment at C4:1735–1744 is not a measurement of a bits-to-locate floor; do not overlay unlike quantities to satisfy the review.

70. **Review pp. 3, 22 — operational resurrection state machine, validated lineage and liabilities. Addressed model; implementation remains bounded.** C5:1617–1651 (`thm:resurrection-soundness`, `fig:stp-resurrection-soundness`) names the three guards and shortest counterexamples. Figure 5.7, PDF **342**, folio **314**. It is a depth-7/747-state check, not a complete operational provider migration. Optional: one explicit arrow to the semantic capsule section for readers seeking imported notes; do not claim escrow is safely reattached before closure/renegotiation.

71. **Review p. 22 — compare daemon-attested identity with stake/deposit Sybil resistance. Addressed.** C5:801–821 (`sec:identity` context) distinguishes cost of minting from principal binding and states the trusted-local-authority trade. Keep principal aggregation conditional on that binding: a ledger that assumes principals are correctly identified cannot establish that real-world principal identification has been solved.

72. **Review pp. 25, 29–30 — promote agent-death taxonomy; do not imply notes recover latent state. Addressed with overstatement to trim.** C5:978–1016 (`tab:death-ladder`; Table 5.4, PDF **324**, folio **296**) promotes the taxonomy. But “latent state … out of reach in principle” at 1003 is too universal: an exposed same-model/runtime cache can be serializable. Minimum fix: “unavailable through the assumed provider interface; no provider-independent latent-state restoration guarantee.” Keep notes/task capsules, execution snapshots and hidden state distinct, and do not promise subjective continuity.

73. **Review pp. 23, 25 — consolidate ground deontic grammar. Addressed.** C6:754–786 (`def:lc-fragment`) supplies facts, definite Horn, integrity constraints, O/F tokens, exclusive intervals and a separate difference-constraint system. It is more complete than the review's one-line proposed grammar, which drops important dimensions. Keep it; apply only row 34's output-size qualification.

74. **Review p. 23 — use pairwise correlation and k_eff=k/(1+(k−1)rho) in assurance. Reject as a failure-probability theorem; useful replacement already exists.** C6:2668–2727 (`sec:assurance-correlation`, `eq:assurance-beta`; PDF **439**, folio **411**) uses a beta common-latent model with numerical sensitivity. Pairwise correlation alone does not determine the probability all reviewers miss; calculation E gives two pairwise-independent counterexamples. Minimum fixes: explicitly say reviewers are conditionally independent Bernoulli(D) given D; qualify “correlation cannot help” to that positive-mixture model; label theta as uncalibrated. The effective-sample-size variance formula cannot be substituted as an exponent without proof.

75. **Review pp. 23, 25–26 — raw TLA+ without introductory prose/UML. Addressed.** See row 56: C7:1290 supplies five English rules; 1294–1296 places the state machine before variables at 1298. Keep the code for readers who need the artifact. No new pseudocode layer is required.

76. **Review p. 23 — explain unbondable exfiltration as unbounded loss, require hardware. Mostly addressed / Reject absolutes.** C7:1060–1065 (`tab:threat-bonds`) says disclosure can exceed feasible collateral and points to capability scoping/isolation. That is sufficient and more accurate than saying every secret's economic loss is mathematically unbounded or hardware is the only possible answer. Modest wording: damage valuation and recoverability may be unknown, collateral may be insufficient, and disclosure is not undone by payment. Do not imply Chapter 3 removes its named side-channel assumptions.

77. **Review pp. 24, 29 — separate epidemic gossip from sheaf diffusion; name OP-12. Partial; current conjecture has a false premise.** C8:766 (`sec:fh-sheaf`) clearly disclaims a transfer theorem; C8:1177 (`sec:fh-lim-equiv`; PDF **581**, folio **553**) makes it a falsifiable Open conjecture. But it calls the tree case one “where the gap vanishes.” Connected scalar trees have a positive smallest nonzero Laplacian eigenvalue while their cycle residual is identically zero. Minimum fix: remove that premise, use the positive eigenvalue notation, condition any time-to-alarm hypothesis on an observable nonzero cycle residual and threshold below its signal, and specify gossip fanout/time normalization. A graph diffusion relaxation time cannot alone predict an adversarial log-alarm time. Renaming it globally OP-12 is optional; the existing chapter-local namespace avoids ownership drift.

### Assurance register, open problems, and teaching

78. **Review p. 26 — replace maturity labels with a single five-tier Artifact Assurance Register. Reject ordering; retain the goal.** ROOT:240–253 already distinguishes evidence from maturity; APP:35–70 distinguishes runtime assurance modes. The proposed Tier 1 puts ProVerif and TLC beside unrestricted proof assistants, then Tier 3 lists TLC again; tool names are not proof strengths. Minimum useful improvement: a per-claim record of claim kind, artifact/bounds, conformance status, runtime maturity and residual assumptions. Do not replace orthogonal axes with a prestige ladder. Also reconcile ROOT:245–247's “in increasing order” with APP:52–54's correct “not totally ordered.”

79. **Review pp. 26–27 — one master open-problem concordance, status synchronized across chapters. Partial.** APP:283–307 (`app:open-concordance`, `tab:op-concordance`; PDF **674**, folio **646**) indexes the three namespaces, but only groups C5/C8 themes rather than listing every question with its label/status. Minimum fix: turn the concordance into links to each owning question/result, preserving local IDs; do not renumber or imply the grouped table is exhaustive. Optional to put it specifically in Appendix C; current location is not a correctness issue.

80. **Review p. 27 — OP-1 stays Open; formalize fairness through TTL expiry/network delay. Addressed status / Open research.** C1:2912 and 2929–2935 (`tab:op-status`, `sec:openproblems`), with ticket-lock discussion at 863–904, already exclude the lazy-sweep path from closure. Minimum addition if needed: state the arrival/service and eventual-sweep assumptions for any claimed bounded wait. Do not claim FIFO alone supplies a wall-clock guarantee during partitions.

81. **Review p. 27 — OP-2 should be Closed. Addressed.** C1:2913,2936–2943 mark it Closed and cite `thm:decidability` and `thm:regimentation-controllability`. Preserve the formal-model/complete-mediation and observation scope from row 18; closure is not all real-world policies becoming decidable.

82. **Review p. 27 — OP-3 differential runtime fuzzing or explicit verification debt. Addressed disclosure; implementation Unresolved/Open.** C1:2107–2130 and 2944–2948 explicitly say the million-operation differential harness does not run today and even when built would be a test, not a proof. No need to implement a fuzzer for this editorial reconciliation. Do not upgrade BuiltWeak from the design alone.

83. **Review pp. 27–28 — split OP-4a lineage replay Closed from OP-4b neural restoration Open. Split addressed; reject Closed.** C1:2915–2916 and 2954–2965 split the IDs but correctly keep both Open: replay is Designed, not shipped. C5:1001 also says semantic capsules are specified. Retain those statuses; the review mistakes tractability/specification for completion.

84. **Review pp. 27–28 — OP-5 Partial because the audit tower closes oracle completeness for panels. Reject.** C1:1718–1721 and 2966–2970 distinguish oracle expressiveness from incentives to use a supplied oracle honestly; APP:304 repeats it. C5:2378–2383 still assumes an honest root and measured detection. The tower cannot prove all task acceptance criteria are complete. Keep OP-5 Open; fix C5's conflicting headline via row 33.

85. **Review p. 28 — OP-6 read-path tamper evidence should stay Open and become information-flow tracking. Addressed status; proposed reclassification Optional/overbroad.** C1:2918,2971–2973 and `sec:merkle` distinguish audit-chain verification from just storing hashes. Integrity verification and confidentiality/flow tracking are different properties. Minimum fix: name exactly which reads verify which root/checkpoint and what freshness is assumed, rather than changing the problem into all information flow.

86. **Review p. 28 — OP-7 Partial; design a monotonic user_version “consensus sequencer.” Addressed status / Reject unnecessary consensus framing.** C1:448–475,2919,2974–2978 says ordered boot ledger BuiltWeak and sequencer Designed. A one-writer local migration order does not need inter-node consensus; the real requirement is deterministic ordering/version compatibility and restart safety. Keep Partial until those are implemented and checked.

87. **Review p. 28 — OP-8 decay-rate calibration under bursty workloads. Addressed/Open.** C1:979–988 and 2920,2979–2980 (`fig:swk-marker-decay`, `sec:openproblems`) explicitly distinguish an exponential formula from empirical calibration. A bursty-workload sweep is reasonable optional research, not existing evidence or a replacement proof. State the coordination objective before fitting a decay rate.

88. **Review p. 28 — OP-9 high-priority co-tenant isolation. Addressed prerequisite; Open.** See row 63, especially C1:2988–2994. No safe editorial path closes the missing separate-user boundary. A namespace or cgroup name alone is not the complete confinement contract.

89. **Review pp. 28–29 — OP-10 selective FULL durability on settlement writes. Partial/Open.** C1:659–669 and 2995–3000 specify a checkpoint-selector design, while `thm:consistency` at 2063 refers to `synchronous=FULL`. Minimum fix: distinguish those two mechanisms and require successful sync/checkpoint completion **before acknowledgement**, with handling of busy/error and actual filesystem durability assumptions. A PRAGMA is not a property of an individual table. Do not claim the default NORMAL path is power-loss durable or that a prose change implements the selector.

90. **Review p. 29 — OP-11 Closed after wrapping multi-organ writes in a transaction. Reject closure; small engineering task remains.** C1:2923,3001–3004 (`sec:atomicity`, `tab:op-status`) says the default API still permits partial failure. Existence of a Float Plan transaction in C6 does not establish all claim/bus/escrow compound operations use one. Keep Open until implementation and injected mid-step failure tests establish the compound atomicity; no runtime action authorized here.

91. **Review p. 29 — proposed OP-12 discrete-Hodge/gossip convergence bound. Addressed as an Open topic; repair before formalizing.** C8:766,1177 and APP:306 already track the exact gap. See row 77. Do not add a numbered conjecture with the false tree-gap premise just to match the review's suggested numbering.

92. **Review p. 29 — four semester-course routes. Addressed routes; semester packaging Optional.** ROOT:255–287 (`tab:course-paths`) lists exactly Security 1/2/3/8; Economics 5/6/7; Human Supervision 1/4/7; Formal Methods 1/2/7/8. Table 1, PDF **10**, folio **x**. These are chapter paths, not week-by-week curricula. A syllabus with prerequisites and exercise load can be supplied separately without expanding frontmatter.

93. **Review pp. 29–30 — promote succession breakdown threshold and death taxonomy out of solutions. Addressed.** C4:982–1014 promotes `D*=eta K/(1−eta K)` with `eta K<1` and always-on-versus-active-only failure scope, cross-referencing `he:thm:succession-price`; C6:506 places `fig:he-succession-price` (Figure 6.1, PDF **394**, folio **366**). The death ladder is row 72. Preserve the exercises as derivation practice; promotion does not require deleting solutions.

94. **Review p. 30 — bibliography/source reliability of the review itself. Unresolved citations; reject borrowed authority.** Review reference 2 is blank, 9 is `unknown_url`, and 10 is a secondary summary; several substantive suggestions have no original source attached. The report's corrections therefore use current labeled claims and primary sources rather than treating those citation numbers as evidence. C8's original Hansen–Ghrist/Jiang entries are at 1520–1528; C7's Holmström/Kandori–Matsushima entries at 2002–2015. Keep exact source titles, and do not adopt the review's incorrect Hodge/monitoring terminology on citation count alone.

## Small mathematical checks supporting the dispositions

### A. Heavy-tail comparison: the unscaled service term matters

Take the source's approximation itself, not a claim about real fleet traces. Normalize `mu_pool=1`, choose `c=2`, `rho=1/2`, so `lambda=1`, Erlang-C `C=1/3`, and `A=0`. For service SCV giving `kappa=(1+cs²)/2`:

```
W_pool ≈ 1 + kappa/3
W_solo = 1/s + kappa/[s(s−1)],  s=mu_spec/mu_pool > 1
```

At `kappa=1`, equality is `s=1.75`. At `kappa=3`, the same `s` gives `W_solo=2.857142857` versus `W_pool=2`; equality moves to **s=2**. Replacing `A=0` by `A/kappa=0` cannot produce that change. A safe replacement is the explicit inequality

```
1/mu_spec + lambda(1+cs_spec²)/(2 mu_spec(mu_spec−lambda))
  <= 1/mu_pool + kappa_pool C(c,rho)/(c mu_pool−lambda)
     + A/(w lambda).
```

The specialist side is exact M/G/1 with finite second moment; the pooled side is the named approximation. Correlated arrivals require further assumptions; do not silently apply the Poisson expression to them.

### B. Capped probation: feasibility and participation are separate

For `t=0..T`, positive `delta_f<delta_h<1`, feasibility is
`Gmax <= L(1−delta_f^(T+1))/(1−delta_f)`.
Writing `x_t=delta_f^t g_t`, minimize `sum (delta_h/delta_f)^t x_t` subject to `sum x_t>=Gmax` and `0<=x_t<=delta_f^t L`. The coefficients are strictly increasing: fill earliest capacities, possibly one partial period. The optimizer remains unique. The `T=0,L=1,Gmax=1.5,delta_f=.5` case is infeasible even though `Gmax < L/(1−delta_f)=2`.

A lifetime participation condition is not a liquidity floor. For `pi=(1,10)`, `u=1`, `delta_h=.9`, `g=(1,0)`, lifetime net earnings are `9`, exceeding the outside option `1.9`; nevertheless first-period net earnings are `0<u`. A per-period floor must be added as a new constraint before deriving a per-period holdback ceiling. This is why the review's concern is real but its capital interpretation is not already the theorem's instrument.

### C. Trade probabilities are not surplus fractions

For independent uniform `v,c∈[0,M]`, let `a=M/4` and `z=v−c`.

```
P(0<z<a) = integral_0^a (M−z)/M² dz = 7/32.
P(z>0) = 1/2; therefore P(rejected | efficient) = 7/16.
E[z 1(0<z<a)] = integral_0^a z(M−z)/M² dz = 5M/192.
E[z_+] = M/6; lost expected surplus fraction = 5/32.
```

These are properties of the illustrated equilibrium/distribution, not a numerical corollary applying to every Myerson–Satterthwaite mechanism.

### D. Residual support, ranking, and mixing are different claims

On a unit n-cycle, the cycle projection of a single unit edge offset has equal signed magnitude `1/n` on all cycle edges; its norm is `1/sqrt(n)`. It identifies a cycle inconsistency, not the offending endpoint or a unique highest edge. Generally, `2||eta|| < max_i |r_i|` preserves an above-noise signal, but to preserve the ordering of entries i and j one needs a margin such as `||r_i|−|r_j|| > 2||eta||`. An arbitrarily close pair can swap under a perturbation much smaller than the maximum entry.

For the three-vertex path, the ordinary Laplacian eigenvalues are `{0,1,3}`. Its positive spectral gap is **1**, yet its cycle space is zero and all edge offsets are gradient-explainable. Thus zero detection on a tree does not follow from a zero diffusion gap. Visible-cycle support and signal amplitude must enter any detection-time conjecture.

### E. Pairwise correlation does not fix all-miss probability

Let a bit 1 mean detection. A distribution uniform on `{000,011,101,110}` has per-reviewer detection `d=1/2` and pairwise correlation zero, yet `P(all miss)=1/4`. Uniform on `{111,100,010,001}` has the **same** marginals and correlations but `P(all miss)=0`. Independent reviewers give `1/8`. Therefore `k_eff=k` at zero pairwise correlation cannot justify the review's proposed all-miss exponent. The Book's common-beta model is a valid explicitly stronger assumption; its `d=.8,theta=.5,k=3` value `.088` and `k=5` value `.059136` are algebraically consistent, not measured panel performance.

## Page-by-page coverage of the review PDF

| Review PDF page | Numbered rows covering substantive content |
|---|---|
| 1 | 1–2 (including snapshot, audience, evidence and overbroad endorsement) |
| 2 | 3–8 |
| 3 | 9–13, 18, 35–36, 47, 49, 51–54, 66 |
| 4 | 8, 14–17, 56–58, 93 |
| 5 | 16–20 |
| 6 | 20–22 |
| 7 | 22–26 |
| 8 | 25–29 |
| 9 | 29–30 |
| 10 | 17–19, 31–32 |
| 11 | 20–22, 25–26, 33–34 |
| 12 | 28–29, 31, 34–35 |
| 13 | 35–42 |
| 14 | 42–46 |
| 15 | 18, 35–37, 40–43, 46 |
| 16 | 40, 43–49 |
| 17 | 24, 49–56 |
| 18 | 49–50, 56–61 |
| 19 | 50–52, 54 |
| 20 | 55–58, 62 |
| 21 | 11, 62–66 |
| 22 | 12, 66–71 |
| 23 | 58, 73–76 |
| 24 | 62–64, 66, 77 |
| 25 | 56, 68–69, 72–73, 75 |
| 26 | 58, 75, 78–79 |
| 27 | 79–84 |
| 28 | 63, 83–89 |
| 29 | 72, 89–93 |
| 30 | 72, 93–94 |

## Handoff limits

- The source is already substantially revised relative to this review. “Missing” diagrams, key explanatory boxes, course routes and duplicate-exhibit repairs must not be re-created.
- The specific figure placements above are witnessed by current aux/PDF destinations, not inferred from source-file existence. This pass did not visually approve every figure or rerun geometry audits.
- Current source and PDF were sampled for agreement on critical sections; this is not a byte-for-byte proof that every dirty source line is in the 705-page PDF. The PDF hash pins the rendered witness; source line references pin the inspected working copy and can shift with others' edits.
- Existing claims of runtime behaviour, formal tool runs and experiment counts were not re-executed. Where a claim depends on that evidence, the report names the limitation instead of silently turning a manuscript assertion into new validation.
- No new mathematical model, consensus protocol, confinement implementation, FX mechanism, or empirical dataset was authorized or produced. Proposed modest fixes above are for the manuscript owners to consider.

