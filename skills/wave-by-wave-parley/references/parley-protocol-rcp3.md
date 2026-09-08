# After-Wave Reconvention: Peer-Output Observation, Vague-Node Negotiation, and Contract-Net Typed Performatives

When wave N completes, surviving agents do not immediately scatter into wave N+1. The reconvention protocol — here called RCP-3 for "wave-boundary reconvention, third mechanism" — inserts a structured deliberation step in which agents observe each other's completed outputs, negotiate who owns which vague (TENTATIVE or EXPLORATORY) nodes, and emit typed commitment performatives before the executor launches the next formation. RCP-3 is the social complement to the individual `evaluateNodeCommitment` call described in SKILL.md: whereas that function is a single-agent re-evaluation loop, RCP-3 is a multi-agent negotiation over the same nodes.

The direct ancestor is Smith (1980): the Contract-Net Protocol defines a task-announcement / bid / award cycle using INFORM, CFP (call-for-proposals), PROPOSE, ACCEPT-PROPOSAL, and REJECT-PROPOSAL as typed performatives. FIPA ACL (FIPA SC00061G, 2002) later formalized these into `inform`, `cfp`, `propose`, `accept-proposal`, `reject-proposal`, and `cancel`. In RCP-3, the manager role is played by the parley coordinator (a lightweight process, not a dedicated agent), and bidding agents are those whose capacity intersects the node's `input_contract`.

**Reconvention sequence (concrete steps):**

1. **Output broadcast.** Each agent that completed a node in wave N emits an `inform` performative carrying its `NodeOutput` to all agents in the parley pool. This is not gossip — it is a single synchronous broadcast, bounded by the number of agents in the wave (typically 2–8 in current Jury-rig topologies). Cost: O(k) messages for k completing agents.

2. **Vague-node announcement.** The parley coordinator identifies every node in wave N+1 with `commitment_level: TENTATIVE | EXPLORATORY`. For each such node, it emits a `cfp` performative addressed to all agents whose declared capabilities overlap the node's `skill_requirements`. The `cfp` content includes: node ID, input contract summary, dependency outputs from step 1, current risk severity for risks whose `affected_nodes` include this node ID.

3. **Bid evaluation.** Each eligible agent responds with either a `propose` performative (carrying a `confidence_estimate: number`, a `revised_commitment_level: 'COMMITTED' | 'EXPLORATORY'`, and an optional `scope_reduction` if the agent believes the node can be narrowed) or a `refuse` performative (carrying a reason code: `CAPACITY`, `SCOPE_UNCLEAR`, `DEPENDENCY_MISSING`). A `refuse` with `SCOPE_UNCLEAR` triggers a follow-up `cfp` with tightened scope — the node's `output_contract` is narrowed by the coordinator and re-announced once. A second `SCOPE_UNCLEAR` refuse from any bidder is treated as an unresolvable vague node and triggers demotion to the next wave or pruning.

4. **Award and commitment.** The coordinator selects the bid with the highest `confidence_estimate` that also returns `revised_commitment_level: COMMITTED` and emits `accept-proposal` to the winning agent. The winning agent's response constitutes a binding commitment: the executor records it as `commitment_level: COMMITTED` and assigns that agent as the executing agent for that node. All other bidders receive `reject-proposal`. Rejected bidders are freed for other nodes.

5. **Pruning signal.** If no agent bids `COMMITTED` for a node (all bids are `EXPLORATORY` or all agents refuse), the coordinator prunes the node and emits a `cancel` performative to all agents who received the original `cfp`. The DAG is mutated in-place: the pruned node's downstream dependents have their `input_contract` updated to reflect its absence, and the premortem risk log is annotated with `pruned_at_wave: N`.

**Mapping to FIPA ACL performatives:**

| RCP-3 action | FIPA performative | Sender | Receiver |
|---|---|---|---|
| Completed output shared | `inform` | completing agent | parley pool |
| Vague-node announcement | `cfp` | coordinator | eligible agents |
| Agent bids to take node | `propose` | bidding agent | coordinator |
| Agent declines | `refuse` | bidding agent | coordinator |
| Node assigned | `accept-proposal` | coordinator | winning agent |
| Others released | `reject-proposal` | coordinator | non-winning agents |
| Node pruned | `cancel` | coordinator | all cfp recipients |

The critical departure from Smith (1980) is that RCP-3 bids are not cost-minimizing — they are uncertainty-minimizing. A classic Contract-Net bid encodes execution cost or time. An RCP-3 bid encodes `confidence_estimate`, a posterior probability that the agent can execute the node to spec given the evidence in the wave N outputs. This makes RCP-3 a Bayesian extension of Contract-Net: the award criterion is argmax(confidence) rather than argmin(cost).

**Latency budget.** In practice, steps 1–5 should complete in under 2 LLM round-trips per vague node. Step 1 is synchronous message passing (no LLM). Steps 2–4 each involve one `cfp→propose` exchange. The coordinator's `accept-proposal` decision is a deterministic argmax on returned confidence values — no LLM call required. Total parley cost for a wave with k vague nodes: 2k LLM calls (one per node per round-trip), plus 1 additional call per node that triggers a scope-narrowing re-announcement. Waves with zero vague nodes skip the entire protocol (`shouldParley` returns false).

## Key Points

- RCP-3 maps directly onto FIPA ACL performatives: `cfp` announces vague nodes, `propose` bids confidence (not cost), `accept-proposal` commits the winning agent, `cancel` prunes irresolvable nodes — one `cancel` per pruned node, emitted to all cfp recipients.
- Commitment is monotonic: a node promoted to COMMITTED during reconvention cannot be re-opened in a later parley. The only direction is forward (TENTATIVE → COMMITTED) or out (EXPLORATORY → pruned). COMMITTED → TENTATIVE is forbidden.
- A `refuse` with `SCOPE_UNCLEAR` triggers exactly one scope-narrowing re-announcement; a second `SCOPE_UNCLEAR` forces pruning. This bounds the negotiation loop at 2 rounds per node and prevents indefinite deliberation.
- Bids encode `confidence_estimate` (posterior probability given wave N evidence), not execution cost. This is the key deviation from Smith (1980): RCP-3 is uncertainty-minimizing, not cost-minimizing.
- The coordinator role is stateless and can be played by any agent or a dedicated lightweight process. It holds no memory between reconventions — all state is in the DAG structure and the `completedOutputs` map passed in from the executor.

## See Also

- SKILL.md `parley()` function — the single-agent re-evaluation inner loop that RCP-3 wraps with a multi-agent negotiation layer.
- `references/parley-protocol-rcp1.md` — wave boundary detection and the `shouldParley` trigger conditions.
- `references/parley-protocol-rcp2.md` — premortem risk reassessment and severity escalation logic.
- Smith, R.G. (1980). "The contract net protocol: High-level communication and control in a distributed problem solver." *IEEE Transactions on Computers*, C-29(12), 1104–1113.
- FIPA SC00061G (2002). "FIPA ACL Message Structure Specification." Foundation for Intelligent Physical Agents.
