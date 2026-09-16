# Worked Exemplar — R7, The Inspection Tower (moves annotated)

Load when unsure how a move should *feel*. Annotations in ⟨angle brackets⟩ are meta-commentary, not part of the piece.

---

⟨RAIL A — express lane: the Move-2 sentence + pointer, placed first, written last⟩
*Express lane: Deterrence holds iff audit-probability × detection × bond ≥ corrupt gain, and stacking auditors sampled from C independent cliques makes bribery collapse geometrically with finite total bond — see the box.*

⟨MOVE 1 — the scene: pain first, zero jargon, present tense, ≤4 sentences⟩
**The scene.** A marketplace where AI judges grade AI work, posting a bond that is slashed if they cheat. A judge can take a bribe: pass shoddy work, pocket G. So you audit the judges — but auditors can be bribed too, and now it looks like watchers all the way up, each level dearer than the last. Does the tower ever stop?

⟨MOVE 2 — one breath: single italic sentence, condition included because the condition is the point⟩
**The idea in one breath.** *Honesty holds when expected punishment beats the bribe — and the tower of auditors converges, because each level has geometrically less corruption left to protect, provided judges are drawn from enough independent camps that no single deal buys them all.*

⟨MOVE 3 — structural analogy: relations map (expected penalty ≥ gain; disjoint pools multiply bribe cost); symbols bound to scene referents at first use; ends with the misread⟩
**Intuition.** Traffic enforcement doesn't post an officer on every corner; it makes expected fine × odds of being caught exceed the minutes saved. That is the stage game: gain G, audit probability ρ, detection d, slashable bond B. The tower adds jury selection from disjoint pools: if each auditing layer is drawn sealed from C rival benches, a briber must pay all C to be safe — worthwhile only for enormous corruption, which then bleeds value paying for its own protection. ⟨relation-map figure here: base = traffic fines/jury pools; target = ρ,d,B,G,C; arrows = "expected penalty ≥ gain", "disjoint pools multiply bribe cost"⟩ Misread to preempt: you might think this needs infinitely many honest auditors — it doesn't; it needs *diversity* (C > 1) and finite bond, because what each level protects shrinks.

⟨MOVE 4 — the box: self-contained; every symbol defined inside or bound above; quotable cold⟩
> **Stage.** Deterrence iff ρ·d·B ≥ G; critical committed audit rate ρ* = G/(dB) (Becker). Confiscation variant (capture also forfeits the gain): ρ*_c = G/(d(G+B)). Mixed NE of the simultaneous game: ρ* = G/(dB), q* = a/(dL), with a the audit cost and L the auditor's loss from an uncaught cheat.
> **Tower.** Level k+1 audits level-k auditors, sampled sealed from C disjoint cliques; an auditor's bribe floor is its expected forfeiture β = ρdB. Bribery is all-or-nothing and profitable iff G_k > C·B; otherwise corrupt value decays geometrically, G_{k+1} = (1−ρd)·G_k. Finite bond capital certifies unbounded depth.
> **Amortization.** With reputation-at-stake v·t, incentive-compatible declining audit schedules spend Θ(log T) (loss-only-if-audited: ρ_t = G/(d(B+vt))) or O(1) = aG²/(2dBrv) (cheats also surface at independent rate r: ρ_t = max(0,(G−rvt)/(dB))), versus Θ(T) flat.

⟨MOVE 5 — numbers by hand, from the actual session, then FADE with answer in parentheses⟩
**Numbers by hand.** G=10, d=0.8, B=50 ⇒ ρ* = 10/(0.8·50) = **0.25** [verified] — audit one grade in four and cheating's payoff is exactly zero. *Now you try:* double the bond to B=100 — what's ρ*? (0.125 — a bigger bond lets you audit half as often.)

⟨MOVE 6 — what it buys: named application, no vague "implications"⟩
**What it buys.** Converts the volume's central open conjecture (III.11.1) into a parameterized theorem; it is Paper 3's core. It also fuses two external reviews into one machine: model heterogeneity supplies the C cliques; VRF honeypots implement the sealed random audit at rate ρ*. Simulation: C=1 keeps corruption on linear life support (400→390→380…); C=8 makes bribery uneconomical from level 1, collapsing at 0.8^k [internal, b2_tower.py, seed 20260816].

⟨MOVE 7 — honest boundary: conventions that change the number; measured-not-proven assumptions; regime figure⟩
**The honest boundary.** ρ* depends on the payoff convention — state whether your settlement rule confiscates the gain. The tower needs an exogenously honest root and *sealed* sampling: a briber who learns the draw beats the clique math. Detection d and cross-clique collusion correlation are measured quantities, not assumptions. Whether amortization is Θ(log T) or O(1) turns on an empirical fact — do cheats surface without audits? — that deployment telemetry must answer. ⟨regime diagram here: (C, G_k) plane; bribery-profitable region G_k > C·B shaded red; geometric-decay region shaded green⟩

---

⟨DONE-TESTS, as run⟩
Expert test: express lane + box, read alone, fully state the result — pass. Novice test: "audit often enough that expected slash beats the bribe; diverse judge pools make buying the whole chain uneconomical" — pass. Two figures in grammar — pass. Numbers tagged [verified]/[internal] — pass. Boundary includes "does NOT" content (sealed sampling required; convention-dependence) — pass.
