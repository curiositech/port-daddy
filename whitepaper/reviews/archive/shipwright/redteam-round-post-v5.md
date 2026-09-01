# Red-team round: against PR #246 (harbor envelope) + PR #247 (attenuation v5)

**Round:** post-v5 adversarial
**Targets:** `lib/harbor-envelope.ts` + `lib/spawner.ts` (PR #246); the v5 single-hop
attenuation proof + whitepaper §"Offline Attenuation" (PR #247).
**Discipline:** every finding carries a concrete probe (target → tool → expected
observation → impact). No theatrical findings.

---

## RT-03 — Multi-hop escalation: the single-hop proof doesn't cover the multi-hop claim *(RESOLVED this round)*

**Class:** crypto / proofs · **Severity:** high · **Owner:** redteam-crypto

**Probe.**
- *target:* the whitepaper claims Macaroon-style multi-hop delegation, but the v5
  proof (`harbor_card_v5_attenuation.pv`) is single-hop (Daemon→A→Harbor).
- *tool:* ProVerif 2.05.
- *attack:* `harbor_card_v6_multihop_attack.pv` — Daemon issues `cap_write` to A;
  A correctly attenuates to `cap_read` for B; **malicious B re-delegates `cap_write`
  to C**. The natural single-pass verifier checks `is_subset(final, root)` — the
  final cap against the *root* cap — and misses the non-monotonic middle hop.
- *expected:* `Accepted(C, harbor, cap_write)` reachable though B only held `cap_read`.

**Result (mechanized).**
- v6 (naive `final ⊆ root` verifier): `not event(Accepted(c, harbor, cap_write)) is **false**`
  → escalation **accepted**. Attack confirmed.

**Counter (white-hat, same round).** `harbor_card_v7_multihop_fixed.pv` — the verifier
checks **each hop against its immediate parent**: `is_subset(mid, root) ∧ is_subset(final, mid)`
(the Macaroon discipline; the operational meaning of the whitepaper's `att_B ∘ att_A`
recompute).
- v7 (per-hop verifier): `not event(Accepted(c, harbor, cap_write)) is **true**`
  → same chain, same adversary, escalation **blocked**.

**Impact / disposition.** The v5 theorem is correct but its *scope* (single hop)
must be stated; the multi-hop obligation is now discharged by v6 (attack) + v7
(fix). **Action:** the runtime delegation verifier MUST check per-hop, never
final-vs-root. Tracked for #189 (cross-harbor recompute) and the chain verifier.

---

## RT-01 — Harbor envelope is enforced for 1 of 7 dimensions *(OPEN)*

**Class:** coord / authz · **Severity:** high · **Owner:** redteam-coord

**Probe.**
- *target:* `lib/harbor-envelope.ts` declares 7 envelope dimensions (filesystem,
  tools, skills, mcps, backends, channels, budget); ADR-0047 claims advisory→enforced.
- *tool:* `grep` for `assertWithinEnvelope` call sites + the `action.kind` passed.
- *observation:* the only real call site (`lib/spawner.ts:1087`) passes
  `kind: 'backend'`. No code path ever asserts `filesystem`, `tools`, `skills`,
  `mcps`, `channels`, or `budget`. The `/check` route is a dry-run, not a gate.
- *impact:* an agent admitted to a harbor with a restrictive envelope is still
  unconstrained on 6 of 7 dimensions. The envelope reads as enforced; it is 1/7
  enforced. The "advisory → enforced" claim is narrower than stated.

**Disposition.** Real. The pure model + persistence are sound (fail-closed), but
operational adoption is one dimension. **Action (next round, P4b+):** call
`assertWithinEnvelope` at the filesystem-claim, tool-routing, channel-publish, and
spend surfaces — and gate the budget dimension at spawn. Honest caveat added to
ADR-0047 matrix (P4b = remaining call sites).

---

## RT-02 — `PD_HARBOR_ENVELOPE` is advisory self-enforcement, not enforcement *(OPEN)*

**Class:** coord / authz · **Severity:** high · **Owner:** redteam-coord

**Probe.**
- *target:* `lib/spawner.ts` propagates `PD_HARBOR_ENVELOPE` into the child env.
- *tool:* `grep` for any reader of `PD_HARBOR_ENVELOPE` outside the spawner.
- *observation:* **nobody reads it back.** The daemon ships the envelope to the
  child and trusts the child to honor it.
- *impact:* a malicious or buggy child ignores the env var and does whatever its
  process/OS permissions allow. Propagation ≠ enforcement; the security boundary
  must live at the daemon's resource-granting surfaces (port/file-claim grants,
  tool/MCP routing), not in the child's environment.

**Disposition.** Real and important. `PD_HARBOR_ENVELOPE` is legitimate as a
*hint* (lets a cooperating child self-limit) but must not be mistaken for the
boundary. **Action (next round):** the daemon-side gates of RT-01 are the actual
enforcement; the env var is downgraded to "advisory hint" in the docs. Closing
this fully needs syscall-site enforcement (the same O_NOFOLLOW / openat work as
ADR-0047 P4b) plus daemon-mediated resource grants.

---

## Round summary

| Finding | Severity | Status | Artifact |
|---|---|---|---|
| RT-03 multi-hop escalation | high | **resolved** | `harbor_card_v6_multihop_attack.pv` (attack) + `harbor_card_v7_multihop_fixed.pv` (fix), both ProVerif-verified |
| RT-01 1-of-7 dimensions enforced | high | open → next round | grep probe; ADR-0047 P4b |
| RT-02 env-var advisory self-enforcement | high | open → next round | grep probe |

Honest posture: the proof side is now strong through 2 hops; the *code* side
enforces one dimension via one call site and one transport that the child can
ignore. The gap between "envelope exists and is fail-closed" and "envelope is
enforced everywhere it must be" is named, not hidden.
