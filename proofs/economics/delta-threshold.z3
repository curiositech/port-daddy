; delta-threshold.z3 — Z3 / SMT-LIB script for the discount-factor
; threshold of the graduated-trigger strategy described in
; agent-transactions-whitepaper §sec:economic (and Proposition 7.1
; of the in-progress v2.6 expository page).
;
; ---------------------------------------------------------------------------
; The closed-form argument
; ---------------------------------------------------------------------------
; The repeated stage game is the corrected prisoner's dilemma of the
; treatise correction (harbor-research change 1): mutual truth pays 3,
; the one-shot defector grabs 4 against a truthful opponent (sucker
; gets 0), and mutual defection pays 1. The one-shot deviation gain is
; therefore 4 - 3 = 1, and each round of the three-round mutual-defect
; punishment phase costs the deviator 3 - 1 = 2 relative to staying
; cooperative — see claim_signaling.tla.
;
; The incentive-compatibility constraint is
;
;     deviation_gain  <=  2 * (delta + delta^2 + delta^3)   (1)
;
; which is the discounted future surplus an agent loses by triggering
; the three-round punishment phase (per-round loss 2, the cooperative
; payoff 3 minus the punishment payoff 1). Rearranging (1) into a
; polynomial gives the canonical cubic
;
;     2*delta^3 + 2*delta^2 + 2*delta - 1  =  0     (2)
;
; The unique real root in (0, 1) is delta* (the IC threshold). Above
; delta*, cooperation is sustainable; below, the one-shot deviation
; pays more than waiting out the trigger.
;
; This SMT script encodes (2) and asks Z3 to (i) prove a root exists
; in [0, 1] (sat + model), and (ii) prove that root lies in the
; interval [0.34, 0.35]. The numerical value is delta* ≈ 0.3425080314.
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
  (= (+ (* 2 delta delta delta)
        (* 2 delta delta)
        (* 2 delta)
        (- 1))
     0))

; First: prove a model exists. This is the existence proof. The
; (get-model) call below prints delta* in Z3's algebraic-number form.
(check-sat)
(get-model)

; ---------------------------------------------------------------------------
; Second: prove the root is in [0.34, 0.35]. We push a stricter bound
; on top of the existing assertions, re-check, then pop. If Z3 returns
; sat for the tighter interval, the root is in [0.34, 0.35]. If it
; returned sat above but unsat here, the root would lie outside —
; which would falsify the closed-form claim.
; ---------------------------------------------------------------------------
(push 1)
(assert (>= delta 0.34))
(assert (<= delta 0.35))
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
  (= (+ (* 2 delta2 delta2 delta2)
        (* 2 delta2 delta2)
        (* 2 delta2)
        (- 1))
     0))
(assert (not (= delta delta2)))
(check-sat)
(pop 1)

(exit)
