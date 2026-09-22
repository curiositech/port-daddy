# Visible-cycle certificate

Reader question: how does increasing a visible cycle's length change the certified fraction of a single-edge alteration?

Claim and source: Federated Harbor's radius-soundness theorem gives r/|s|=1/sqrt(n) on a unit-weight visible cycle C_n. Paper 7 motivates the relation through effective resistance on K_c, not the nominal graph G_c. This drawing uses only that scalar single-edge specialization; it imports no broader vector bound from older Paper 7 text.

Evidence: an analytical curve at integer n=4..24, not an empirical fit. Exact Fraction-based Gaussian elimination on the grounded unit-weight Laplacian independently checks 1-R_eff=1/n at every plotted integer. Tests also check the Book's 3/sqrt(6) worked value and distinguish path endpoint resistance from resistance across one cycle edge.

Grammar: margin-sized curve with a zero baseline, normalized quantity r/|s|, endpoint values .50 and .20, and explicit cycle-size domain. Markers identify representative integer cycles; the connecting polyline is a guide through exact model values. No error bars are warranted. The caption gives the topology condition rather than repeating the formula.

Rejected alternative: placing a bridge at an arbitrary numeric n beside the cycle curve would imply the bridge is another cycle-size sample. Its zero result remains an explicit sentence instead. A smooth noisy empirical curve would fabricate observations.

Scope: one altered edge, unit weights, visible cycle, scalar coordinate. No coalition, host-enforcement, attribution, or field-calibration claim. Fixture: tests/harbor-research/fixtures/cycle-radius-book.tex. Full-book placement awaits the next batch build.
