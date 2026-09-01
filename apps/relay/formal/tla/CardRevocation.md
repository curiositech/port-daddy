# CardRevocation — revocation finality under backup/restore

Stateful safety model for harbor-card revocation (the relay revokes by JTI:
`revocations` table + publish-time check). **Revocation finality** — once a card
is revoked, no later publish/handshake using it is accepted, *even if the relay DB
is rolled back from a backup* — is an ordering-sensitive, mutable-state property.

## Why TLA+ here, not ProVerif (and a note on Tamarin)

This is the `proverif-tamarin-protocol-modeling` skill's **Open Problem 2**. Its
decision tree routes replay-after-dismissal / revocation finality / mutable global
state to **Tamarin**, because ProVerif's applied-pi trace is monotonic and cannot
express DB rollback. Tamarin is **not installed** in this environment (no
`tamarin-prover`, no `maude`, not in the default brew taps — a from-source Haskell
build was out of scope). The property is trace-based safety over mutable state, so
it is discharged in **TLA+/TLC**, which models mutable state natively and gives the
same guarantee. If/when Tamarin is available, this should be re-expressed as a
`no_replay_after_dismiss` lemma for cross-tool corroboration.

## Model

`CONSTANTS Rollback, Epoched` toggle the adversary and the mitigation, so one module
yields the baseline, the attack, and the fix:

| `.cfg` | Rollback | Epoched | Expected |
|--------|----------|---------|----------|
| `CardRevocation_baseline.cfg` | FALSE | FALSE | `RevocationFinal` holds |
| `CardRevocation_rollback.cfg` | TRUE  | FALSE | **VIOLATED** (backup-restore re-activates a revoked card) |
| `CardRevocation_epoch.cfg`    | TRUE  | TRUE  | holds (revocation-epoch mitigation) |

- `revoked` is the DB set (can be rolled back); `everRevoked` is ground truth
  (monotonic, survives rollback); `epoch` is an external revocation counter that
  also survives rollback. `RollbackRestore(c)` drops `c` from `revoked` only — the
  ADR-0018 Attack 2 backup-restore.
- **Mitigation (Epoched):** cards carry the epoch they were minted at; `Accept`
  requires `cardEpoch[c] = epoch`. `Revoke` bumps the external epoch (a global
  rotation). A restore resets the DB set but not the epoch, so a restored card's
  epoch is stale and `Accept` is disabled. This trades availability (a revocation
  forces outstanding cards to re-mint) for finality under rollback.
- **Safety:** `RevocationFinal == badAccept = FALSE`, where `badAccept` is set iff a
  card in `everRevoked` is ever accepted.

## Results (TLC v1.8.0, Homebrew OpenJDK)

```
baseline:  Model checking completed. No error has been found.   (13 distinct states)
rollback:  Invariant RevocationFinal is violated.               (backup-restore re-accepts a revoked card)
epoch:     Model checking completed. No error has been found.   (76 distinct states)
```

## Bounding note (skill FM1)

The adversary can loop `Revoke -> Rollback -> Revoke`, each `Revoke` bumping the
epoch. With a finite `MaxEpoch`, unbounded pumping would saturate the counter; once
saturated, `Revoke` can no longer bump it and a card minted at the cap spuriously
matches — an *artifact of the bound*, not a real flaw (an earlier run hit exactly
this). Fix: `MaxRollback` bounds the adversary's rollback budget, so the number of
epoch bumps is `<= |Cards| + MaxRollback`; choosing `MaxEpoch >= |Cards| + MaxRollback`
(here 2 + 2 <= 5) guarantees the epoch never saturates in any reachable state, and
the mitigation verifies cleanly.

## Honest scope

Design-level, bounded/exhaustive (not 1M states). The model proves the *protocol
discipline*: a revocation set treated as authoritative does NOT survive rollback,
but an external monotonic revocation epoch does. The runtime obligation it names:
the relay's revocation epoch (or an equivalent rollback-surviving anchor) must live
outside the rollback-able DB image — otherwise restoring a backup silently
re-activates revoked cards, including a leaked receiver/delegated publish card.
