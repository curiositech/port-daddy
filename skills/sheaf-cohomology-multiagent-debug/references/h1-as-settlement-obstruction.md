# The Completion Residual as Double-Spend & Settlement Obstruction (PRV-12/13)

The algebraic object that diagnoses multi-agent coordination failure also characterizes the impossibility of consistent cross-harbor ledger settlement. This is not analogy — it is the identical algebraic structure under two interpretations of the same cellular sheaf.

## The Formal Correspondence

In Port Daddy's settlement protocol (PRV-12/PRV-13), each harbor node maintains a local ledger shard: a vector $x_v \in \mathbb{R}^d$ encoding uncommitted balances, pending claims, and port allocations. When two harbors share a settlement channel $e = (u, v)$, each asserts its projection through a shared restriction map $P_e: \mathbb{R}^d \to \mathbb{R}^s$. 

Across known channels $K = C \cup R$ (direct compared channels $C$ and relayed settlement gossip $R$), the observed disagreement cochain is:
$$g_e = P_e x_u - P_e x_v$$

If $g_e \neq 0$, harbors $u$ and $v$ assert contradictory claims about the shared balance on that channel. This is the seed of a double-spend.

### The Correct Diagnostic Statistic
Computing $\dim H^1(G; \mathcal{F})$ of the *abstract sheaf* is data-independent and fails: on any cyclic mesh, $\dim H^1 \ge \beta_1(G) \cdot d$ even when all balances are 100% honest and consistent!

The correct, operational diagnostic is the **Least-Squares Completion Residual**:
$$r = \min_{x} \| g_K - (\delta_K x) \|_2 = \| \Pi_K g_K \|_2$$
where $\Pi_K$ is the orthogonal projector onto $\text{coker}(\delta_K)$.

- **$r = 0$**: The asserted balances are globally reconcilable. There exists a valid global assignment $x^*$ explaining all observed channel values. Settlement may proceed safely.
- **$r > 0$**: Irresolvable double-spend pattern. No consistent global ledger state exists. Furthermore, by Theorem CR-1, $r$ is the exact lower bound on the balance discrepancy injected by the equivocator:
  $$\|\varepsilon_K\|_2 \ge r$$

## Localization and Active Repair (CR-2 & CR-4)

When $r > 0$, the reconciler does not halt the entire federation. By Theorem CR-2:
$$\text{supp}(\Pi_K g_K) \subseteq \bigcup \{ \text{cycles of channels passing through the double-spender} \}$$

The reconciler executes the **CR-4 Optimal Repair Min-Cut**:
1. Computes the harmonic circulation $\rho = \Pi_K g_K$.
2. For each channel $e$, evaluates residual energy $E(e) = \|\rho_e\|_2^2$ relative to arbitration cost $w(e)$.
3. Selects $e^* = \arg\max E(e)/w(e)$ and triggers atomic two-party arbitration or fences $e^*$.
4. Re-evaluates $r$. The obstruction collapses to zero in at most $\beta_1(G_K)$ steps.

## Comparison Table

| Concept | Multi-Agent Swarm | Cross-Harbor Settlement |
|---|---|---|
| **0-Cell $v$** | AgentNode private belief / state | Harbor local ledger shard |
| **1-Cell $e$** | Communication link / AST claim | Settlement channel |
| **Stalk $\mathcal{F}(v)$** | State vector (capacity, epoch, claim) | Balance vector (accounts, escrows) |
| **Restriction $P_e$** | Shared discourse projection | Channel balance readout |
| **Cochain $g_e$** | Asserted agent disagreement | Discrepancy in channel assertions |
| **$r = 0$** | Swarm is globally coherent | No double-spend; settlement safe |
| **$r > 0$** | Topological coordination impasse | Double-spend detected; $r \le \|\varepsilon\|$ |
| **Remediation** | Fencing lease or forced sync (CR-4) | Channel escrow fence / atomic arbitration |
