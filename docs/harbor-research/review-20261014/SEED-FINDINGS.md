# Seed findings — imported coordinator audit, not independent verdicts

Source: operator-supplied 416-spread PDF, SHA-256 `846eb740242558abecec96ddf52e0e306dadd3aa5d77c44c5f9d8e9807276884` (recomputed in this task). These are the 26 initial findings from the preceding chat review, restated as work items on 2026-10-14. No earlier Git history is implied. Exact PDF-to-source revision correspondence is unknown. Re-locate every anchor in current source before proposing a patch. Status of every item below: **open, independent acceptance outstanding**.

| ID | Priority / anchor | Initial finding | Acceptance obligation |
|---|---|---|---|
| F001 | P1; Ch0 pp10–11 / Ch1 pp76–77 | Intro makes API mediation sound universally unbypassable although Ch1 permits same-user host effects beside it | Align architectural contract, implemented scope and every retelling |
| F002 | P1; Ch0 p48, Thm0.3.1 | Positive sampling temperature does not establish a uniform unsafe-action hazard; safe-only stochastic policy is a counterexample | State uniform conditional hazard over surviving histories; derive survival bound by chain rule; distinguish finite from asymptotic risk |
| F003 | P1; Ch0 p48, Eqs0.29–0.30 | Written nucleus set can be empty at top mass0.9 and p0.8; softmax permits T0 despite division | Smallest sorted prefix reaching p, stable tie handling, renormalization and separate greedy case; boundary tests |
| F004 | P1; Ch0 p52 | HyperTree author/title/venue differs from located primary record | Establish intended source then repair metadata and each methodological attribution together |
| F005 | P1; Ch0 p52 | TDAG expanded as Topological Task DAG Execution rather than located Task Decomposition and Agent Generation | Resolve source identity and distinguish paper method from the book's scheduling analogy |
| F006 | P1; Ch0 p53 | FormalJudge metadata and blanket verification claims differ from located record | Verify full primary text, translation/specification assumptions, and attributed guarantee |
| F007 | P1; Ch0 p60 | Six Sigma attribution describes deterministic handoff gates while located paper centers repeated sampling/consensus | Verify intended source and label the book's adaptation; do not substitute the nearest title blindly |
| F008 | P1; Ch0 pp49,54–55 | Quantitative context and progressive-disclosure claims lack the stated experiment/source bindings | Trace each number, measurement population and token accounting; otherwise label a constructed example |
| F009 | P1; Ch0 pp38–41 | Social-choice/decision language risks exporting theorem conclusions beyond assumptions | Audit alternatives, preference domain, welfare rule and stochastic-agent interpretation |
| F010 | P1; Ch0 pp59–60 | Conway as absolute mathematical force and broadcast as inevitable failure overstate a design argument | Identify counterexamples and retain conditional topology/cost claims |
| F011 | P1; Ch1 p87 Fig1.4 | Recovery label says uncommitted WAL frames replay into main DB | Correct against SQLite's committed recovery/checkpoint semantics; re-render final figure |
| F012 | P1; Ch1 p86 | wal_checkpoint(FULL) and synchronous=FULL are conflated in a proposed per-path durability contract | Specify acknowledgment, busy/failure, crash and flush conditions; distinguish design from shipped code |
| F013 | P1; Ch2 p177 Fig2.4 | All-hop pk_daemon label conflicts with issuer-signed delegated cards | Separate root verification from correctly bound parent issuer signatures; semantic and image review |
| F014 | P1; Ch0/Ch2 delegation | Strict-subset language and macaroon analogy can contradict equal-scope attenuation/signed-card construction | Align order, lifetime, issuer-binding and cryptographic primitive throughout |
| F015 | P1; Ch0 pp12–13 / Ch3 pp274–275 | Any-side-channel canary prose outruns explicitly excluded channels and uncalibrated detectors | Inherit the finite model, detection assumptions, missing calibration and out-of-model channels |
| F016 | P1; Ch4 pp300–301 | Conflict-free reviewers do not imply independent errors | Preserve shared-source counterexample; require actual instance/evidence provenance and calibrated dependence claims |
| F017 | P2; Ch5 pp392–395 | Engineering continuity/person terminology may read as settled philosophical personal identity | Separate operational definition, cited positions, normative choices and conditional arguments |
| F018 | P1; Ch6 pp482–492 | Economic summaries may omit detection, custody, neutral-grading and cross-operator conditions | Carry conditions into diagrams/summaries; implementation status remains explicit |
| F019 | P1; Ch7 pp598–599 | Single-writer ledger does not establish perfect timely public monitoring | Bind signaling-game assumptions to actual observation model; private/delayed views stay separate |
| F020 | P1; Ch8 pp660–671 | Residual-vs-pairwise advantage needs an equal-observable-information baseline | Give comparators the same authenticated reports; retain restricted theorem separately from benchmark claims |
| F021 | P2; Ch8 p661 Fig8.7 | Red disagreeing-edge label extends into neighboring path panel | Correct final placement; no overlap, tiny replacement text or hidden edge |
| F022 | P1; Ch8 p662 Landmark11 | Nonzero holonomy reveals fraud overstates model incompatibility as intent/blame | Align plate caption with detection, localization, attribution and noise assumptions |
| F023 | P2; Ch0 p22 | Small gray governor exists but blue-object teaching vocabulary lacks visibility/coverage | Page-level art dispositions and purposeful blue-ink objects; do not claim literal absence |
| F024 | P1; frontmatter / part breaks | COPY REVIEW NOTES ONLY, NOT FOR PUBLICATION dossiers appear in supplied public-shaped volume | Build-mode gate and regression check; preserve dossiers in editorial artifact |
| F025 | P2; pp802–807 | Concordance/ownership tables/image credits are not analytical subject/name index | Build real index with see/see-also, ranges and cross-checks after final pagination |
| F026 | P1; reader guide / exposition skill / atlas | verified/internal labels have inconsistent evidence semantics | Reconcile canonical taxonomy and every display/legend without silently upgrading evidence |

## Primary leads, not automatic replacements

- HyperTree: https://proceedings.mlr.press/v267/gui25b.html
- TDAG: https://arxiv.org/abs/2402.10178
- FormalJudge: https://arxiv.org/abs/2602.11136
- Six Sigma: https://arxiv.org/abs/2601.22290
- Nucleus sampling: https://openreview.net/forum?id=rygGQyrFvH
- SQLite: https://sqlite.org/wal.html ; https://sqlite.org/c3ref/wal_checkpoint_v2.html ; https://sqlite.org/pragma.html#pragma_synchronous

## Located source anchors

`whitepaper/chapter-0-prerequisites.tex` contains the temperature/top-p claim, context degradation, TDAG/HyperTree/FormalJudge passages and later dependency claims. `whitepaper/figures/pd-swiss-evidence.tex` contains the literal `replays uncommitted` figure label; a public mirror also exists. Locate the canonical generator before synchronizing generated copies. The existing epistemic manifest and chapter-owned definitions are reconciliation inputs, not assumed correct by fiat. Inspect figures in rendered pages, not extracted text alone.
