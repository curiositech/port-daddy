# Paper 8: The Cohomology of Agent Evidence

**Typed cellular sheaves, relative extension, and fault observability**

## Research question

Given authenticated observations from several roles in one workflow, which inconsistencies can an auditor prove, and which remain indistinguishable from a compatible account? A useful answer needs declared feature maps, an observation boundary, and an independent truth source. Topology alone cannot identify a dishonest agent or establish that completed work happened.

## Mathematical model

A two-dimensional cellular sheaf assigns a typed vector space to each role, handoff, and three-party contract. Incidence maps specify which feature a role exposes to an overlap and which edge features a face compares. The maps must compose: for coboundaries $A=\delta_0$ and $B=\delta_1$, $BA=0$. Each packet is tied to a work item, schema, source identity, event-log watermark, and evidence reference before it enters the complex.

With published inner products, an observed edge cochain has an orthogonal split

$$y=Ax+B^*z+h,\qquad h\in H^1(K;\mathcal F).$$

The face syndrome $By$ detects a violated declared face relation. A nonzero harmonic class $h$ is a closed, nonexact inconsistency around an unfilled contract loop. The exact component $Ax$ is compatible with a vertex assignment, even if that assignment is jointly false. These channels describe cochain patterns; they are not one-to-one labels for semantic failures.

## Exact heterogeneous fixture

Four roles each have a completion-count and handoff-count coordinate. Two edges expose completion count, two expose handoff count, and one exposes both. A filled triangle compares completion counts; the handoff triangle is initially unfilled. Exact rational arithmetic gives $(\dim H^0,\dim H^1,\dim H^2)=(4,1,0)$. A count-face injection has face energy $3$ and harmonic energy $0$; a handoff-loop injection has face energy $0$ and harmonic energy $3$. A compatible gradient has zero energy in both channels.

Declaring the handoff face changes the handoff class from harmonic to face-coexact and makes $H^1=0$. With identical edge observations, the total compatibility residual and detection decisions are unchanged. A new face receipt contributes information only if independently acquired; the direct-contract baseline receives the same receipt.

For partial visibility, the connecting map $H^0(L)\to H^1(K,L)$ tests whether a visible compatible section can extend through hidden contracts. In the fixture, equal visible completion counts but unequal endpoint handoffs have a nonzero relative class. A zero class proves model-compatible extension exists, while leaving unseen evidence and truth unresolved.

## Fault observability and score

Count support by edge packets, including all coordinates within a typed edge stalk. The sheaf edge-group distance

$$d_{\mathcal F}=\min_{Ax\ne0}|\{e:(Ax)_e\ne0\}|$$

is the smallest packet support of a nonzero compatible report. Every error on at most $k$ packets is detectable exactly when $d_{\mathcal F}>k$; every such error is uniquely recoverable modulo a compatible account exactly when $d_{\mathcal F}>2k$. The restricted projection gain $\alpha_{2k}$ gives a noise-stability bound $2\epsilon/\alpha_{2k}$ when positive. The fixture has $d_{\mathcal F}=2$: all single-packet errors are detectable, but arbitrary single-packet correction can alias.

For a predeclared finite library of agentic fault interventions, use the full projected signature vector and report its degeneracy classes and minimum pairwise separation. Distinct labels are identifiable only if their signatures differ under the actual acquisition contract. An external ledger anchor is required to separate coherent false reports from valid work. A scalar residual magnitude cannot support a one-to-one semantic diagnosis.

## Reproduction and field test

Run `python3 -B scripts/sheaf_2complex_study.py --format markdown` and `python3 -B -m unittest tests/test_sheaf_2complex_study.py -v` from the repository root. The script builds the typed incidence maps, checks $BA=0$, computes exact cohomology and Hodge components, measures edge-group distance, and tests the relative extension class. Its values are synthetic, not agent-failure rates.

The graph specialization is reproduced by `python3 -B scripts/sheaf_observability_study.py --format markdown`. When endpoint claims are available, direct repeated-claim equality detects every cycle inconsistency and may detect more. A field trial must therefore give metadata validation, direct contract checks, and sheaf analysis the same authenticated inputs, then compare detection, explanation quality, cost, and false alarms against independently verified event truth. Broad utility remains an open empirical question.

The core mathematics has substantial precedent in [cellular sheaf theory](https://arxiv.org/abs/1303.3255), [spectral cellular sheaves](https://arxiv.org/abs/1808.01513), [Hodge ranking](https://arxiv.org/abs/0811.1067), and [multi-agent sheaf coordination](https://arxiv.org/abs/2504.02049). The research contribution to test is a provenance-bound evidence contract and an observability audit with an equal-information baseline.
