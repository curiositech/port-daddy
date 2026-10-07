# Audit-depth margin traces

- Reader question: how does the bribery phase delay the decline of residual corrupt value?
- Claim: the worked recurrence reaches less than one unit after 27, 36 and 53 levels for clique counts 8, 2 and 1.
- Evidence: `spawn-to-person.tex`, the audit-depth worked example and its preceding theorem; G0=400, B=50, beta=10, rho*d=.2. At G>C*B, subtract C*beta; otherwise multiply by .8. These are conditional model calculations, not measurements.
- Grammar: aligned three-row sparklines, common level axis 0..60 and common logarithmic value scale 400..1. Each stops at its first integer crossing. The log transform makes the geometric phase straight; the preceding linear subtraction bends on this scale.
- Counter-reading: changing C is not proof that buying different LLMs creates independent auditors. The theorem's conditional detection and clique assumptions remain in force.
- Rejected alternative: three endpoint bars would repeat the worked totals without showing the two regimes. Noise or uncertainty bands would invent observational evidence.

Independent exact-rational recurrence checks are in `test_book_worked_examples.py`.
The native-size fragment and assembled physical page 369 / folio 341 were
visually inspected. In the final local Book SHA256
`9d8a7ca605993293190444e4464a189b142bf7ff83f75e5fa951440fb68d7646`,
all three traces, labels and the model-only caption fit the outside margin
without touching the worked frame or footer. Independent review agrees for
the pixel-identical earlier page. This accepts this scoped local drawing,
not the theorem, other figure families, publication, or author approval.
