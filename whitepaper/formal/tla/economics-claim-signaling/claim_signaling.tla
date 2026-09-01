--------------------------- MODULE claim_signaling ---------------------------
(*
 * TLA+ model of the repeated claim-signaling game described in
 * agent-transactions-whitepaper §sec:economic (and the v2.6 expository page
 * `HowWeProveGameTheory.tsx`). Companion artifact to `delta-threshold.z3`.
 *
 * ---------------------------------------------------------------------------
 * Proposition 7.1 (informal) — what we are mechanizing
 * ---------------------------------------------------------------------------
 *
 *   In the repeated claim-signaling game between two agents under a
 *   public correlating recommendation, a graduated-trigger strategy
 *   supports truthful coordination for all discount factors δ above
 *
 *       δ* = unique real root of  2δ³ + 2δ² + 2δ - 1 = 0  in (0, 1)
 *          ≈ 0.3425
 *
 *   The cubic comes from the standard one-shot deviation analysis with
 *   a 3-round graduated trigger and the stage-game calibration below.
 *   `whitepaper/formal/z3/economics-delta-threshold/delta-threshold.z3` proves the cubic has a unique
 *   real root in (0, 1) and that the root lies in [0.34, 0.35]. This
 *   TLA+ model independently verifies that no one-shot deviation
 *   produces strictly positive discounted payoff at δ = 0.35 — i.e.
 *   the IC condition holds at the parameter value the sweep places
 *   just above the threshold. The sweep script `sweep-delta.sh`
 *   confirms the empirical crossover lands at 0.34 or 0.35.
 *
 * ---------------------------------------------------------------------------
 * The stage game (and where the cubic comes from)
 * ---------------------------------------------------------------------------
 *
 *   Two agents A, B. Each round, the daemon publishes a recommendation:
 *   the cooperative play is for both agents to play "follow" (the
 *   recommendation is to follow the daemon's coordination hint).
 *   "Claim" is the defection — an agent grabs the resource regardless
 *   of the recommendation. Payoffs (the corrected prisoner's-dilemma
 *   bimatrix of the treatise correction, §sec:economic form):
 *
 *                          B: follow         B: claim
 *       A: follow            (3, 3)            (0, 4)
 *       A: claim             (4, 0)            (1, 1)
 *
 *   So:
 *     - mutual follow            → (3, 3)        cooperative coordination
 *     - unilateral claim         → (4, 0)        defector wins, sucker
 *                                                eats cleanup cost
 *     - mutual claim             → (1, 1)        collision; scrap surplus
 *
 *   One-shot deviation gain g  = 4 - 3 = 1.
 *   Per-round punishment loss L = 3 - 1 = 2 (both claim during trigger).
 *   IC condition:    g  ≤  L · (δ + δ² + δ³)
 *                    1  ≤  2 · (δ + δ² + δ³)
 *                    ⇔   2δ³ + 2δ² + 2δ - 1  ≥  0
 *
 *   The root of the equality is δ* ≈ 0.3425. Above δ*, IC holds. Below,
 *   deviation strictly pays and the graduated trigger does not deter it.
 *
 *   For symmetry with the "claim-signaling" name, the daemon publishes
 *   a per-round PRIORITY recommendation indicating who should hold the
 *   resource THAT round; we collapse this into the abstract "follow"
 *   action because at the IC level only the cooperation-vs-defection
 *   structure matters. The full alternating-priority interpretation is
 *   spelled out in the expository page; the TLA+ model is the
 *   reduced-form proof of the IC inequality.
 *
 * ---------------------------------------------------------------------------
 * Apalache / TLC compatibility
 * ---------------------------------------------------------------------------
 *
 *   - TLC: enumerative explicit-state. Use the supplied
 *     `claim_signaling.cfg` and run `tlc claim_signaling.tla`.
 *   - Apalache: symbolic SMT. Use
 *       apalache-mc check --inv=NoUnilateralDeviationPositive
 *                       --config=claim_signaling.cfg claim_signaling.tla
 *     The `@type:` annotations below are Apalache-compatible.
 *
 *   The score variables are scaled by DeltaDen^Horizon so that all
 *   arithmetic stays in the integers (TLA+ has no built-in Reals).
 *)

EXTENDS Integers, FiniteSets, Sequences, TLC

CONSTANTS
    \* @type: Int;
    DeltaNum,           \* discount factor numerator (e.g. 35 for 0.35)
    \* @type: Int;
    DeltaDen,           \* discount factor denominator (e.g. 100)
    \* @type: Int;
    Horizon,            \* number of rounds to simulate
    \* @type: Int;
    PunishmentRounds    \* graduated-trigger punishment length (paper: 3)

ASSUME DeltaDen > 0
ASSUME DeltaNum >= 0 /\ DeltaNum <= DeltaDen
ASSUME Horizon > 0
ASSUME PunishmentRounds >= 0

\* Stage-game payoffs. See header for the matrix.
\* These specific numbers are calibrated so that the IC cubic is
\* exactly 2δ³ + 2δ² + 2δ - 1 = 0 (gain g = 1, punishment loss L = 2).
PayoffFollowFollow == 3    \* cooperative
PayoffFollowClaim  == 0    \* sucker
PayoffClaimFollow  == 4    \* defector
PayoffClaimClaim   == 1    \* collision

\* The agents.
Agents == {"A", "B"}

\* Stage payoff for `agent` given the joint action (actA, actB).
\* @type: (Str, Str, Str) => Int;
StagePayoff(agent, actA, actB) ==
  LET myAct == IF agent = "A" THEN actA ELSE actB
      theirAct == IF agent = "A" THEN actB ELSE actA
  IN  CASE myAct = "follow" /\ theirAct = "follow" -> PayoffFollowFollow
        [] myAct = "follow" /\ theirAct = "claim"  -> PayoffFollowClaim
        [] myAct = "claim"  /\ theirAct = "follow" -> PayoffClaimFollow
        [] myAct = "claim"  /\ theirAct = "claim"  -> PayoffClaimClaim
        [] OTHER -> 0

----------------------------------------------------------------------------
(* State variables.

   round           — current round counter, 0..Horizon.
   followScore[a]  — agent a's accumulated discounted payoff under the
                     hypothetical "always follow" play (cooperation
                     every round). Scaled by DeltaDen^Horizon.
   actualScore[a]  — agent a's accumulated discounted payoff under the
                     deviator's actual play (deviate once at round 0,
                     enter 3-round punishment of mutual claim, return).
   punishCountdown — rounds remaining of graduated punishment.
   deviated        — TRUE once the deviator has actually deviated.
   deviatorId      — which agent (if any) is the deviator on this run.
                     Chosen nondeterministically at round 0 so TLC
                     exercises both A-as-deviator and B-as-deviator.
*)

VARIABLES
    \* @type: Int;
    round,
    \* @type: Str -> Int;
    followScore,
    \* @type: Str -> Int;
    actualScore,
    \* @type: Int;
    punishCountdown,
    \* @type: Bool;
    deviated,
    \* @type: Str;
    deviatorId

vars == << round, followScore, actualScore, punishCountdown, deviated, deviatorId >>

\* DiscountWeight(k) = DeltaNum^k * DeltaDen^(Horizon - k). All rounds
\* are on the common scale DeltaDen^Horizon so they can be added.
\*
\* Implementation note: Apalache does not support user-defined
\* `RECURSIVE` operators, and it also rejects `ApaFoldSet` over a
\* dynamic range like `1..n` where n is a state-dependent expression
\* ("Expected a constant integer range in [ .. ]"). We therefore
\* compute `DiscountWeight` as a *function* keyed on the constant
\* range `0..(Horizon - 1)`, using `ApaFoldSet` once over a constant
\* range `1..Horizon` to build the values iteratively. The result is
\* indexable as `DiscountWeight[round]` (a function lookup), which
\* both checkers handle.
\*
\* Concretely, with Horizon = 4 and (DeltaNum, DeltaDen) = (35, 100):
\*   DiscountWeight[0] = DeltaDen^4                = 100_000_000
\*   DiscountWeight[1] = DeltaNum * DeltaDen^3     =  35_000_000
\*   DiscountWeight[2] = DeltaNum^2 * DeltaDen^2   =  12_250_000
\*   DiscountWeight[3] = DeltaNum^3 * DeltaDen^1   =   4_287_500
\* All values comfortably fit in TLC's 32-bit signed integer range.
\*
\* Implementation: we explicitly unroll the powers for Horizon = 4.
\* This is the *only* horizon the cfg supports, and unrolling is
\* required for Apalache (which rejects user-defined RECURSIVE
\* operators and dynamic ranges in folds). If you change `Horizon` in
\* the cfg, update the function literal below to match.
\*
\* Mathematically:
\*   DiscountWeight[k] = DeltaNum^k * DeltaDen^(Horizon - k)
\*
\* Concretely, with Horizon = 4 and (DeltaNum, DeltaDen) = (35, 100):
\*   DiscountWeight[0] = 1 * DeltaDen^4 = 100*100*100*100 = 100_000_000
\*   DiscountWeight[1] = DeltaNum * DeltaDen^3 =  35*100*100*100 = 35_000_000
\*   DiscountWeight[2] = DeltaNum^2 * DeltaDen^2 = 35*35*100*100 = 12_250_000
\*   DiscountWeight[3] = DeltaNum^3 * DeltaDen   = 35*35*35*100  = 4_287_500
\* All values comfortably fit in TLC's 32-bit signed integer range
\* (max ~2.1e9). Apalache uses arbitrary-precision arithmetic so it
\* has no overflow concern; the cap on Horizon is purely a TLC
\* constraint.

ASSUME Horizon = 4
  \* The unrolled DiscountWeight below assumes Horizon = 4. To run at
  \* a different horizon, replace the function literal with one of
  \* matching length. This ASSUME makes the assumption explicit so
  \* TLC fails fast if the cfg is changed without updating the spec.

\* @type: Int -> Int;
DiscountWeight ==
  LET dn == DeltaNum
      dd == DeltaDen
  IN  [ k \in 0..3 |->
          IF k = 0 THEN dd * dd * dd * dd
          ELSE IF k = 1 THEN dn * dd * dd * dd
          ELSE IF k = 2 THEN dn * dn * dd * dd
          ELSE dn * dn * dn * dd ]

----------------------------------------------------------------------------
Init ==
  /\ round = 0
  /\ followScore = [a \in Agents |-> 0]
  /\ actualScore = [a \in Agents |-> 0]
  /\ punishCountdown = 0
  /\ deviated = FALSE
  /\ deviatorId = "none"

----------------------------------------------------------------------------
(* Actual action this round.

   - If we are inside the punishment window, both agents play "claim"
     (mutual deviation = (1,1)).
   - Else if the deviator hasn't yet deviated, the deviator plays
     "claim" (the deviation). This is the worst-case ONE-SHOT
     deviation we are checking.
   - Otherwise (the non-deviator agent, or the deviator after their
     one-shot deviation has already been triggered AND the punishment
     window has elapsed), follow the recommendation by playing
     "follow". *)

\* @type: (Str, Bool) => Str;
ActualActionOf(agent, hasDeviatedYet) ==
  IF punishCountdown > 0 THEN "claim"
  ELSE IF agent = deviatorId /\ ~hasDeviatedYet THEN "claim"
  ELSE "follow"

----------------------------------------------------------------------------
ChooseDeviator ==
  /\ round = 0
  /\ deviatorId = "none"
  /\ \E a \in Agents :
       deviatorId' = a
  /\ UNCHANGED << round, followScore, actualScore, punishCountdown, deviated >>

Step ==
  /\ round < Horizon
  /\ deviatorId \in Agents
  /\ LET actA      == ActualActionOf("A", deviated \/ deviatorId # "A")
         actB      == ActualActionOf("B", deviated \/ deviatorId # "B")
         w         == DiscountWeight[round]
         deviatedNow ==
           \/ (deviatorId = "A" /\ actA = "claim" /\ ~deviated)
           \/ (deviatorId = "B" /\ actB = "claim" /\ ~deviated)
     IN  /\ round' = round + 1
         /\ followScore' = [a \in Agents |->
                             followScore[a] + w * PayoffFollowFollow]
         /\ actualScore' = [a \in Agents |->
                             actualScore[a] + w * StagePayoff(a, actA, actB)]
         /\ punishCountdown' =
              IF deviatedNow THEN PunishmentRounds
              ELSE IF punishCountdown > 0 THEN punishCountdown - 1
              ELSE 0
         /\ deviated' = (deviated \/ deviatedNow)
         /\ UNCHANGED deviatorId

Terminal ==
  /\ round = Horizon
  /\ UNCHANGED vars

Next == ChooseDeviator \/ Step \/ Terminal

Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
(* The invariant.

   At the *terminal* state (round = Horizon, the full graduated-trigger
   window has played out) and on any execution where the deviator has
   actually deviated, their actual accumulated discounted score must
   not strictly exceed their follow-the-recommendation score.

   We check the invariant only at the terminal state because the IC
   condition is a statement about the *total* discounted payoff over
   the full deviation+punishment window — at intermediate states the
   deviator's score is transiently ahead (they grabbed +4 in round 0
   before the punishment costs -2 per round in rounds 1..3). The
   one-shot deviation principle, by contrast, compares the full-window
   sums, which is exactly what `actualScore[deviator] <=
   followScore[deviator]` at round = Horizon says.

   This is the discrete-state analogue of the closed-form inequality
   proved by `delta-threshold.z3`. At δ = DeltaNum/DeltaDen = 0.35
   (just above δ* ≈ 0.3425) the invariant should HOLD. At δ = 0.30
   it should FAIL (TLC will print a counterexample trace where the
   deviator's actual score exceeds their follow score at round =
   Horizon). `sweep-delta.sh` automates the sweep across
   δ ∈ {0.30, …, 0.40}. *)

NoUnilateralDeviationPositive ==
  ( round = Horizon /\ deviated /\ deviatorId \in Agents ) =>
    actualScore[deviatorId] <= followScore[deviatorId]

Safety == NoUnilateralDeviationPositive

============================================================================
