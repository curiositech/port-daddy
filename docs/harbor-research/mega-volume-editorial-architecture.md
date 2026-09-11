# Editorial architecture for the seven-paper volume

## The book's claim

**Autonomy scales only when authority, evidence, and consequence remain coupled
at every effect boundary.**

The thing being governed is not an agent, a model, a prompt, or a chat session.
Those are replaceable workers and interfaces. The durable object is an
authorized work unit: a bounded grant from a named principal, a sequence of
fenced effects, an evidence record, and one terminal settlement. The seven
papers explain what that object must preserve as work crosses successively
harder boundaries.

The book should change how a practitioner thinks about agentic development in
2026. The usual question, "Which model should I trust?", is too weak. The useful
questions are:

1. What may this process change?
2. Which effect boundary can actually stop it?
3. What evidence survives if the process disappears?
4. Which principal owns the action, the cost, and the remedy?
5. What can another machine verify without inheriting local authority?

## The seven propositions

### I. Legibility is a budget, not a mood

A human cannot supervise a swarm through summaries that erase the evidence the
human would need to challenge them. Chapter I establishes information floors,
separate readers and therefore separate digest heads, calibrated attention, and
zoom paths back to the artifact. It answers: **what must remain visible?**

Research home: R1--R4, R14, R16.

### II. Observation becomes authority only at the effect boundary

Logs do not prevent a write. Chapter II places one local writer between plans
and durable effects, then distinguishes what can be rejected before commit from
what can only be detected and priced afterward. It answers: **where can a rule
be made real?**

Research home: R5 and the local work-unit invariants of R8.

### III. Accountability requires continuity, not metaphysics

Processes die, models change, and adapters are replaced. Chapter III attaches
memory, outcomes, sanctions, and open obligations to a durable identity and its
principal without pretending the software is a human person. It answers:
**what remains the same long enough to owe or receive anything?**

Research home: R12, R13, and the executed probation-cliff result.

### IV. Exchange is safe only when value, evidence, and identity meet once

A market built on disposable processes invites whitewashing, ambiguous custody,
and settlement by assertion. Chapter IV separates bounty, provider bond,
insurer reserve, and fees; binds settlement to named evidence; and states the
economic conditions under which audit and specialization pay. It answers:
**what makes cooperation rational without making loss unbounded?**

Research home: R7, R13--R15, plus the conservation corrections recorded in the
research handoff.

### V. Delegated authority must only narrow

Identity does not imply permission, and permission does not justify an effect.
Chapter V makes every delegation edge explicit, key-bound, attenuating,
expiring, and revocable. It answers: **how may authority travel without silently
growing?**

Research home: the Anchor ProVerif/Kani results, with R5 defining which policy
claims can be enforced at all.

### VI. Evidence becomes an institution only when it can trigger a bounded remedy

Attribution without consequence is a diary; punishment without admissible
evidence is arbitrary. Chapter VI composes capability bounds, witnessed history,
audits, conflict detection, appeals, and conserved settlement. It answers:
**who may decide, on what evidence, and with what bounded consequence?**

Research home: R7, R10, R11, R15, R17, and the R8 state machine.

### VII. Federation relays evidence, not sovereignty

Two machines with different operators do not acquire a shared ruler merely by
exchanging events. Chapter VII keeps admission and effects local, uses the relay
for outbound event federation rather than database replication, and scopes
equivocation detection to the evidence and topology actually visible. It
answers: **what can cross a trust boundary without moving the authority itself?**

Research home: R6 and CR-1/2/3. Runtime boundary: ADR-0049 Relay v0, outbound
HTTPS/SSE, harbor-scoped event streams, no daemon state replication.

## The argument chain

The chapter order is causal:

- Chapter I defines what the operator must be able to see.
- Chapter II identifies the local point at which visible intent can become, or
  fail to become, a durable effect.
- Chapter III supplies the continuity needed to attribute that effect after a
  process ends.
- Chapter IV gives attributed work an economic meaning.
- Chapter V supplies the narrowing authority that any such work must present.
- Chapter VI turns authority, evidence, and settlement into one local
  institution.
- Chapter VII states exactly which records and capabilities may cross to another
  institution, and what no cross-machine protocol can infer from missing data.

No chapter is a layer diagram in prose. Each is one answer to the same question:
what must remain coupled when another source of uncertainty is introduced?

## Book-level claim hygiene

Every durable result receives a stable ID in
`mega-volume-epistemic-manifest.yaml`. The book may shorten a result, but it may
not change its epistemic kind or omit its failure boundary.

- `proved`: a mathematical proof with named assumptions.
- `verified-framework`: an imported theorem or framework whose application is
  shown here.
- `model-checked`: the stated finite model and bound were exhaustively checked.
- `empirical`: the named script, seed, and sample produced the number.
- `designed`: a concrete mechanism exists on paper but not as an enforced
  runtime path.
- `running`: the code path is exercised in the current implementation.

Numbers from closed form or established theory are marked `[verified]`. Numbers
from the repository's scripts are marked `[internal, script, seed 20260816]`.
A finite model result is never promoted to an unbounded runtime guarantee. A
cryptographic commitment proves what was signed, not that the signed claim
describes reality. A relay can route and authenticate an envelope without being
trusted to interpret its payload or decide a local effect.

## Exposition rule for every chapter

The collected volume adds a short opening and handoff around each independently
readable paper.

The opening must name:

1. the practical failure the chapter resolves;
2. the precise question the chapter answers;
3. the result IDs whose evidence governs the chapter's strongest claims.

The handoff must name:

1. what the next chapter may now assume;
2. what this chapter deliberately did not solve;
3. the next uncertainty introduced by the book.

Color is reserved for navigation, status, and semantic contrast. It never
substitutes for hierarchy. Boxes are reserved for theorems, protocols, and
worked examples; ordinary argument remains ordinary prose.

## Material excluded from this edition

Editorial plates, jackets, and chapter art remain in the repository but are not
part of the assembled research edition. Speculative expansion sketches are not
allowed to interrupt the seven-part argument. They may return only after they
have a result ID, a factual status, and a place in the argument chain above.
