---------------------------- MODULE WebhookDelivery ----------------------------
(***************************************************************************)
(* Port Daddy: GitHub-App relay ingress — webhook delivery / replay safety *)
(*                                                                         *)
(* Closes the replay-freedom obligation that the ProVerif origin-auth model *)
(* deliberately left OPEN. ProVerif proves ORIGIN (a MAC lets the attacker  *)
(* re-deliver a genuine event), but replay-freedom and ordering are         *)
(* STATEFUL, mutable-state properties — TLA+'s domain, not ProVerif's.      *)
(*                                                                         *)
(* Model: the receiver emits a per-publisher chain of webhook events with   *)
(* monotonic seq (the relay's Merkle chain). The relay is the adversary: it *)
(* may deliver any already-emitted event to the daemon, in any order, any   *)
(* number of times (reorder + duplicate + redeliver-forever). The daemon    *)
(* consumes with a chain-continuity guard: dispatch seq s to the fleet iff   *)
(* s = tip+1. Dedup is a CONSTANT so the same module checks the fixed daemon *)
(* (Dedup=TRUE) and the negative control (Dedup=FALSE, dispatch anything).  *)
(*                                                                         *)
(* This is the design justification for consuming GitHub webhooks over the  *)
(* relay's ORDERED per-publisher chain (from_seq subscribe), not the raw     *)
(* forward: the seq=tip+1 guard yields at-most-once + in-order + gap         *)
(* detection in one mechanism.                                             *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxSeq,   \* chain length: webhook events the receiver emits (bound the model)
    Dedup     \* TRUE = daemon enforces seq=tip+1 (fixed); FALSE = dispatch anything (vuln)

VARIABLES
    pubNext,  \* next seq the receiver will emit; emitted events are 1..pubNext-1
    tip,      \* daemon's last contiguously-dispatched seq (0 = none yet)
    dcount    \* [Seqs -> Nat] number of times each seq has been dispatched to the fleet

vars == <<pubNext, tip, dcount>>

Seqs == 1..MaxSeq

TypeOK ==
    /\ pubNext \in 1..(MaxSeq + 1)
    /\ tip \in 0..MaxSeq
    /\ dcount \in [Seqs -> 0..2]      \* 2 suffices to witness a double-dispatch

Init ==
    /\ pubNext = 1
    /\ tip = 0
    /\ dcount = [s \in Seqs |-> 0]

Emitted(s) == s < pubNext              \* the receiver has put s on the wire

\* The receiver emits the next chain event (monotonic seq).
Emit ==
    /\ pubNext <= MaxSeq
    /\ pubNext' = pubNext + 1
    /\ UNCHANGED <<tip, dcount>>

\* The adversarial relay delivers some already-emitted seq s to the daemon.
\* Because it never has to remove s, it models unlimited reorder + duplication +
\* redelivery. The daemon dispatches s to the fleet, gated by chain continuity
\* when Dedup is on.
Deliver(s) ==
    /\ Emitted(s)
    /\ (Dedup => s = tip + 1)          \* fixed daemon: only the next chain link
    /\ dcount[s] < 2                    \* keep the counter bounded for TLC
    /\ dcount' = [dcount EXCEPT ![s] = @ + 1]
    /\ tip' = IF s > tip THEN s ELSE tip
    /\ UNCHANGED pubNext

Next ==
    \/ Emit
    \/ \E s \in Seqs : Deliver(s)

\* ── SAFETY ───────────────────────────────────────────────────────────────────
\* Replay-freedom: no webhook is ever dispatched to the fleet more than once.
AtMostOnce == \A s \in Seqs : dcount[s] <= 1

\* In-order, no gaps: the dispatched set is exactly 1..tip (the daemon never acts
\* on a later event while an earlier one is still missing — A2 stale-state defense).
Contiguous == \A s \in Seqs : (dcount[s] >= 1) <=> (s <= tip)

\* ── LIVENESS ─────────────────────────────────────────────────────────────────
\* Under fair delivery, every emitted webhook is eventually dispatched.
EventuallyDispatched == \A s \in Seqs : Emitted(s) ~> (s <= tip)

Fairness == \A s \in Seqs : WF_vars(Deliver(s))
Spec == Init /\ [][Next]_vars /\ Fairness
================================================================================
