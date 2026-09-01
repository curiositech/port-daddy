# Skills — flag 1

## Primary

**`game-theoretic-agent-incentives`** — the load-bearing one. Its equilibrium-
proof quality gate is exactly the standard this dive holds both papers to:

> An equilibrium proof is complete ONLY when it specifies: (1) the strategy
> profile, (2) deviation analysis for *each* player against *every* alternative
> strategy, (3) the exact parameter ranges under which the equilibrium holds.

Apply that gate to Theorem 2 as if reviewing it hostile. In particular the
skill's collusion failure mode — "Individual deviation analysis misses this
because no single agent is deviating" — is the precise hazard here: Theorem 2's
briber is a coalition-former, and the affine-in-$c$ argument needs to survive
being read as a coalition deviation rather than a unilateral one.

The skill's Sybil failure mode also bears on Q7: if judge identities are cheap
to create, the $C$ disjoint pools can be manufactured by one party, and $C$
counts nominal rather than real independence.

## Secondary

**`falsification-first`** — the program's own house method: sweep, then prove,
then mutation-test. The right posture for this dive is to try to break Theorem 2
first and only then to check whether the literature already broke it. If you can
construct a counterexample yourself, the literature question becomes secondary.

**`harbor-exposition`** — needed only at the end, and only if the verdict is
CLEAR or NARROW, for drafting the citation sentence in the paper's voice. Its
rule that the boundary gets the same prominence as the claim applies to how the
new sentence is written: if the dive narrows Theorem 2's scope, the narrowing
belongs in the theorem's own boundary section, not buried in Related Work.

## Not applicable

`port-daddy-expository-writer` — that is Round 2B (accessible definitions for a
general audience), a separate work item. This dive produces a referee-facing
comparison, not exposition.
