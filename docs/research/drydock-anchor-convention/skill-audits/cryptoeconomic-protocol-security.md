# Skill audit — `cryptoeconomic-protocol-security`

**Disposition:** replace in place. The prior bundle is not a safe basis for settlement or agent-labor design.

## Steelman

The old skill correctly demanded adversarial review of bonds, griefing, oracle conflicts, Sybil identities, and ordering leakage. It also usefully distinguished structural, economic, and social defenses and warned that reputation alone is weak.

## P0 findings

1. **Closed false taxonomy.** “Every bonded agent system is vulnerable to exactly these five categories” is unsupported. It omits custody, liquidity/run risk, collusion, bribery, dispute capture, reputation laundering, settlement finality, cross-domain replay, governance capture, and legal/externality boundaries.
2. **Invented repository truth.** The Float Plan example states that task locking, timeouts, identity cost, requester authority, and manifest visibility have specific live properties without an exact repository anchor or evidence class.
3. **Numbers as theater.** It requires numerical bond and attack-cost estimates even when neither loss distribution nor attacker utility is observable, encouraging fabricated precision.
4. **Bond-centric security.** It implicitly treats collateral and slashing as default protection despite irrational griefers, unbounded damage, correlated failure, limited liability, unverifiable outcomes, and participation exclusion.
5. **Oracle independence by count.** Quorum or random selection is presented as defense without testing common control, collusion, shared evidence, capture cost, or appeals.

## P1 findings

- No closed input/output schema, semantic validator, mutation corpus, or executable conservation checks.
- No control-disjoint settlement handoff or distinction between effect authority and economic adjudication.
- No `UNKNOWN` value state; every quantity appears knowable.
- No explicit no-settlement profile.
- No legal, tax, employment, custody, or moral-status hold boundary.
- No typed evidence admissibility or durable `UNSETTLED` terminal.
- Front-running advice assumes commit-reveal or privacy solves metadata and ordering channels.
- Social defenses lack privacy, discrimination, lock-in, and newcomer-exclusion analysis.

## Replacement requirements

- open threat-family registry rather than “exactly five”;
- attack scenarios with attacker utility, bounded/unknown quantities, control domains, and evidence;
- native-unit conservation and explicit no-settlement profile;
- structural, economic, social, procedural, and accepted-risk responses;
- witness-class and adjudication conflict analysis;
- Sybil and collusion independence distinguished;
- timing, ordering, metadata, custody, liquidity, liveness, and dispute surfaces;
- residual risk and falsifier per defense;
- static truth boundary and no authority to set prices, bonds, custody, payment, or legal status;
- executable closed record and at least twelve adversarial mutations.

## Research corrections

- Douceur's original Sybil result makes the trusted-identity assumption explicit; identity multiplicity cannot be dismissed with a cheap per-ID heuristic.
- *Flash Boys 2.0* demonstrates that ordering dependence creates extractable value and system-level risk; “front-running” is not merely public plan copying.
- Ethereum slashing is behavior-specific and correlation-sensitive; it is not evidence that arbitrary work-quality slashing is sound.
- Incomplete-contract research treats remedies and renegotiation as responses to unverifiable contingencies, not proof that all contingencies can be priced ex ante.
- Proper scoring rules apply under explicit outcome and utility assumptions; they do not automatically make peer adjudication collusion-resistant.

Primary sources are recorded in the replacement skill's source ledger.
