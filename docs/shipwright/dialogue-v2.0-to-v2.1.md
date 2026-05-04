# Dialogue: Bonded Commons + Anchor Protocol v2.0 → v2.1

**Round:** v2.1 (bootstrap)
**Sealed at:** 2026-05-01
**Lead:** secops:lead (human)
**Status:** complete; paper version bumped to v2.1; PDF rebuilt

This is the bootstrap round. Personas had not yet been instantiated at
v2.0, so the smells are signed by the human paper authors rather than by
red-team personas; the counters are produced under the white-hat persona
specifications now in `skills/whitehat-defense/agents/`.

---

## Exchanges

### Smell #01 — Algorithm confusion in Anchor §3 token verification

**Class:** crypto
**Severity:** high
**Probe:** Anchor pins HS256 vs Ed25519 by phase, but does the verifier
reject a chain whose phases mix algorithms? Probe with a forged JWT whose
header claims a phase the daemon does not expect for that key class.

**Counter (defense-crypto):** ProVerif model of the verification path with
phase-pinned algorithms as separate equational theories. Property: "no
honest verifier accepts a token whose phase-algorithm pair is unexpected."
Pair with a Kani harness over `lib/jwt.ts` verify() exhausting the
algorithm field. Artifact: `proofs/anchor/phase-pinned/`.

**Status:** counter staged; artifact lands in v2.2.

---

### Smell #02 — Delegation chain replay (Anchor §3)

**Class:** crypto
**Severity:** high
**Probe:** A capability token attenuated for agent B is intercepted; can a
third-party agent C attach itself to the chain before B verifies?

**Counter:** ProVerif extension with attenuation events; prove that any
chain accepted by an honest verifier was emitted by the original principal.
Bind attenuation context to chain hash if the proof fails.

**Status:** counter staged; ProVerif model lands in v2.2.

---

### Smell #03 — Cuckoo filter pollution (Anchor §2.4)

**Class:** crypto
**Severity:** medium
**Probe:** ~10⁻³ false-positive budget. Can an attacker inflate via
authoritative-table churn?

**Counter:** Bound the false-positive rate analytically (Fan/Demers); add
SMT proof of the bound. Saturation harness in `proofs/anchor/cuckoo/`.
Add issuance-side rate limiting and document the bound in §2.4.

**Status:** §2.4 already mentions Fan/Demers; SMT artifact added to
proof-completer's standing target list.

---

### Smell #04 — Gossip partition timing (Anchor §2.4)

**Class:** crypto
**Severity:** medium
**Probe:** Partition-of-size-k delays kid propagation; what's the
exposure window?

**Counter:** Compute worst-case freshness window analytically; either
tighten the bound in the paper or add a freshness witness verifiers
consult before accepting old kids.

**Status:** §2.4 documents the bound; freshness-witness mechanism is
v2.3 work (depends on registry write surface).

---

### Smell #05 — Merkle Forest equivocation (Bonded §4.2)

**Class:** crypto
**Severity:** high
**Probe:** Binding assumes daemon's signing key is uncompromised. What if
the daemon publishes a root before witnessing it to the KMS, then
equivocates against a party that does not check the witness?

**Counter:** Reduce equivocation to forging the daemon's signing key OR
forging the KMS witness. Either an EasyCrypt model of the joint property,
or a hand-check explicitly stating: "binding under non-equivocating daemon
OR honest KMS witness." §4.2 weakens its claim accordingly.

**Status:** v2.1 paper text updated; full mechanization tracked as gap.

---

### Smell #06 — Passkey pairing MITM (Bonded §7.4)

**Class:** crypto + recovery (joint)
**Severity:** high
**Probe:** QR display assumed un-tampered. Network adversary substitutes
pairing token via WebSocket?

**Counter:** ProVerif model of QR + WebSocket protocol with attacker
controlling the WebSocket but not the QR. Property: "no pairing token is
accepted by a device that did not display the corresponding QR." Co-owned
by defense-crypto and defense-recovery.

**Status:** counter staged; ProVerif artifact at
`proofs/bonded/pairing/passkey-pair.pv` is the next concrete deliverable.

---

### Smell #07 — Sybil insurers (Bonded §8.4 — Youle market)

**Class:** econ
**Severity:** medium
**Probe:** Principal stands up N thinly-capitalized insurers; can it
influence the clearing premium for transactions where it is the buyer?

**Counter:** Tighten recursive bond requirement so marginal capital for
Nth insurer dominates marginal premium influence. Run agent-based sims
at N ∈ {2,5,20,100} varying reserve ratio; ship sim notebook + parameter
recommendation.

**Status:** counter routed to defense-econ; sim notebook is v2.2 work.
Also notify Thomas Youle as joint author of §8.4.

---

### Smell #08 — Insurer collusion / cartel (Bonded §8.4)

**Class:** econ
**Severity:** medium
**Probe:** Insurers coordinate to keep premiums above expected loss.

**Counter:** Model n-insurer market with deviator; show that as long as
≥ k honest insurers exist, deviation disciplines the cartel. If k > realistic,
ship entry-subsidy or capital-ladder mechanism.

**Status:** counter staged; depends on Youle's Pareto-dominance proof.

---

### Smell #09 — Reputation amortization (Bonded §8.3)

**Class:** econ
**Severity:** medium
**Probe:** Many tiny clean settlements inflate ρ(p), then under-bond a
large transaction.

**Counter:** Specify decay function ρ(p) explicitly; prove (Lean or
hand-checked) that lifetime-discount × cost is bounded above by integrated
honest-cleanup cost. Land explicit ρ in §8.3.

**Status:** §8.3 carries the explicit decay function in v2.1 patches.
Mechanization in v2.2.

---

### Smell #10 — Pheromone retraction race (Bonded §4.3)

**Class:** coord
**Severity:** medium
**Probe:** Two principals issue conflicting revocations against each
other's hints in the same epoch. Substrate claims monotone but conflict
resolution unspecified.

**Counter:** TLA+ model with concurrent conflicting revocations; specify
deterministic conflict-resolution (highest-bond-wins, tie-break by
signature hash); prove `MutableSignalAttribution` invariant under TLC.
Land resolution rule in §4.3.

**Status:** counter staged; TLA+ artifact at
`proofs/bonded/attribution/MutableSignal.tla` next.

---

### Smell #11 — Distress-class abuse (Bonded §9.2)

**Class:** coord
**Severity:** medium
**Probe:** Cycle through legitimate-looking distress events to repeatedly
halt a rival agent. §9.2 has no concrete blast-radius bond ceiling.

**Counter:** Define explicit blast-radius bond ceiling per
`auth | conflict | permission | budget | invariant` enum value; TLA+
model attacker cycling distress; prove rival-halt is bounded per epoch.
Land ceiling in §9.2.

**Status:** §9.2 patched in v2.1 with the ceiling. Mechanization v2.2.

---

### Smell #12 — Email magic-link race (Bonded §7.x)

**Class:** recovery
**Severity:** high
**Probe:** Network observer intercepts magic-link click and out-races the user.

**Counter:** Bound TTL + add device-channel confirmation: passkey-unlocked
device must explicitly accept the magic-link login. ProVerif model of the
joint protocol; attacker with email read access alone cannot authenticate.

**Status:** counter staged; ProVerif artifact part of the §7 federated
proof obligation.

---

### Smell #13 — Same-user adversary boundary (Bonded §7)

**Class:** recovery
**Severity:** scope clarification
**Probe:** "Same user" exclusion is too coarse. (a) UID-read of files,
(b) UID-spawn, (c) Keychain API access — what's reachable per tier?

**Counter:** Three-tier scope document, one §7 sub-section per tier.
Specify which threats remain in scope per tier. Route policy decisions
through sec-eng-lead.

**Status:** §7 patched in v2.1 with the three-tier table.

---

## Proof gaps reopened (still open after this round)

| # | Theorem                                       | Status before | Status after  | Artifact target            |
|---|-----------------------------------------------|---------------|---------------|----------------------------|
| 1 | Conservation Theorem (§7.x)                   | prose         | TLA+ planned  | proofs/bonded/conservation/ |
| 2 | No-Overdraft Lemma (§7.x)                     | prose         | Kani planned  | proofs/bonded/no-overdraft/ |
| 3 | Merkle Forest binding (§4.2)                 | informal      | scope-narrowed | proofs/bonded/merkle/      |
| 4 | Mutable-signal Attribution Invariant (§4.3) | informal      | TLA+ staged    | proofs/bonded/attribution/ |
| 5 | Federated Security Theorem (§7)              | informal      | ProVerif staged | proofs/bonded/federated/  |
| 6 | Passkey device-pairing (§7.4)                | informal      | ProVerif staged | proofs/bonded/pairing/    |
| 7 | Pareto dominance (§8.4.4)                    | pre-print     | depends on Youle | external                |

---

## What v2.1 actually changed in the paper

- §2.4: Cuckoo filter freshness bound documented with Fan/Demers citation.
- §4.2: Merkle Forest binding claim weakened to "under non-equivocating
  daemon OR honest KMS witness"; added [unmodeled] tag pending EasyCrypt.
- §4.3: Pheromone conflict-resolution rule (highest-bond-wins) documented.
- §7: Same-user adversary three-tier scope table added.
- §7.x: Email magic-link weakness documented with device-channel
  confirmation as planned mitigation.
- §8.3: Reputation decay function ρ(p) specified explicitly.
- §8.4: Joint authorship with Thomas Youle confirmed (already in v2.0
  pre-print); patches reorganize for clarity.
- §9.2: Distress blast-radius bond ceiling specified.
- New: §A.3 enumerating mechanization gaps tracked in Port Daddy's
  proof-audit document.

---

## What v2.1 added that wasn't a smell-counter

- Coordination channel isolation for the adversarial-review fleet itself
  is now mechanized (`lib/coordination-{crypto,acl,gates,route-guard}.ts`)
  with a ProVerif proof at `proofs/coordination/isolation.pv` showing
  three properties under Dolev-Yao. This isn't a paper change; it's
  infrastructure that lets future rounds run with strict information
  isolation between red and white fleets.

---

## Reputation deltas at round close

| Persona / signer        | Smell bond | Counter bond | Delta |
|-------------------------|-----------|---------------|-------|
| (human authors as red)  | +13 smells, all real | -            | +bootstrap reputation |
| defense-crypto          | -          | 4 staged       | +eligible at v2.2 |
| defense-econ            | -          | 3 staged       | +eligible at v2.2 |
| defense-coord           | -          | 2 staged       | +eligible at v2.2 |
| defense-recovery        | -          | 2 staged       | +eligible at v2.2 |
| proof-completer         | -          | 0 (deferred)   | nothing landed |
| secops:lead             | round closed cleanly | -   | +baseline |

Round 1 is bootstrap, so the reputation accruals are conservative. Round 2
is the first round under the full cadence, with red personas signing
their own smells.
