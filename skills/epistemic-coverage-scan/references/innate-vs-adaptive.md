# Innate vs Adaptive Layering: Epistemic Scan and EFE Selection Without Conflict

The epistemic scan and EFE-driven action selection operate on different timescales and serve non-overlapping functional roles. Understanding precisely where one ends and the other begins prevents agents from accidentally suppressing coverage guarantees or double-counting epistemic reward.

**Epistemic scan is innate** — it fires deterministically based on a structural condition, not on learned belief quality. In the SOMA reference implementation (`active_inference_agent.py`), the scan triggers after step 3 if `len(unseen_nodes) / total_nodes > 0` with probability equal to that ratio. It does not consult the generative model. It cannot be inhibited by low EFE of the target node. It is a reflex: the agent's "attention system" rather than its "decision system." Biologically, this maps to the orienting reflex — a brainstem-level response to novelty that runs beneath cortical goal-pursuit.

**EFE selection is adaptive** — it uses the Beta distribution over each node (`generative_model.py`, `BetaBelief`) to compute G(n) = w_prag × (−E[p] × damping) + w_epist × (−Var[p] × novelty(n)). This is softmax over neighbors, not a hard argmax, so low-G options still get selected occasionally via Boltzmann exploration. Precision w (the inverse temperature) adapts over time: high recent reward raises precision, compressing the distribution toward the greedy choice. Low recent reward lowers precision, broadening exploration. This is the mechanism that learns which nodes are worth visiting repeatedly.

**Why they do not conflict:** The scan fires on globally unseen nodes, not on poorly-modeled ones. EFE fires on neighbors, not on arbitrary graph positions. Their action spaces only overlap when an unseen node is also a neighbor — a transitional state that resolves in one step (the scan visit immediately updates Beta beliefs, converting the node from "unseen" to "seen with one observation"). After that, EFE takes over. The scan has no memory of the visit; it simply checks the unseen set on each trigger opportunity. EFE then accumulates evidence via Beta updates and incorporates the node into gradient-following normally.

The practical consequence: coverage is a hard guarantee from the innate layer, while efficiency is a soft property owned by the adaptive layer. You cannot sacrifice coverage for efficiency (the scan is uncancellable), but you can tune efficiency heavily via w_prag, w_epist, and the precision adaptation rate without touching coverage semantics. This separation is what makes the SOMA Week 2 completion rate jump to 100% while mean steps drop — coverage is handled by the reflex, routing efficiency is handled by learning.

**Implementation note:** When extending to new domains, preserve this separation. If you give EFE control over whether the scan fires, you lose the coverage guarantee. The scan should always observe the unseen ratio independently of the generative model state.

## Key Points

- Epistemic scan = innate reflex; fires on structural condition (unseen set ratio); does not consult EFE or Beta beliefs; cannot be inhibited by the adaptive layer
- EFE selection = adaptive decision; softmax over neighbors using Beta posteriors; precision adapts based on recent reward signal
- Overlap region (unseen neighbor) resolves in one step: scan fires, Beta belief initializes, EFE inherits the node normally on subsequent steps
- Coverage (hard guarantee) belongs to the innate layer; efficiency (soft property) belongs to the adaptive layer — tune them independently
- Do not gate the scan on EFE output; doing so collapses the two-layer architecture into single-layer EFE and sacrifices the coverage proof

## See Also

- `soma/active_inference_agent.py` — `epistemic_scan()` method and step-3 trigger condition
- `soma/generative_model.py` — `BetaBelief`, `compute_efe()`, precision adaptation logic
- `references/efe-computation.md` — full derivation of G(n) with damping and novelty terms
