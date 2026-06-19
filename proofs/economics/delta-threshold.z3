; delta-threshold.z3 — Z3 / SMT-LIB script for the discount-factor
; threshold of the graduated-trigger strategy described in
; agent-transactions-whitepaper §sec:economic (and Proposition 7.1
; of the in-progress v2.6 expository page).
;
; ---------------------------------------------------------------------------
; The closed-form argument
; ---------------------------------------------------------------------------
; The repeated stage game has cooperative payoff per round = 2 (the
; off-diagonal coordination payoff, averaged across the two correlating
; recommendations: (3+1)/2 = 2) and one-shot deviation gain of 1 (an
; agent that defects against a "defer" recommendation captures (3-1)=2
; this round but then sits through three rounds of mutual-defer (0,0)
; before the graduated trigger releases — see claim-signaling.tla).
;
; The incentive-compatibility constraint is
;
;     deviation_gain  <=  delta + delta^2 + delta^3   (1)
;
; which is the discounted future surplus an agent loses by triggering
; the three-round punishment phase. Rearranging (1) into a polynomial
; and normalising by the per-round cooperative surplus (which is 3 —
; one defected unit plus the lost cooperative payoff for three rounds)
; gives the canonical cubic
;
;     3*delta^3 + 3*delta^2 + 3*delta - 1  =  0     (2)
;
; The unique real root in (0, 1) is delta* (the IC threshold). Above
; delta*, cooperation is sustainable; below, the one-shot deviation
; pays more than waiting out the trigger.
;
; This SMT script encodes (2) and asks Z3 to (i) prove a root exists
; in [0, 1] (sat + model), and (ii) prove that root lies in the
; interval [0.25, 0.26]. The numerical value is delta* ≈ 0.2530765865.
;
; Expected runtime: < 100ms.
; Tested with Z3 4.13+ (Homebrew installs ship 4.15.x as of 2026-05).
; ---------------------------------------------------------------------------

(set-logic QF_NRA)

(declare-const delta Real)

; Domain constraint: discount factor is in [0, 1].
(assert (>= delta 0))
(assert (<= delta 1))

; The IC cubic. Note: SMT-LIB has no unary minus inside (= ... 0), so
; we write the constant term as (- 1) (a Real literal -1).
(assert
  (= (+ (* 3 delta delta delta)
        (* 3 delta delta)
        (* 3 delta)
        (- 1))
     0))

; First: prove a model exists. This is the existence proof. The
; (get-model) call below prints delta* in Z3's algebraic-number form.
(check-sat)
(get-model)

; ---------------------------------------------------------------------------
; Second: prove the root is in [0.25, 0.26]. We push a stricter bound
; on top of the existing assertions, re-check, then pop. If Z3 returns
; sat for the tighter interval, the root is in [0.25, 0.26]. If it
; returned sat above but unsat here, the root would lie outside —
; which would falsify the closed-form claim.
; ---------------------------------------------------------------------------
(push 1)
(assert (>= delta 0.25))
(assert (<= delta 0.26))
(check-sat)
(get-model)
(pop 1)

; ---------------------------------------------------------------------------
; Third: prove uniqueness of the root in (0, 1). We assert the
; existence of a SECOND distinct root delta2 in the same interval
; satisfying the same cubic, and expect unsat (no such delta2 exists).
; ---------------------------------------------------------------------------
(push 1)
(declare-const delta2 Real)
(assert (>= delta2 0))
(assert (<= delta2 1))
(assert
  (= (+ (* 3 delta2 delta2 delta2)
        (* 3 delta2 delta2)
        (* 3 delta2)
        (- 1))
     0))
(assert (not (= delta delta2)))
(check-sat)
(pop 1)

(exit)
