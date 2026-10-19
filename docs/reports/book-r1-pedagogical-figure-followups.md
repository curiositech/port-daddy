# Five figures that most need concrete inputs and outputs

This is a follow-up queue, not an edit request for this round. The ranking favors figures whose current geometry is sound but still asks a first-time reader to supply the example from surrounding prose.

1. **The grant-and-gate roles sequence** — `whitepaper/figures/legible-swarm-roles.tex`
   - Current abstraction: `g`, `a1`, and “gate / escalate.”
   - Add: an input grant such as `tests/** · reversible diffs · 2 h`, an attempted migration edit, and the concrete outputs `DENIED: outside scope` plus an operator revocation receipt. This would turn institutional roles into a trace a developer can replay.

2. **The Anchor verification stack** — `website-v2/public/whitepaper/figures/fig-anchor-verification-stack.tex`
   - Current abstraction: three layer names and two named gaps, with no artifact crossing either gap.
   - Add: a protocol claim ID, Rust commit hash, binary digest, and the verifier output at each layer; make one deployment-digest mismatch fail. The figure would then show exactly what the tools establish and what the human bridge still asserts.

3. **The sealed work-order schema** — `website-v2/public/whitepaper/figures/fig-sealed-work-order-schema.tex`
   - Current abstraction: thirteen field names grouped into five roles.
   - Add: one compact filled work order—data hash, runtime hash, allowed function, recipient, 4 MiB output budget, seven-day retention, validator—and the resulting contract hash with two signatures. A one-field retention change should visibly produce a new hash and the output `re-sign required`.

4. **Role versus person** — `website-v2/public/whitepaper/figures/fig-stp-role-vs-person.tex`
   - Current abstraction: identity `κ7` and outcomes `o1…o8`.
   - Add: four short witnessed outputs such as `PR #4812 merged`, `test run #913 passed`, `review #7 resolved`, and `release replay failed`, carried across navigator → reviewer → lookout. The final output should be the same identity’s audit query returning all four events despite role changes.

5. **The assurance sieve** — `website-v2/public/whitepaper/figures/fig-he-assurance-sieve.tex`
   - Current abstraction: only `(1-d)^k`; neither `d` nor any plotted point is instantiated.
   - Add: one declared detection rate, for example `d = 0.30`, direct labels for `k = 0…5`, and the residual defect mass at each step. Pair it with a same-family reviewer run whose observed output stays above the independent curve, making the independence caveat visible rather than caption-only.
