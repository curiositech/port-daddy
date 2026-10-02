# Three residuals, one output account

Stable identity: `VIII/fig:sealed-residuals-converge`, currently Figure 3.13.
Owner: `website-v2/public/whitepaper/figures/fig-sealed-residuals-converge.tex`.

## Reader question and claim

Where do transformed secrets, self-declared privacy costs, and free-form
outputs leave the room's accounting argument? They are alternative uses of
one specified output alphabet, not three separately granted allowances.
The q-job, b-bit-per-job account is before timing; it does not cover every
host side channel or turn a claimed epsilon into a privacy guarantee.

## Visual grammar

- Blue: a folded sheet with a lock and `t=f(s)` represents a transformed secret.
- Violet: a release sheet with an attached epsilon tag represents a claimed
  cost, not an independently certified private mechanism.
- Ochre: a terminal transcript represents a free-form output.
- Three neutral routes end at one teal envelope: the shared output account.

This is a conceptual schematic, not measured data or a fresh model result.
There is one outside caption. No serial process pipeline, honesty detector,
epsilon-to-bits conversion, or sum of three budgets may be inferred.

## Review record

The parent rejected early native-size drafts for text overrunning small
operation boxes, then for almost invisible arrows after those boxes grew,
and finally for redundant descriptions crossing lane boundaries. The selected
revision uses one recognizable artifact per lane, short qualifiers and long
routes. Geometry is 315.8 by 184.34799 TeX points within the Book column;
Suisse prose labels remain at 9/11 rather than being reduced to fit.

The parent and independent reviewer inspected the integrated figure on actual
Book page 207 of PDF `5091347ec3fa640f0c2b3732e731b5da1622b818b2d1f1b86ba2f312e83586b8`.
They accept the drawing and its source-bound caption in that proof. That
proof as a whole is rejected for a separate short exercise split at 212–213.
The subsequent sixth proof `f7352e065d5c95b921059dfba4c74f5f3ed072e06459558077794cd2c4df5d61`
repairs that split and is accepted for the scoped integration. Exact structural
and pixel comparisons preserve this figure and its adjacent reading flow.
See `BOOK-SEALED-DP-ACCOUNTING-PASS-20260920.md`; do not mistake this acceptance
for whole-chapter or whole-Book approval.

Source SHA256:
`aebb8873f0a9a35492b2c05db4606a10bf26e2cdf9c601ed26cbb0719e5e0595`.
Persistent tests: `tests/harbor-research/test_sealed_residuals_figure.py`.
Tests enforce the three-to-one mapping and explicit scope, reject six
misleading mutations and a resizing wrapper, and inspect actual PDF labels
and native geometry. They complement, not replace, rendered-page review.
