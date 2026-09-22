# Three-round deterrence sparkline

Reader question: when does the future cost of three punishment rounds outweigh a one-unit immediate gain?

Claim: U(delta)=1-2(delta+delta²+delta³) decreases from 1 to -5 over delta in [0,1], crossing zero at 0.342508031368. These are analytical model values, not collected observations. No fitting, missing values, or uncertainty intervals are involved.

Source: Bonded Commons, Deviation analysis and Critical delta paragraphs. Assumes the stated payoff table, persistent identities, and perfect public monitoring. Numerical checks are recorded in the sparkline pass's `scripts/check_inline_anchors.py`; U(0)=1 and U(1)=-5 follow directly.

Visual grammar: continuous ordered curve with zero baseline, endpoint values, discount-factor domain and directly marked root. No enclosing figure, separate title, or full-sized duplicate plot. The fragment uses an 8pt native label size inside the 1.3-inch margin; margin prose retains the Book's normal size.

Rejected candidate: the initial agent plot used an unnecessarily broad negative y range while showing delta only up to .6, visually flattening the curve and omitting the full future-weight comparison. The integrated fragment shows the whole unit domain.

Acceptance: reader can identify sign change and domain; cannot infer observed agent behavior. Book-preamble fixture compiled and was visually inspected with no overfull warning. Whole-chapter pagination remains pending. Source: `website-v2/public/whitepaper/figures/spark-bonded-deviation.tex`.
