# Dialogue: Anchor capability attenuation — soundness round

**Round:** attenuation-soundness
**Class:** crypto / proofs
**Lead:** secops:lead
**Status:** sealed — counter landed and mechanized in ProVerif 2.05

This round answers one carried-over smell: the central attenuation proof was
vacuous. The fix is mechanized and lands with this round.

---

## Exchanges

### Smell #ATTN-01 — `is_subset` is reflexive-only; the attenuation proof is vacuous

**Class:** crypto / proofs
**Severity:** high
**Section:** Anchor §"Offline Attenuation"; `analyses/harbor_card_v3_delegation.pv`;
embedded listing in `anchor-protocol-whitepaper.tex`.

**Probe (proof-gap-auditor / redteam-crypto):** The model defines the capability
order as

```
reduc forall c1: capability; is_subset(c1, c1) = true.
```

This is reflexive only. Capabilities are opaque atoms with no order, so a
delegated capability can only ever *equal* its parent. The whitepaper claims the
subset check "ensures capability attenuation — delegated capabilities can only be
restricted, never expanded," but the model **cannot express expansion at all**.
The no-escalation query holds vacuously: there is no larger capability to
delegate, so the proof says nothing about the protocol. *The model cannot witness
escalation.*

**Counter (defense-crypto + proof-completer):** Enrich the model; do not weaken
the claim. `analyses/harbor_card_v5_attenuation.pv`:

1. **Real order.** `cap_read ⊏ cap_write`, both public, so the Dolev–Yao
   attacker and an escalating insider can construct either.
2. **Sound `is_subset`.** Reflexive + `is_subset(cap_read, cap_write)`;
   `is_subset(cap_write, cap_read)` is *not* derivable, so an escalating
   delegation fails the verifier's guard instead of passing trivially.
3. **Insider escalation adversary** (`MaliciousA`): holds a valid `cap_read`
   root token and signs an over-broad `cap_write` delegation with no
   self-restraint. The Harbor verifier's `is_subset` guard is the sole defense.
4. **Falsifiable queries.**
   - Q1 (soundness): `Accepted(b, harbor, cap_write, cap_read) ==> false`.
   - Q2 (non-vacuity): `EscalationAttempted(a, r, s) ==> false` — a `false`
     here is *desired*: it proves the escalation is reachable.

**Mechanized result (ProVerif 2.05, `analyses/harbor_card_v5_results.txt`):**

| Query | Result | Meaning |
|---|---|---|
| Q1 soundness | `not event(Accepted(.., cap_write, cap_read)) is true` | escalation never accepted |
| Q2 non-vacuity | `not event(EscalationAttempted(..)) is false` | escalation IS reachable (not vacuous) |
| Negative control (guard deleted) | Q1 flips to `false` with trace | the `is_subset` guard is load-bearing |

The negative control is the key rigor step: deleting the verifier's
`is_subset(sub_cap, root_cap)` line makes ProVerif exhibit the read→write
escalation trace. So Q1's `true` is a property of the *guard*, not of the model's
inability to express the attack.

**Status:** sealed. Whitepaper §"Offline Attenuation" now carries
Theorem (attenuation soundness, mechanized) and the soundness subsection; the v3
listing is captioned as the reflexive-order model with a forward reference.

**Carried forward (next round):**
- Multi-hop attenuation (chains of depth > 1) — v5 proves single-hop. A
  three-level lattice + a delegation-chain adversary is the next obligation.
- Wire the lattice to the runtime: `lib/harbor-envelope.ts` `assessEnvelope`
  enforces the same order operationally (ADR-0047); the cross-harbor transfer
  (#189) must recompute `att_B ∘ att_A` from the bound envelope rather than
  trust an intermediate claim — that is the federated analogue of this proof.
