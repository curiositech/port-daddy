# Same gate, different argument

1. **Stable ID:** `VIII/fig:sealed-laundering-fork` (Book chapter 3).
2. **Reader question:** can changing the argument make an honest parity gate distinguish secrets it was meant to keep indistinguishable?
3. **Claim:** secrets 0 and 2 have the same parity, but applying floor(s/2) before the same parity gate produces distinct observations 0 and 1.
4. **Relation:** aligned two-policy comparison with the same ordered pair of worlds in every record.
5. **Required evidence:** input pair (0,2); committed-input output (0,0); transform f(s)=floor(s/2); transformed input (0,1); output (0,1); identical g in both rows; current C1 has no payload register and releases g(s), not g(t).
6. **Counter-reading:** this arithmetic counterexample is not an executed extension of C1, an attack found by its existing mutation suite, or a failure of the stated committed-input model.

Read `sealed-harbor.tex` at the finite noninterference property, its laundering
boundary and the solution of `ex:sealed-launder`. Read the complete model
`skills/harbor-results/scripts/c1_noninterference.py`: submission sets a pending
Boolean; the honest release applies g to the committed secret. The extra
payload register is an exercise/proposal, not present state.

The old repeated load/read/submit flow gave the gate's argument little visual
weight. Its dashed box around submit could suggest that the checker sees only
that event, although C1 models the other events too. Replace it with two
aligned rows. Folded paper records identify gate inputs and public outputs;
both calls use identical parity-gate geometry. Every pair is ordered world A,
world B. Teal plus equality identifies equal observations; warning color plus
inequality identifies distinction. The current-model note is separate from
the arithmetic comparison, not a fictitious model boundary.

Rejected: a branch inside the existing automaton (it lacks compute/payload),
a probability chart without data, two differently drawn gates implying the
gate was corrupted, or an unlabeled numeric pair. One margin caption states
the consequence and limitation. No chart title repeating that caption.

Validation: identity preserves equal-parity classes; floor(s/2) distinguishes
both equal-parity pairs; a parity-only transform preserves the classes.
Deliberately wrong results must fail source-value checks. Preserve figure
identity and number. Use native 9-point Suisse styles, measured width below
325.215pt, actual Book-preamble proof and final-page/facing-page review. No paid
experiment, network, model call or Port Daddy process; C1 source unchanged.

Status: accepted locally after parent inspection of actual Book physical pages
190–192 in the payload/engine proof. The figure is on physical page 191,
folio 163, still Figure 3.7. Its native measured width is 311.29147 TeX pt.
All seven arithmetic/model/rendered/reference tests pass; the unchanged C1
runner still catches both original mutants. This is scoped editorial approval,
not an executed payload-model extension or whole-Book approval. Exact proof
and remaining defects: `BOOK-PAYLOAD-ENGINE-PASS-20260920.md`.
