# H¹ as Settlement Obstruction: Port Daddy Ledger PRV-12/13 and the Double-Spend Problem

The same cohomological object that diagnoses multi-agent consensus failure also characterizes the impossibility of consistent cross-harbor ledger settlement. This is not analogy — it is the identical algebraic structure under two interpretations of the same sheaf.

## The Formal Correspondence

In Port Daddy's settlement protocol (PRV-12/PRV-13), each harbor node maintains a local ledger shard: a vector x_v ∈ R^d encoding uncommitted balances, pending claims, and port allocations. When two harbors share a settlement channel e = (u, v), each must project its shard into a shared settlement basis — the *restriction map* F_{v▹e}: R^d_v → R^d_e. A cross-harbor settlement is *consistent* if and only if the projections agree: F_{u▹e}(x_u) = F_{v▹e}(x_v).

The coboundary operator δ is exactly the double-spend detector:
```
(δx)_e = F_{v▹e}(x_v) - F_{u▹e}(x_u)
```
If (δx)_e ≠ 0 on channel e, harbors u and v are asserting contradictory claims about the shared balance on that channel. This is precisely a double-spend: both sides can "spend" from a shared resource their projections disagree on.

**H¹ = im(δ)⊥ / trivial** is then the group of irresolvable double-spend patterns. An element γ ∈ H¹ corresponds to a cycle of settlement channels where the disagreements accumulate non-trivially — they cannot be "explained away" by any valid global ledger state x. No amount of reconciliation messages or retry logic can fix this. The topology of the trust graph has made consistent settlement impossible for that pattern of balance assertions.

## PRV-12/PRV-13 Specifically

PRV-12 introduced harbor-level partial settlement: a harbor may commit a settlement for a subset of its pending channels without finalizing all of them. PRV-13 extended this with cross-harbor trust weight matrices — each channel has an asymmetric restriction pair (R_u, R_v) encoding how much each harbor "shrinks" the shared stake space it is willing to expose.

The double-spend obstruction in this regime:

- **Symmetric restriction (PRV-12)**: R_u = R_v = I_d. Then H¹ ≅ cycle space of G tensored with R^d. Any 3-cycle of harbors with inconsistent partial commits produces a rank-d family of obstructions. In practice: if harbors A, B, C each commit partial settlements AB, BC, CA that form a cycle, and the three committed amounts do not sum to zero in the shared stalk, settlement is blocked.

- **Asymmetric trust weights (PRV-13)**: R_u ≠ R_v. Now H¹ can be nonzero even for a single edge if ker(R_u) ∩ im(R_v) ≠ 0 — one harbor asserts a balance component the other does not even model. In pysheaf terms: `sheaf.consistencyRadius()` on the PRV-13 trust graph gives the minimum perturbation to balance vectors needed to achieve settlement; nonzero radius = H¹ ≠ 0.

## Computational Signatures

In Port Daddy's ledger reconciler, the H¹ check runs as:

```python
delta = build_delta(settlement_channels, trust_restriction_maps, n_harbors, d_balance, d_settlement)
h0_dim, h1_dim = cohomology_dims(delta)
if h1_dim > 0:
    cycles = obstruction_cycles(delta, settlement_channels)
    # Each column of cycles is a basis H1 cocycle.
    # Nonzero rows identify which channels participate in the obstruction.
    # Flag those channels; PRV-13 requires human gate review before finalization.
```

A `h1_dim > 0` result at settlement time means: there exists a pattern of balance claims across the trust graph that cannot be globally reconciled. The correct response is not to retry settlement. It is to identify the conflicting restriction maps (the trust weight matrices) on the obstructed cycle and renegotiate them — changing what one harbor exposes on its side of one channel — until the cycle becomes H¹-trivial.

## Two Interpretations, One Object

| Dimension | Multi-Agent Consensus (SOMA/SKILL.md) | Cross-Harbor Settlement (PRV-12/13) |
|---|---|---|
| Vertex stalk F(v) | Agent private belief state | Harbor local ledger shard |
| Edge stalk F(e) | Shared discourse space | Settlement channel basis |
| Restriction map F_{v▹e} | How agent projects belief to shared discourse | How harbor projects balance to channel |
| H⁰ = ker(δ) | Global consensus modes | Globally consistent ledger states |
| H¹ = Z¹/im(δ) | Irresolvable opinion disagreements | Double-spend patterns |
| δx = 0 everywhere | Agents fully agree | No double-spend exists |
| dim(H¹) > 0 | Consensus topologically impossible | Settlement topologically impossible |
| Fix: change restriction map on cycle | Change what one agent exposes on one link | Renegotiate trust weight matrix on one channel |

The mathematics does not distinguish between these domains. A settlement reconciler and a consensus monitor are running the same linear algebra on sheaves over the same class of graphs. Code that computes `cohomology_dims(delta)` for SOMA agents computes it for Port Daddy harbors with identical correctness guarantees.

## Key Points

- H¹(G, F) ≠ 0 is a topological certificate of double-spend impossibility: no sequence of partial settlements can reconcile a cycle whose restriction maps have nontrivial H¹ class, regardless of retry count or message volume.
- PRV-12 symmetric restriction gives H¹ ≅ (cycle space of G) ⊗ R^d; PRV-13 asymmetric trust weights can produce H¹ obstructions on a single edge when ker(R_u) ∩ im(R_v) ≠ 0.
- The fix is always algebraic (modify a restriction map), never operational (send more messages, wait longer, add more harbors).
- `pysheaf`'s `consistencyRadius()` gives a quantitative obstruction severity: zero = H¹-trivial, nonzero = settlement requires balance renegotiation of at least that magnitude.
- The coboundary matrix δ is the same numerical object in both interpretations; a single implementation serves both diagnostic uses.

## See Also

- SKILL.md §"H¹(G;F) = Z¹ / im(δ)" — formal definition of the obstruction group and the implementation of `cohomology_dims`, `obstruction_cycles`
- `references/fiedler-value-vs-h1.md` — when slow convergence (λ₂ problem) is confused with structural obstruction (H¹ problem); PRV-12 partial settlement often triggers false λ₂ alarms
- Hansen & Ghrist (2021) arXiv:2005.12798 §4 — Theorem 4.1 proves that residual Dirichlet energy at equilibrium equals the squared norm of the projection of initial state onto H¹; this is the settlement gap formula for PRV-13 reconciliation
