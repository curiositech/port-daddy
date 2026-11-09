# CardRevocation — revocation finality under backup/restore

Stateful safety model for harbor-card revocation (the relay revokes by JTI:
`revocations` table + publish-time check). **Revocation finality** — once a card
is revoked, no later publish/handshake using it is accepted, *even if the relay DB
is rolled back from a backup* — is an ordering-sensitive, mutable-state property.
A rule that keeps finality by refusing service is not a fix, so the model also
checks **availability**: a database that has applied every revocation refuses no
card that was never revoked.

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

`CONSTANTS Rollback, Epoched, DbEpoched` toggle the adversary and the acceptance
rule, so one module yields the baseline, the attack, the over-strict card-epoch
rule and the dbEpoch rule (`ASSUME ~(Epoched /\ DbEpoched)`: the dbEpoch rule
replaces the card-epoch comparison rather than adding to it):

| `.cfg` | Rollback | Epoched | DbEpoched | Expected |
|--------|----------|---------|-----------|----------|
| `CardRevocation_baseline.cfg` | FALSE | FALSE | FALSE | `RevocationFinal` and `Availability` hold |
| `CardRevocation_rollback.cfg` | TRUE  | FALSE | FALSE | `RevocationFinal` **VIOLATED** (backup-restore re-activates a revoked card) |
| `CardRevocation_epoch.cfg`    | TRUE  | TRUE  | FALSE | `RevocationFinal` holds; `Availability` **VIOLATED** (over-strict control) |
| `CardRevocation_dbepoch.cfg`  | TRUE  | FALSE | TRUE  | `RevocationFinal`, `Availability` and `ReplayRecovers` hold |

- `revoked` is the DB set (can be rolled back); `everRevoked` is ground truth
  (monotonic, survives rollback); `epoch` is an external revocation counter that
  also survives rollback. Together `everRevoked` and `epoch` stand for the external
  revocation log: the JTIs it holds and how many revocations were appended to it.
  `RollbackRestore(c)` drops `c` from `revoked` only — the ADR-0018 Attack 2
  backup-restore.
- **Card-epoch rule (Epoched):** cards carry the epoch they were minted at;
  `Accept` requires `cardEpoch[c] = epoch`. `Revoke` bumps the external epoch (a
  global rotation). A restore resets the DB set but not the epoch, so a restored
  card's epoch is stale and `Accept` is disabled. **The rule is too strong.** A
  card is accepted only in the epoch it was minted in, so after any revocation the
  relay refuses every outstanding card, revoked or not. This configuration is kept
  as the over-strict control: it must keep `RevocationFinal` and must violate
  `Availability`.
- **dbEpoch rule (DbEpoched):** the database image stores `dbEpoch`, the number of
  revocations it has applied, and a restore rolls it back with the rest of the
  image. `Accept` requires `dbEpoch = epoch` (replacing `cardEpoch[c] = epoch`);
  cards carry no epoch for this purpose. `Revoke` advances both counters, so a
  current database stays current and a stale one stays exactly as far behind.
  `Recover` replays the external log into a stale database: afterwards
  `revoked = everRevoked` and `dbEpoch = epoch`.
- **Safety:** `RevocationFinal == badAccept = FALSE`, where `badAccept` is set iff a
  card in `everRevoked` is ever accepted.
- **Availability:** `DbCurrent => \A c \in issued \ everRevoked : CanAccept(c)`.
  `CanAccept(c)` is `Accept(c)`'s guard. `DbCurrent` is `dbEpoch = epoch` under the
  dbEpoch rule (the relay's own record) and `revoked = everRevoked` otherwise (the
  database keeps no record, so the model reads currency from ground truth).
- **One replay suffices:** `ReplayRecovers == DbEpoched => (DbCurrent \/ ENABLED
  (Next /\ DbCurrent'))`. It quotes `Next`, not `Recover`'s guard, so it fails if
  `Recover` is dropped from the spec or stops restoring the epoch.
- **Bound check:** `EpochHeadroom == epoch < MaxEpoch` (see the bounding note).

### Abstraction choices in the dbEpoch configuration

- `dbEpoch` counts applied revocations, while Chapter 8 calls it "the newest epoch
  whose revocations it has applied". The two agree whenever the database is
  current, and the count is the conservative reading for a stale database. A rule
  that stamps the newest epoch on every write lets a stale database look current
  after one new revocation; that variant violates `RevocationFinal` (mutation
  below).
- The restore stays per-card, as in the other configurations, and `dbEpoch` falls
  back by the one revocation the image lost. Any smaller value would do: the
  property depends only on a restored image's epoch being behind the external one,
  and nothing but `Recover` closes that gap.

## Results (TLC 2026.11.06.222357 nightly, OpenJDK 21, `-deadlock`)

```
baseline:  Model checking completed. No error has been found.   (13 distinct states)
rollback:  Invariant RevocationFinal is violated.               (backup-restore re-accepts a revoked card)
epoch:     Invariant Availability is violated.                  (12 traces under -continue; RevocationFinal,
                                                                  EpochHeadroom and TypeOK hold on all 76 states)
dbepoch:   Model checking completed. No error has been found.   (197 distinct states, depth 10)
```

CI pins TLC v1.8.0 and reruns all four (`tla-relay-card-revocation` in
`.github/workflows/proofs.yml`). The epoch configuration runs with `-continue`,
so TLC explores all 76 states instead of stopping at the first `Availability`
counterexample. Under `-continue`, TLC still prints "No error has been found" after
reporting the violations, so CI judges this configuration by the violation lines
and the empty queue, never by that sentence.

The shortest `Availability` counterexample under the card-epoch rule needs no
adversary at all: `Issue(c1)`, `Issue(c2)`, `Revoke(c1)`. The database is current
and `c2` was never revoked, but `cardEpoch[c2] = 0 # epoch = 1`, so `c2` is
refused.

Each new invariant was checked against a deliberately broken copy of the dbEpoch
configuration (local runs, same TLC):

| Mutation | First violated invariant |
|----------|--------------------------|
| `Accept` drops the `dbEpoch = epoch` test | `RevocationFinal` |
| A restore leaves `dbEpoch` unchanged | `RevocationFinal` |
| `Revoke` stamps the newest epoch (`dbEpoch' = epoch'`) | `RevocationFinal` |
| `Recover` restores the epoch but not the revocations | `RevocationFinal` |
| `Accept` also refuses after any restore | `Availability` |
| `Recover` removed from `Next` | `ReplayRecovers` |
| `Recover` leaves `dbEpoch` behind | `ReplayRecovers` |

## Bounding note (skill FM1)

The adversary can loop `Revoke -> Rollback -> Revoke`, each `Revoke` bumping the
epoch. With a finite `MaxEpoch`, unbounded pumping would saturate the counter; once
saturated, `Revoke` can no longer bump it and a card minted at the cap spuriously
matches — an *artifact of the bound*, not a real flaw (an earlier run hit exactly
this). Fix: `MaxRollback` bounds the adversary's rollback budget, so the number of
epoch bumps is `<= |Cards| + MaxRollback`; choosing `MaxEpoch >= |Cards| + MaxRollback`
(here 2 + 2 <= 5) guarantees the epoch never saturates in any reachable state, and
the mitigation verifies cleanly. `Recover` sets `revoked` to `everRevoked`, which
enables no further `Revoke`, so the bound is unchanged under the dbEpoch rule. The
epoch and dbepoch configurations check `EpochHeadroom`, so the claim is now
machine-checked rather than argued.

## Honest scope

Design-level, bounded/exhaustive (not 1M states). The model proves the *protocol
discipline*: a revocation set treated as authoritative does NOT survive rollback;
an external monotonic revocation epoch does, and comparing it with the database's
own epoch keeps finality without refusing cards that were never revoked. The
runtime obligations it names: the revocation epoch (or an equivalent
rollback-surviving anchor) must live outside the rollback-able DB image, the
database must record its own epoch inside that image, and the relay must refuse
until it has replayed the log whenever the two differ. Otherwise restoring a
backup silently re-activates revoked cards, including a leaked receiver/delegated
publish card. Unexpired-card checks and the witness-log roots of Chapter 8 are
outside this model.
