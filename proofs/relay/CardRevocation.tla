---------------------------- MODULE CardRevocation ----------------------------
(***************************************************************************)
(* Port Daddy: harbor-card revocation finality under backup/restore.       *)
(*                                                                         *)
(* The relay revokes cards by JTI (revocations table + publish-time check). *)
(* "Revocation finality" is a STATEFUL, ordering-sensitive safety property: *)
(* once a card is revoked, no later publish/handshake using it is accepted, *)
(* even if the relay DB is rolled back from a backup. ProVerif cannot model *)
(* mutable state / rollback (its trace is monotonic), so this is Tamarin's  *)
(* domain (skill: Open Problem 2). Tamarin is not installed here, so the    *)
(* same trace-based safety property is discharged in TLA+/TLC, which models *)
(* mutable state natively. This mechanizes ADR-0018 Attack Vector 2         *)
(* (backup/restore), the card-epoch rule and the dbEpoch rule.             *)
(*                                                                         *)
(* CONSTANTS toggle the adversary and the rule, so one module yields the    *)
(* baseline, the attack (negative control), the over-strict card-epoch      *)
(* rule, and the dbEpoch rule:                                             *)
(*   Rollback=FALSE                    -> baseline: finality holds          *)
(*   Rollback=TRUE                     -> backup-restore attack: VIOLATED   *)
(*   Rollback=TRUE, Epoched=TRUE       -> card-epoch rule: finality holds,  *)
(*                                        Availability VIOLATED             *)
(*   Rollback=TRUE, DbEpoched=TRUE     -> dbEpoch rule: finality and        *)
(*                                        Availability both hold            *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
    Cards,        \* finite set of card identities (JTIs), e.g. {c1, c2}
    MaxEpoch,     \* bound on the external revocation epoch
    MaxRollback,  \* adversary's rollback budget (bounds epoch pumping; see .md)
    Rollback,     \* TRUE = enable the DB backup-restore adversary
    Epoched,      \* TRUE = card-epoch rule: accept requires cardEpoch[c] = epoch
    DbEpoched     \* TRUE = dbEpoch rule: accept requires dbEpoch = epoch

\* The dbEpoch rule replaces the card-epoch comparison; it is not stacked on it.
ASSUME ~(Epoched /\ DbEpoched)

VARIABLES
    issued,       \* SUBSET Cards: cards minted
    revoked,      \* SUBSET Cards: DB revocation set (CAN be rolled back)
    everRevoked,  \* SUBSET Cards: ground truth — monotonic, survives rollback
    epoch,        \* external revocation epoch (monotonic, survives rollback)
    cardEpoch,    \* [Cards -> 0..MaxEpoch]: epoch at which each card was minted
    dbEpoch,      \* DB image: revocations this image has applied (rolled back with it)
    rbUsed,       \* rollbacks performed (bounds Revoke->Rollback->Revoke pumping)
    badAccept     \* TRUE once a once-revoked card is accepted (finality breach)

\* everRevoked and epoch together stand for the external revocation log: the
\* JTIs it holds and the number of revocations appended to it. Neither lives in
\* the database image, so a restore cannot move them. Without DbEpoched the
\* database keeps no epoch of its own, and dbEpoch stays 0.

vars == <<issued, revoked, everRevoked, epoch, cardEpoch, dbEpoch, rbUsed, badAccept>>

TypeOK ==
    /\ issued \subseteq Cards
    /\ revoked \subseteq Cards
    /\ everRevoked \subseteq Cards
    /\ epoch \in 0..MaxEpoch
    /\ cardEpoch \in [Cards -> 0..MaxEpoch]
    /\ dbEpoch \in 0..MaxEpoch
    /\ rbUsed \in 0..MaxRollback
    /\ badAccept \in BOOLEAN

Init ==
    /\ issued = {}
    /\ revoked = {}
    /\ everRevoked = {}
    /\ epoch = 0
    /\ cardEpoch = [c \in Cards |-> 0]
    /\ dbEpoch = 0
    /\ rbUsed = 0
    /\ badAccept = FALSE

\* Daemon mints a card at the current epoch.
Issue(c) ==
    /\ c \notin issued
    /\ issued' = issued \cup {c}
    /\ cardEpoch' = [cardEpoch EXCEPT ![c] = epoch]
    /\ UNCHANGED <<revoked, everRevoked, epoch, dbEpoch, rbUsed, badAccept>>

\* Revoke a card. Records it in both the DB set and the monotonic ground truth,
\* and advances the external revocation epoch (a global rotation). Under
\* DbEpoched the database also counts the revocation it has just applied: a
\* current database stays current, and a stale one stays exactly as far
\* behind, because this write does not supply the entries a restore lost.
Revoke(c) ==
    /\ c \in issued
    /\ c \notin revoked
    /\ revoked' = revoked \cup {c}
    /\ everRevoked' = everRevoked \cup {c}
    /\ epoch' = IF epoch < MaxEpoch THEN epoch + 1 ELSE epoch
    /\ dbEpoch' = IF DbEpoched THEN dbEpoch + 1 ELSE dbEpoch
    /\ UNCHANGED <<issued, cardEpoch, rbUsed, badAccept>>

\* The relay's acceptance test at publish/handshake, as a state predicate so
\* that Availability can quote it. The card must not be in the DB revocation
\* set; under Epoched its own epoch must be current; under DbEpoched the
\* database's epoch must be current instead, and the card carries no epoch for
\* this purpose.
CanAccept(c) ==
    /\ c \in issued
    /\ c \notin revoked
    /\ (Epoched => cardEpoch[c] = epoch)
    /\ (DbEpoched => dbEpoch = epoch)

\* If a card that was EVER revoked is accepted, finality is breached.
Accept(c) ==
    /\ CanAccept(c)
    /\ badAccept' = (badAccept \/ (c \in everRevoked))
    /\ UNCHANGED <<issued, revoked, everRevoked, epoch, cardEpoch, dbEpoch, rbUsed>>

\* The backup-restore adversary (ADR-0018 Attack 2): a restore drops a revocation
\* from the DB set. Ground truth (everRevoked) and the external epoch survive.
\* Under DbEpoched, dbEpoch is part of the restored image, so it falls back by
\* the one revocation the image lost. Any smaller value would do: what matters
\* is that a restored image's epoch is behind the external one.
RollbackRestore(c) ==
    /\ Rollback
    /\ rbUsed < MaxRollback
    /\ c \in revoked
    /\ revoked' = revoked \ {c}
    /\ dbEpoch' = IF DbEpoched THEN dbEpoch - 1 ELSE dbEpoch
    /\ rbUsed' = rbUsed + 1
    /\ UNCHANGED <<issued, everRevoked, epoch, cardEpoch, badAccept>>

\* dbEpoch rule only: replay the external revocation log into a stale database.
\* Afterwards the image holds every logged revocation and records the log's
\* newest epoch.
CanRecover == DbEpoched /\ dbEpoch < epoch

Recover ==
    /\ CanRecover
    /\ revoked' = everRevoked
    /\ dbEpoch' = epoch
    /\ UNCHANGED <<issued, everRevoked, epoch, cardEpoch, rbUsed, badAccept>>

Next ==
    \/ \E c \in Cards : Issue(c)
    \/ \E c \in Cards : Revoke(c)
    \/ \E c \in Cards : Accept(c)
    \/ \E c \in Cards : RollbackRestore(c)
    \/ Recover

\* The database is current when it has applied every revocation in the external
\* log. Under DbEpoched that is the relay's own record, dbEpoch = epoch. Without
\* it the database keeps no record, so the model reads currency from ground truth.
DbCurrent == IF DbEpoched THEN dbEpoch = epoch ELSE revoked = everRevoked

\* ── SAFETY: revocation is final — a once-revoked card is never accepted. ──────
RevocationFinal == badAccept = FALSE

\* ── AVAILABILITY: a current database refuses no card that was never revoked. ─
Availability == DbCurrent => \A c \in issued \ everRevoked : CanAccept(c)

\* Under DbEpoched one step of the spec takes any stale database to a current
\* one. Recover is the only action that can (a Revoke leaves a stale database
\* exactly as far behind), so this says one replay makes it current. It quotes
\* Next, not Recover's guard, so dropping Recover from Next falsifies it.
ReplayRecovers == DbEpoched => (DbCurrent \/ ENABLED (Next /\ DbCurrent'))

\* The bound never saturates the external epoch (see the bounding note in .md).
EpochHeadroom == epoch < MaxEpoch

Spec == Init /\ [][Next]_vars
================================================================================
