--------------------------- MODULE Conservation ---------------------------
(*
 * TLA+ specification for Bonded Commons §7.x Conservation Theorem.
 *
 * Statement (informal): the total amount of escrowed bond across the
 * system is conserved across all legitimate operations: stake, slash,
 * partial-slash, refund, advisor-payout. The only operations that
 * change the total are mint (an authorized top-up by an external
 * payer) and burn (a slash that destroys the bond rather than
 * transferring it to a counterparty).
 *
 * Statement (TLA+):
 *   - State variables: Escrowed (sum across all sessions), Free
 *     (counterparty-payable), Burned (slash-to-zero), Minted (lifetime).
 *   - Invariant: Escrowed + Free + Burned = Minted at all times.
 *
 * What we model
 *   - A finite set of agents A.
 *   - Per-agent escrow balance, free balance.
 *   - Operations: Mint, Stake, Slash, PartialSlash, Refund, Payout.
 *   - Stake moves Free -> Escrowed.
 *   - Refund moves Escrowed -> Free.
 *   - Slash moves Escrowed -> Burned (legitimate destruction; the
 *     counterparty in the abstract model is the "commons" itself,
 *     represented by Burned).
 *   - PartialSlash moves Escrowed -> Burned + Refund.
 *   - Payout moves Escrowed -> Free of a different agent.
 *   - Mint adds to Free (and to Minted).
 *
 * What this does NOT model
 *   - Concurrent claims on the same escrow row (that's the No-Overdraft
 *     Lemma, separate Kani harness).
 *   - Time-bound expiry (we assume the operations are atomic; the
 *     daemon's transaction layer handles expiry separately).
 *   - Out-of-band advisor fee schedules (folded into Payout).
 *
 * Bound for TLC: small parameters (3 agents, max balance 5) — the
 * invariant is structural, so a small model is sufficient. Apalache
 * can re-check at higher bounds if needed.
 *)

EXTENDS Naturals, FiniteSets, Sequences, TLC

CONSTANTS Agents,             \* finite set of agents
          MaxBalance,         \* max per-agent balance (test bound)
          MaxMint             \* max lifetime mint (test bound)

ASSUME Cardinality(Agents) > 0
ASSUME MaxBalance \in Nat /\ MaxBalance > 0
ASSUME MaxMint \in Nat /\ MaxMint > 0

VARIABLES
    free,        \* [Agents -> Nat]: free balance per agent
    escrow,      \* [Agents -> Nat]: escrowed balance per agent
    burned,      \* Nat: lifetime slash-to-zero across all agents
    minted       \* Nat: lifetime mint across all agents

vars == << free, escrow, burned, minted >>

Sum(f, S) ==
  LET RECURSIVE SumRec(_,_)
      SumRec(g, T) ==
        IF T = {} THEN 0
        ELSE LET x == CHOOSE x \in T : TRUE IN g[x] + SumRec(g, T \ {x})
  IN SumRec(f, S)

TotalFree    == Sum(free, Agents)
TotalEscrow  == Sum(escrow, Agents)

----------------------------------------------------------------------------
(* Initial state: every agent at zero, nothing minted yet. *)
Init ==
  /\ free   = [a \in Agents |-> 0]
  /\ escrow = [a \in Agents |-> 0]
  /\ burned = 0
  /\ minted = 0

----------------------------------------------------------------------------
(* Mint: external top-up to agent a. Bounded by MaxMint to keep TLC finite. *)
Mint(a, amt) ==
  /\ amt \in 1..MaxBalance
  /\ minted + amt <= MaxMint
  /\ free' = [free EXCEPT ![a] = @ + amt]
  /\ minted' = minted + amt
  /\ UNCHANGED << escrow, burned >>

(* Stake: move from free to escrow within agent a. *)
Stake(a, amt) ==
  /\ amt \in 1..MaxBalance
  /\ free[a] >= amt
  /\ free' = [free EXCEPT ![a] = @ - amt]
  /\ escrow' = [escrow EXCEPT ![a] = @ + amt]
  /\ UNCHANGED << burned, minted >>

(* Refund: move from escrow to free within agent a. *)
Refund(a, amt) ==
  /\ amt \in 1..MaxBalance
  /\ escrow[a] >= amt
  /\ escrow' = [escrow EXCEPT ![a] = @ - amt]
  /\ free' = [free EXCEPT ![a] = @ + amt]
  /\ UNCHANGED << burned, minted >>

(* Slash: destroy the entire escrow of agent a (move to Burned). *)
Slash(a) ==
  /\ escrow[a] > 0
  /\ burned' = burned + escrow[a]
  /\ escrow' = [escrow EXCEPT ![a] = 0]
  /\ UNCHANGED << free, minted >>

(* PartialSlash: destroy `slash` of agent a's escrow, refund `keep`. *)
PartialSlash(a, slash, keep) ==
  /\ slash \in 1..MaxBalance
  /\ keep \in 0..MaxBalance
  /\ escrow[a] >= slash + keep
  /\ burned' = burned + slash
  /\ free' = [free EXCEPT ![a] = @ + keep]
  /\ escrow' = [escrow EXCEPT ![a] = @ - slash - keep]
  /\ UNCHANGED << minted >>

(* Payout: move from escrow of agent a to free of agent b (advisor fee,
   counterparty restitution, etc.). *)
Payout(a, b, amt) ==
  /\ a # b
  /\ amt \in 1..MaxBalance
  /\ escrow[a] >= amt
  /\ escrow' = [escrow EXCEPT ![a] = @ - amt]
  /\ free' = [free EXCEPT ![b] = @ + amt]
  /\ UNCHANGED << burned, minted >>

----------------------------------------------------------------------------
Next ==
  \/ \E a \in Agents, amt \in 1..MaxBalance : Mint(a, amt)
  \/ \E a \in Agents, amt \in 1..MaxBalance : Stake(a, amt)
  \/ \E a \in Agents, amt \in 1..MaxBalance : Refund(a, amt)
  \/ \E a \in Agents : Slash(a)
  \/ \E a \in Agents, s \in 1..MaxBalance, k \in 0..MaxBalance : PartialSlash(a, s, k)
  \/ \E a, b \in Agents, amt \in 1..MaxBalance : Payout(a, b, amt)

Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
(* The Conservation Theorem.
   At every reachable state: TotalFree + TotalEscrow + Burned = Minted.
   In words: nothing appears or disappears except via Mint (in) and
   Burned tracks every slash-out, with Free + Escrow holding the rest. *)
Conservation == TotalFree + TotalEscrow + burned = minted

(* No-Overdraft as a simpler local invariant we get for free. *)
NoNegative ==
  /\ \A a \in Agents : free[a] >= 0
  /\ \A a \in Agents : escrow[a] >= 0
  /\ burned >= 0
  /\ minted >= 0

(* Safety ties them together. *)
Safety == Conservation /\ NoNegative

============================================================================
