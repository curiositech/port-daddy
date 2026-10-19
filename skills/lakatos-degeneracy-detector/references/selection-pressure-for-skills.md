# Monster-Barring Signals as Evolutionary Selection Pressure on Skills

When the degeneracy detector fires `DEGENERATING_PROGRAMME` or `MONSTER_BARRING_SUSPICION`, that alert is not a diagnostic artifact — it is a fitness signal. The signal feeds directly into three escalating selection-pressure mechanisms: registry demotion, deep review trigger, and version rollback. These mechanisms are the C4 (evolutionary dynamics) layer of the Port Daddy Ledger framework, and RCP-6b is the formal registration of monster-barring detection as the degeneracy fitness criterion within that layer.

## How the Signal Propagates

The degeneracy detector emits a structured alert with `level`, `SCR`, `FEC`, `NCR`, and `PNS` fields (see SKILL.md for definitions). Downstream consumers read these fields to decide which pressure to apply:

**Demotion from registry** fires when `DEGENERATING_PROGRAMME` is sustained across ≥2 consecutive version transitions — meaning the skill's SCR has grown and NCR has stayed below 0.2 for at least two version bumps with no intervening progressive episode. Demotion means the skill's `pairs-with` weight in the Tool2Vec routing graph is penalized by −0.3 (additive log-weight adjustment), and the skill is marked `status: degraded` in the attribution DB (`skill_identity` table, `health_status` field). The skill remains callable but the BM25+Tool2Vec cascade will route around it under load. Demotion reverses when the skill ships a version that achieves NCR > 0.5 over a new eval cohort — i.e., more expansions than contractions.

**Deep review trigger** fires on any single `MONSTER_BARRING_SUSPICION` alert where PNS < 0.3 (≥70% of scope exclusions post-date the failures they exclude). This escalates to a mandatory human-in-the-loop review within 48 hours. The review examines whether the scope exclusion was (a) an undocumented stagnant-programme event with an external cause, (b) a legitimate anticipatory refinement that the PNS causal test misclassified due to eval-log timestamp resolution, or (c) genuine monster-barring. Only case (c) advances the skill toward demotion. The reviewer writes a determination to the skill's `references/health-reviews/` directory; absence of a review file after 48h is treated as unresolved and blocks the skill from version promotion.

**Version rollback** is the sharpest tool. It fires only when `DEGENERATING_PROGRAMME` combines with a secondary signal: an existing eval suite that was passing on version N−1 now fails on version N, AND the failing cases are precisely those covered by the new exclusions (i.e., the exclusions excise previously-passing cases, not just new-test failures). In other words: the version didn't just stop claiming coverage, it actively regressed on previously-demonstrated capabilities. The rollback action pins the routing table to version N−1 until a corrected N+1 ships. This is structurally equivalent to the sagas compensation pattern — the registry acts as the transaction coordinator, the version pin is the compensating transaction.

## RCP-6b in the Port Daddy Ledger

RCP-6b is the Port Daddy Research Claims Portfolio entry that formalizes monster-barring detection as an evolutionary fitness criterion. The Ledger tracks proposed cross-cutting invariants that should hold across operator boundaries in the Harbor federation model. RCP-6b sits alongside:
- **RCP-6**: Variation/inheritance operators (methods as heritable variation units across skill versions)
- **RCP-6a**: Method-level inheritance (decomposition patterns and prompt templates survive skill retirement)

RCP-6b is conceptually downstream of RCP-6: if methods are the unit of inheritance, monster-barring is the degeneracy detector for the *scope contract* that wraps those methods. A skill can evolve healthy methods while simultaneously monster-barring its declared use-contract — RCP-6b catches the second failure mode that RCP-6 and RCP-6a do not address.

In the Ledger's C4 fitness vocabulary: a skill's fitness is its outcome ledger signal (findings validated downstream); RCP-6b asserts that sustained scope contraction without novel-case coverage is sufficient evidence of fitness decay to trigger selection pressure *without waiting for downstream validation failures*. This is an early-warning layer — it fires before the outcome ledger degrades, based purely on the shape of version history.

Status as of the soma-windags graft memo (2026-06-26): **DESIGNED, ZERO CODE**. The detector algorithm is specified in SKILL.md. The selection-pressure pipeline (demotion/deep-review/rollback) described above is the intended downstream wiring; it is not yet implemented in the WinDAGs runtime.

## Key Points

- Demotion requires ≥2 consecutive `DEGENERATING_PROGRAMME` transitions; a single alert triggers deep review, not demotion. The distinction matters because a single scope-narrowing version may be legitimate stagnant-programme behavior.
- PNS < 0.3 is the monster-barring causal test: it checks whether exclusions *precede* failures (legitimate anticipatory scoping) or *follow* them (post-hoc exclusion). This is stronger than FEC > 0.7 alone because FEC measures correlation, not temporal direction.
- Version rollback fires only when exclusions remove previously-passing eval cases — a strictly stricter condition than new-exclusion coverage of prior failures. Rollback is a regression signal, not just a degeneracy signal.
- RCP-6b registers this as a C4 fitness criterion in the Port Daddy Ledger: scope-contract degeneracy is detectable before downstream outcome-ledger failures, enabling proactive selection pressure.
- The rehabilitation path (positive-heuristic roadmap: at least one new eval case in *expanded* territory) is the protocol for reversing both demotion and deep-review blocks.

## See Also

- **SKILL.md § Implementation Pattern** — the full `detect_degeneracy` pseudocode with the four signal thresholds (SCR, NCR, FEC, PNS) that feed into the selection-pressure mechanisms described here.
- **Skill lifecycle registry (workgroup-ai; external to this repository)** — the full side-effect registry for skill mutations; demotion and rollback are additional entries in that inventory that are not yet registered there.
- **`graft-memos-379.md` (soma-windags graft)** — the RCP-6b origin document; see the WinDAGs → Port Daddy graft block for the C4 evolutionary dynamics framing and the distinction between RCP-6, RCP-6a, and RCP-6b.
