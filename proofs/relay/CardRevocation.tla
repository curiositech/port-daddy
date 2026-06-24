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
(* (backup/restore) and the revocation-epoch mitigation.                   *)
(*                                                                         *)
(* CONSTANTS toggle the adversary and the mitigation, so one module yields  *)
(* the baseline, the attack (negative control), and the fix:               *)
(*   Rollback=FALSE, Epoched=FALSE  -> baseline: finality holds             *)
(*   Rollback=TRUE,  Epoched=FALSE  -> backup-restore attack: VIOLATED      *)
(*   Rollback=TRUE,  Epoched=TRUE   -> revocation-epoch mitigation: holds    *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
    Cards,        \* finite set of card identities (JTIs), e.g. {c1, c2}
    MaxEpoch,     \* bound on the external revocation epoch
    MaxRollback,  \* adversary's rollback budget (bounds epoch pumping; see .md)
    Rollback,     \* TRUE = enable the DB backup-restore adversary
    Epoched       \* TRUE = cards carry an epoch; accept requires card epoch == current

VARIABLES
    issued,       \* SUBSET Cards: cards minted
    revoked,      \* SUBSET Cards: DB revocation set (CAN be rolled back)
    everRevoked,  \* SUBSET Cards: ground truth — monotonic, survives rollback
    epoch,        \* external revocation epoch (monotonic, survives rollback)
    cardEpoch,    \* [Cards -> 0..MaxEpoch]: epoch at which each card was minted
    rbUsed,       \* rollbacks performed (bounds Revoke->Rollback->Revoke pumping)
    badAccept     \* TRUE once a once-revoked card is accepted (finality breach)

vars == <<issued, revoked, everRevoked, epoch, cardEpoch, rbUsed, badAccept>>

TypeOK ==
    /\ issued \subseteq Cards
    /\ revoked \subseteq Cards
    /\ everRevoked \subseteq Cards
    /\ epoch \in 0..MaxEpoch
    /\ cardEpoch \in [Cards -> 0..MaxEpoch]
    /\ rbUsed \in 0..MaxRollback
    /\ badAccept \in BOOLEAN

Init ==
    /\ issued = {}
    /\ revoked = {}
    /\ everRevoked = {}
    /\ epoch = 0
    /\ cardEpoch = [c \in Cards |-> 0]
    /\ rbUsed = 0
    /\ badAccept = FALSE

\* Daemon mints a card at the current epoch.
Issue(c) ==
    /\ c \notin issued
    /\ issued' = issued \cup {c}
    /\ cardEpoch' = [cardEpoch EXCEPT ![c] = epoch]
    /\ UNCHANGED <<revoked, everRevoked, epoch, rbUsed, badAccept>>

\* Revoke a card. Records it in both the DB set and the monotonic ground truth,
\* and advances the external revocation epoch (a global rotation).
Revoke(c) ==
    /\ c \in issued
    /\ c \notin revoked
    /\ revoked' = revoked \cup {c}
    /\ everRevoked' = everRevoked \cup {c}
    /\ epoch' = IF epoch < MaxEpoch THEN epoch + 1 ELSE epoch
    /\ UNCHANGED <<issued, cardEpoch, rbUsed, badAccept>>

\* The relay verifies a card at publish/handshake. Accept requires it is not in
\* the DB revocation set, and (when Epoched) that its epoch is current. If a card
\* that was EVER revoked is accepted, finality is breached.
Accept(c) ==
    /\ c \in issued
    /\ c \notin revoked
    /\ (Epoched => cardEpoch[c] = epoch)
    /\ badAccept' = (badAccept \/ (c \in everRevoked))
    /\ UNCHANGED <<issued, revoked, everRevoked, epoch, cardEpoch, rbUsed>>

\* The backup-restore adversary (ADR-0018 Attack 2): a restore drops a revocation
\* from the DB set. Ground truth (everRevoked) and the external epoch survive.
RollbackRestore(c) ==
    /\ Rollback
    /\ rbUsed < MaxRollback
    /\ c \in revoked
    /\ revoked' = revoked \ {c}
    /\ rbUsed' = rbUsed + 1
    /\ UNCHANGED <<issued, everRevoked, epoch, cardEpoch, badAccept>>

Next ==
    \/ \E c \in Cards : Issue(c)
    \/ \E c \in Cards : Revoke(c)
    \/ \E c \in Cards : Accept(c)
    \/ \E c \in Cards : RollbackRestore(c)

\* ── SAFETY: revocation is final — a once-revoked card is never accepted. ──────
RevocationFinal == badAccept = FALSE

Spec == Init /\ [][Next]_vars
================================================================================
