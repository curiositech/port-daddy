# Architectural tensions

**Status:** OPEN TENSION REGISTER

A tension preserves two desirable properties that cannot be collapsed into a slogan. It is not a backlog bug and need not disappear.

## GH-T-001 — Persistent commitment versus operator supremacy

**A:** intentions must resist transient distraction.  
**B:** the operator must redirect work immediately.  
**Required property:** preserve prior commitment and provenance while permitting immediate interruption, then explicitly resume, replan, abandon, or supersede.

## GH-T-002 — One program authority versus offline/local-first operation

**A:** one Chartroom authority prevents divergent truth.  
**B:** work must remain fast and recoverable during disconnection.  
**Required property:** immutable local capture and deterministic projections may proceed offline; authoritative mutation and conflict resolution require explicit synchronization/readback semantics.

## GH-T-003 — Durable person versus least-context restoration

**A:** a person should retain commitments and accountability across bodies.  
**B:** privacy, office reassignment, and least privilege require some state not to travel.  
**Required property:** a continuity manifest classifies every item as inherited, revalidated, omitted, unavailable, or unknown.

## GH-T-004 — Fast authorization versus fresh substrate truth

**A:** the hot path should be microsecond-to-low-millisecond.  
**B:** stale entity, policy, budget, grant, or resource state can authorize the wrong effect.  
**Required property:** warm deterministic evaluation over versioned snapshots followed by a short compare-and-swap transaction; no end-to-end latency claim from evaluator-only benchmarks.

## GH-T-005 — Useful stigmergy versus manipulable signals

**A:** weak environmental cues make decentralized discovery fast.  
**B:** signals can be gamed, stale, self-reinforcing, or confused with facts.  
**Required property:** source, evidence, strength, scope, creation time, half-life, dispute state, and a no-signal invariance test.

## GH-T-006 — Hard claims versus abandoned-work recovery

**A:** ownership must not be stolen.  
**B:** dead bodies and unavailable people cannot block work forever.  
**Required property:** leases, liveness evidence, conflict visibility, and an attributable salvage transition rather than silent reassignment.

## GH-T-007 — Complete mediation versus adoption

**A:** authority claims require Harbor-owned spawn, secret non-possession, and mediated effects.  
**B:** ordinary collaborators and existing tools will enter through weaker adapters.  
**Required property:** native and adapter guarantees are visibly different; weaker participation never upgrades itself into a stronger proof claim.

## GH-T-008 — Private trade versus verifiable outcomes

**A:** buyers and skill makers need confidentiality.  
**B:** payment, reputation, and disputes require evidence.  
**Required property:** predeclared data/evidence contracts, selective disclosure or commitments, and an independent settlement oracle.

## GH-T-009 — Automatic policy versus accountable judgment

**A:** routine effects must not wait on a human modal.  
**B:** irreversible or constitutional effects require legible judgment.  
**Required property:** versioned policy, deterministic evidence, explicit escalation class, and inspectable automatic decisions.

## GH-T-010 — Immutable evidence versus privacy correction

**A:** evidence must not be rewritten after an inconvenient outcome.  
**B:** secrets, personal data, and unlawful retention cannot live forever.  
**Required property:** privacy before first persistence, redaction/tombstone commitments where necessary, and preserved auditability of the transformation.

## GH-T-011 — Projection speed versus canonical correctness

**A:** claims, actors, and event history should appear instantly.  
**B:** projections can be stale or rebuild incorrectly.  
**Required property:** sequence/epoch, freshness, source authority, rebuildability, and last-known-state presentation on every projection.

## GH-T-012 — Product coherence versus composable substrate

**A:** Erich needs one magical workplace.  
**B:** applications and third parties need replaceable skills, protocols, actuators, embodiments, and policies.  
**Required property:** Convoy packages a coherent experience over explicit extension seams; the default implementation is not mistaken for the contract.

