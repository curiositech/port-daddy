# Dialogue: Bonded Commons v2.1 → v2.2

**Round:** v2.2 (first standard round after bootstrap)
**Sealed at:** 2026-05-02
**Lead:** secops:lead
**Status:** complete; two cited-but-unmodeled proof obligations now have
runnable artifacts.

This is the first round under the standard cadence. v2.1 staged counters
for thirteen smells and carried four proof gaps; v2.2 closes two of them
with real, repro-able formal-methods artifacts.

---

## Closed this round

### Proof gap #06 — Passkey device-pairing (Bonded §7.4)

**Class:** crypto + recovery
**Severity:** high
**Carried from:** v2.1

**Counter:** ProVerif model `proofs/bonded/pairing/passkey-pair.pv`.

The model encodes the pairing flow: established device U holds the user's
passkey private key; new device N generates an ephemeral keypair and
broadcasts its pubkey + a fresh nonce over a one-shot QR channel; U
signs the nonce-pubkey assertion with the passkey private key and
returns it via the WebSocket; N verifies and accepts the pairing.

The Dolev-Yao adversary controls the WebSocket transport but not the QR
channel. (The QR-as-public threat model is explicitly out of scope per
§7.4 — addressed by the §7 recovery story instead.)

Three properties verified TRUE:

```
RESULT not attacker(passkey_priv[]) is true.
RESULT inj-event(NewDevicePaired(x, k)) ==> inj-event(UserScannedQR(x, k)) is true.
RESULT not attacker(pairing_secret[]) is true.
```

(P1) The passkey private key never leaks even after a successful
pairing exchange.
(P2) Every successful pairing was preceded by U scanning a QR with the
specific new device's pubkey. There is no WebSocket-only path to a
successful pairing.
(P3) Replaying old WebSocket traffic does not yield a new pairing
secret — the binding to a fresh nonce holds.

**Artifact:** `proofs/bonded/pairing/passkey-pair.pv` (84 LOC) plus
`passkey-pair.run.log` (deterministic trace from `proverif`).

---

### Proof gap #04 — Conservation Theorem (Bonded §7.x)

**Class:** mechanism
**Severity:** load-bearing (asserted in §7 prose without a model)
**Carried from:** v2.1

**Counter:** TLA+ specification
`proofs/bonded/conservation/Conservation.tla` with model-checker
configuration `Conservation.cfg`.

The spec encodes six legitimate operations on the bond ledger: Mint
(authorized external top-up), Stake (Free → Escrowed within an agent),
Refund (Escrowed → Free), Slash (Escrowed → Burned, the abstract
counterparty), PartialSlash (split between Burned and Refund), and
Payout (Escrowed of A → Free of B).

Conservation invariant:

```
Conservation == TotalFree + TotalEscrow + burned = minted
```

In words: nothing appears or disappears between operations except via
Mint (in) and slash-to-Burned (recorded), with Free + Escrow holding
the rest.

TLC ran a complete state-space search at the bounded model (3 agents,
MaxBalance = 3, MaxMint = 6):

```
Model checking completed. No error has been found.
26818 states generated, 1716 distinct states found, 0 states left on queue.
The depth of the complete state graph search is 9.
```

Both `Conservation` and `NoNegative` (no negative balances anywhere)
hold across the full bounded space. The model deliberately captures
the operations the §7 prose claims preserve conservation; if a future
operation is added (new advisor patterns, cross-currency moves), it
must be added to `Next` and re-checked.

**Artifact:** `proofs/bonded/conservation/Conservation.tla` (137 LOC)
plus `Conservation.cfg` and `Conservation.run.log`.

---

## Still carried into v2.3

| # | Theorem                                       | Reason              |
|---|-----------------------------------------------|---------------------|
| 2 | No-Overdraft Lemma (§7.x)                    | Kani harness on `lib/bonds.ts:escrow()` not yet written; TLA+ spec gives us a structural argument but a Kani harness would close the SQLite-isolation appeal. Scheduled v2.3. |
| 3 | Merkle Forest binding (§4.2)                 | Scope already narrowed in v2.1 paper text; full EasyCrypt mechanization deferred. |
| 5 | Federated Security Theorem (§7)              | ProVerif planned across the four-principal split; scheduled v2.3. |
| 7 | Pareto dominance (§8.4.4)                    | Depends on Youle's pending formal proof — external; track and integrate when landed. |

---

## Paper changes in v2.2

- §7.4 Passkey device-pairing: replace "we conjecture" with explicit
  citation to `proofs/bonded/pairing/passkey-pair.pv` and the three
  ProVerif properties; add an out-of-scope note for QR-channel
  compromise pointing at §7 recovery.
- §7.x Conservation: replace the prose-only argument with reference to
  the TLA+ spec; add the bounded-model parameters as a footnote.
- §A.3 Mechanization gaps: update closed/carried table.

---

## Reputation deltas at round close

| Persona              | Delta                                                            |
|----------------------|------------------------------------------------------------------|
| proof-completer      | +2 closed gaps (high impact: passkey + Conservation)             |
| defense-crypto       | +1 co-signed (passkey)                                           |
| defense-recovery     | +1 co-signed (passkey)                                           |
| secops:lead          | +baseline (round closed cleanly with two real artifacts)         |

No bonds slashed this round.
