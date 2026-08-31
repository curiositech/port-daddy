---
name: agent-context-partitioner
description: >
  Algorithmic skill for designing evidence-backed partitions of LLM context or task DAGs across K agents.
  Covers two modes: (A) online/reactive spawning under context pressure, and (B) static
  pre-planned DAG execution with graph min-cut optimization. Encodes algorithms for
  sequence-stable clustering, dynamic K selection, token-budget-aware partitioning, and
  handoff protocol design. Use when designing multi-agent systems, deciding when and how
  many agents to spawn, or optimizing a task DAG for token efficiency. NOT for one bounded
  task that does not benefit from parallelism, runtime scheduling or authorization policy,
  or comparing vectors whose embedding-space identities are unknown or incompatible.
license: FSL-1.1-MIT
allowed-tools: Read,Bash,Grep,Glob,Edit,Write
metadata:
  category: Multi-Agent Architecture
  tags: [multi-agent, context-management, graph-partitioning, clustering, token-economy, dag, spawning]
  pairs-with: [port-daddy-agent-skill, dag-orchestrator, dag-planner, context-economics-for-agent-swarms]
  provenance:
    kind: first-party
    owners: [port-daddy]
io-contract:
  kind: deliverable
  produces:
    - kind: design-doc
      description: Partition plan assigning context and task-DAG segments across K agents with budgets and handoff protocol
    - kind: code
      description: Partitioning implementation (online reactive spawning or static min-cut) for the target orchestrator
---

# Agent Context Partitioner

## Purpose

When a single LLM context grows unwieldy, or when you are pre-planning a complex task DAG, you need to decide:

1. **How many agents K to use** — and when K should grow
2. **Which context goes to which agent** — without blindly copying everything everywhere
3. **What to communicate between agents** — the minimum necessary, not everything
4. **How to avoid order-dependent mistakes** — the greedy epsilon-similarity trap

This skill provides the algorithmic vocabulary and pseudocode for all four decisions.

---

## Core Mental Model: Agents as Context Protectors

Agents are not a hivemind that shares a global context. They are **context protectors**: each agent carries deep specialized knowledge and is over-qualified for its task. The cost of spawning a new agent is not just the system prompt — it is the **semantic coherence loss** from splitting context that belongs together, plus the **communication overhead** of routing results across agents.

The fundamental tradeoff:

```
Spawn cost    =  system_prompt_tokens + context_copy_tokens + handoff_latency
Stay cost     =  (context_pressure_penalty) × (expected_remaining_tokens)
Spawn when:   spawn_cost + communication_cost < stay_cost
```

---

## Two Modes

### Mode A: Online / Reactive Spawning

A single session accumulates context. At time `t_i`, context pressure triggers the question: spawn a new agent, and if so, what does it inherit?

Key decisions at each time step:
- **K(t_i)**: how many agents right now?
- **Partition π(t_i)**: which context chunks go to which agent?
- **Handoff H(a→b)**: what is the minimal context summary to send?

### Mode B: Static DAG Execution

Given a pre-planned task DAG, assign nodes to agents before execution begins. Sequential dependent nodes can share one agent (saving context-copy overhead); parallel independent nodes go to separate agents. This is a **graph partitioning** problem.

---

## The Sequence-Dependence Problem (Lessons from Newsle)

### The Epsilon-Similarity Triangle Trap

Greedy online clustering is order-dependent. Given three context chunks:
- `a` = database schema docs
- `b` = ORM configuration  
- `c` = migration scripts

Where `sim(a,b) > ε`, `sim(b,c) > ε`, but `sim(a,c) < ε`.

**Arrival order `[c, a, b]`**: c and a are assigned to different agents (sim < ε), then b must join one of them. Whichever wins, the wrong agent owns two of the three tightly related chunks.

**Arrival order `[a, b, c]`**: a and b cluster together (sim > ε), then c joins. Now one agent owns all three. Correct.

The same data yields different (often wrong) partitions depending on arrival order. This is the fundamental failure mode of greedy online context assignment.

### The Fix: Consensus Before Commitment

Never make irrevocable assignment decisions from a single ordering. Three practical implementations:

---

## Algorithm 1: Evidence Accumulation Clustering (EAC) — Best for Offline/Batch

**Origin**: Fred & Jain 2002, "Data Clustering Using Evidence Accumulation"

Run N random centroid initializations, build a co-association matrix, cluster on it.

```python
def eac_context_partition(chunks, K, n_trials=50):
    """
    Order-independent context partitioning via consensus clustering.
    chunks: list of ContextChunk(id, embedding, token_count, dep_set)
    """
    n = len(chunks)
    embeddings = np.array([c.embedding for c in chunks])
    sim_matrix = cosine_similarity(embeddings)
    dep_graph = build_dependency_graph(chunks)
    co_assoc = np.zeros((n, n))

    for _ in range(n_trials):
        # Randomize which centroid gets offered the chunk first
        initial_centroids = random.sample(range(n), K)
        labels = greedy_assign_with_centroids(sim_matrix, initial_centroids,
                                               dep_graph)  # preserves causal order
        for i in range(n):
            for j in range(n):
                if labels[i] == labels[j]:
                    co_assoc[i][j] += 1

    co_assoc /= n_trials
    dist_matrix = 1 - co_assoc

    # Single-linkage on co-association distances
    final_labels = agglomerative_clustering(dist_matrix, K, linkage='single')
    return enforce_causal_closure(final_labels, dep_graph)
```

**Complexity**: O(n_trials × n × K). For n=1000 chunks, n_trials=50: fast enough for pre-planned DAGs.

**Key insight**: the randomization is of *centroid selection order*, not chunk order. Chunk causal order is a hard constraint maintained in `greedy_assign_with_centroids`.

---

## Algorithm 2: Persistent Homology (Vietoris-Rips) — Best for Unknown ε

When you don't know the right epsilon, persistent homology finds topologically stable clusters across all scales.

```python
def persistent_homology_partition(chunks, K):
    """
    Use 0-th persistent homology to find epsilon-independent clusters.
    Requires: ripser or gudhi library.
    """
    embeddings = np.array([c.embedding for c in chunks])
    dist_matrix = 1 - cosine_similarity(embeddings)

    # H_0 persistence diagram: (birth, death) pairs for connected components
    diagrams = ripser(dist_matrix, metric='precomputed', maxdim=0)
    h0 = diagrams['dgms'][0]

    # The K most persistent components = stable clusters
    # Avoid the K-1 highest-persistence merges to keep K clusters
    finite_pairs = h0[h0[:, 1] < np.inf]
    persistences = finite_pairs[:, 1] - finite_pairs[:, 0]
    sorted_deaths = np.sort(finite_pairs[:, 1])[::-1]

    if K <= len(sorted_deaths):
        # Cut between the (K-1)th and Kth most persistent merges
        epsilon_threshold = (sorted_deaths[K-2] + sorted_deaths[K-1]) / 2
    else:
        epsilon_threshold = sorted_deaths[-1] / 2

    labels = connected_components_at_threshold(dist_matrix, epsilon_threshold)
    return enforce_causal_closure(labels, build_dependency_graph(chunks))
```

**Key insight**: low-persistence merges are "accidents of epsilon" — they only become connected at extreme epsilon values. High-persistence components are the true semantic clusters. The VR filtration gives you a stability certificate for every cluster assignment.

**When to use**: when the task domain is unknown and you cannot calibrate epsilon empirically.

---

## Algorithm 3: RANSAC-Bootstrap — Best for Real-Time

```python
def bootstrap_stable_partition(chunks, K, n_bootstrap=100, sample_frac=0.8,
                                confidence_threshold=0.8):
    """
    Real-time stable partitioning via bootstrap sampling.
    Only commits chunks with >confidence_threshold consensus.
    """
    n = len(chunks)
    vote_matrix = np.zeros((n, n))
    co_occurrence = np.zeros((n, n))

    for _ in range(n_bootstrap):
        sample_idx = sorted(random.sample(range(n), int(n * sample_frac)))
        sample_embeds = np.array([chunks[i].embedding for i in sample_idx])
        labels = kmeans(sample_embeds, K)

        for a, i in enumerate(sample_idx):
            for b, j in enumerate(sample_idx):
                co_occurrence[i][j] += 1
                if labels[a] == labels[b]:
                    vote_matrix[i][j] += 1

    vote_matrix /= np.maximum(co_occurrence, 1)  # normalize

    # Committed chunks: those with >threshold consistent vote
    # Deferred chunks: wait for more context before assignment
    final_labels = spectral_clustering(vote_matrix, K)
    confidence = np.array([
        max(sum(vote_matrix[i][j] for j in range(n)
                if final_labels[j] == final_labels[i]) / n
            for i in range(n))
    ])

    deferred = np.where(confidence < confidence_threshold)[0]
    # Deferred chunks get the label of their most confident neighbor
    for i in deferred:
        neighbors = np.argsort(vote_matrix[i])[::-1][:5]
        committed_neighbors = [j for j in neighbors if j not in deferred]
        if committed_neighbors:
            final_labels[i] = final_labels[committed_neighbors[0]]

    return enforce_causal_closure(final_labels, build_dependency_graph(chunks))
```

**Key insight**: chunks that are truly between clusters will have inconsistent assignment across bootstrap samples (noisy `vote_matrix` rows). Don't commit them until they gather more votes. The `confidence_threshold` is your "conviction gate."

---

## Algorithm 4: Streaming BIRCH with Causal Closure — Best for O(n) Online

For high-throughput streaming where you cannot afford EAC or RANSAC overhead:

```python
class CausalBIRCH:
    """
    BIRCH (Zhang et al. 1996) adapted for causally-ordered context chunks.
    Each CF-node represents a cluster with causal closure enforced.
    """
    def __init__(self, K_max, token_budget, radius_threshold=0.3):
        self.clusters = []  # list of CFNode
        self.K_max = K_max
        self.token_budget = token_budget
        self.T = radius_threshold

    def absorb(self, chunk):
        best_cluster, best_dist = None, float('inf')

        for cluster in self.clusters:
            # Can we absorb without exceeding budget or radius?
            if cluster.tokens + chunk.token_count > self.token_budget:
                continue
            new_radius = cluster.prospective_radius(chunk.embedding)
            if new_radius <= self.T and new_radius < best_dist:
                best_cluster = cluster
                best_dist = new_radius

        if best_cluster is None:
            if len(self.clusters) < self.K_max:
                # Spawn new cluster
                new_cluster = CFNode()
                new_cluster.add(chunk)
                # Enforce causal closure: pull in all deps of this chunk
                for dep in chunk.dep_set:
                    dep_cluster = self.find_cluster_of(dep)
                    if dep_cluster and dep_cluster != new_cluster:
                        # Chunk depends on something in another cluster → merge or copy
                        if dep_cluster.tokens + new_cluster.tokens <= self.token_budget:
                            new_cluster.merge(dep_cluster)
                            self.clusters.remove(dep_cluster)
                        else:
                            # Mark as cross-agent dependency (communication edge)
                            new_cluster.add_remote_dep(dep, dep_cluster.agent_id)
                self.clusters.append(new_cluster)
                return new_cluster
            else:
                # At K_max: absorb into closest cluster regardless of radius
                best_cluster = min(self.clusters,
                                   key=lambda c: c.prospective_radius(chunk.embedding))

        best_cluster.add(chunk)
        return best_cluster
```

**Complexity**: O(K) per chunk. The causal closure check is the critical addition over vanilla BIRCH.

---

## Algorithm 5: DAG-METIS + FM Refinement (Mode B)

For pre-planned DAGs, use multilevel graph partitioning:

```python
def partition_task_dag(dag, K, token_budget_per_agent):
    """
    Phase 1: Augment edge weights with communication + sync cost
    Phase 2: METIS multilevel partitioning
    Phase 3: Schedulability enforcement (no cycles in agent-level DAG)
    Phase 4: EAC stabilization across 5 coarsening strategies
    Phase 5: Fiduccia-Mattheyses (FM) refinement
    Phase 6: Token budget enforcement with agent splitting
    """

    # Phase 1: Edge weights = communication tokens + sync penalty
    for u, v in dag.edges():
        critical_path_fraction = (critical_path_length(dag, start=v) /
                                   dag.total_critical_path())
        dag.set_edge_weight(u, v,
            estimate_comm_tokens(u, v) +
            COMM_LATENCY * critical_path_fraction)

    # Phase 2: Undirected METIS with node weights = estimated token cost
    weighted = dag.to_weighted_undirected(edge_weight='max')
    partition = metis_partition(weighted, K,
                                node_weights={v: dag.token_cost(v) for v in dag},
                                balance=1.1)

    # Phase 3: Enforce no cycles in agent-level dependency graph
    agent_dag = build_agent_dag(dag, partition)
    while has_cycle(agent_dag):
        cycle = find_cycle(agent_dag)
        partition = break_cycle_by_merging(dag, partition, cycle)
        agent_dag = build_agent_dag(dag, partition)

    # Phase 4: EAC over 5 METIS coarsening strategies
    strategies = ['heavy_edge', 'random', 'sorted_heavy_edge', 'fc', 'greedy']
    nodes = list(dag.nodes())
    n = len(nodes)
    co_assoc = np.zeros((n, n))

    for s in strategies:
        p = metis_partition(weighted, K, coarsening=s,
                            node_weights={v: dag.token_cost(v) for v in dag})
        for i, ni in enumerate(nodes):
            for j, nj in enumerate(nodes):
                if p[ni] == p[nj]:
                    co_assoc[i][j] += 1
    co_assoc /= len(strategies)

    partition = spectral_from_coassoc(co_assoc, K, nodes)
    partition = enforce_causal_closure(partition, dag)

    # Phase 5: FM refinement (up to 20 passes)
    for _ in range(20):
        partition, improved = fm_refinement_pass(dag, partition, K)
        if not improved:
            break

    # Phase 6: Token budget enforcement
    for agent_id in range(K):
        agent_tokens = sum(dag.token_cost(v)
                           for v, a in partition.items() if a == agent_id)
        while agent_tokens > token_budget_per_agent:
            moved = move_cheapest_boundary_node(dag, partition, agent_id)
            if not moved:
                K += 1
                partition = split_largest_agent(dag, partition)
            agent_tokens = sum(dag.token_cost(v)
                               for v, a in partition.items() if a == agent_id)

    return partition, build_execution_schedule(dag, partition)
```

### FM Refinement (Fiduccia-Mattheyses)

```python
def fm_refinement_pass(dag, partition, K):
    """O(|E|) per pass. Find node moves that reduce communication cost."""
    gains = {v: compute_node_gain(dag, partition, v) for v in dag.nodes()}
    locked = set()
    moves = []

    while True:
        best = max(
            ((v, t, gains[(v,t)]) for v in dag.nodes() if v not in locked
             for t in range(K) if t != partition[v]),
            key=lambda x: x[2], default=None
        )
        if best is None:
            break
        node, target, gain = best
        old = partition[node]
        partition[node] = target
        locked.add(node)
        moves.append((node, old, target, gain))
        # Update gains for neighbors
        for neighbor in dag.neighbors(node):
            if neighbor not in locked:
                gains.update({(neighbor, t): compute_node_gain(dag, partition, neighbor)
                               for t in range(K)})

    # Find best prefix of moves (maximize cumulative gain)
    best_cut, best_i, cumulative = 0, 0, 0
    for i, (node, old, new, gain) in enumerate(moves):
        cumulative += gain
        if cumulative > best_cut:
            best_cut, best_i = cumulative, i + 1

    # Roll back moves after best prefix
    for node, old, new, gain in moves[best_i:]:
        partition[node] = old

    return partition, best_cut > 0
```

---

## Algorithm 6: Dynamic K Selection

### Gap Statistic (Tibshirani 2001) — Offline

```python
def gap_statistic_k(embeddings, K_max=10, n_reference=20):
    """Find optimal K by comparing observed dispersion to null distribution."""
    gaps = []
    stderrs = []

    for K in range(1, K_max + 1):
        labels = kmeans(embeddings, K)
        W_K = within_cluster_dispersion(embeddings, labels)

        bounds = (embeddings.min(axis=0), embeddings.max(axis=0))
        ref_log_W = []
        for _ in range(n_reference):
            ref = np.random.uniform(bounds[0], bounds[1], size=embeddings.shape)
            ref_labels = kmeans(ref, K)
            ref_log_W.append(np.log(within_cluster_dispersion(ref, ref_labels)))

        gap = np.mean(ref_log_W) - np.log(W_K)
        stderr = np.std(ref_log_W) * np.sqrt(1 + 1 / n_reference)
        gaps.append(gap)
        stderrs.append(stderr)

    # Tibshirani criterion: smallest K where gap(K) >= gap(K+1) - stderr(K+1)
    for K in range(len(gaps) - 1):
        if gaps[K] >= gaps[K + 1] - stderrs[K + 1]:
            return K + 1
    return K_max
```

### BIC for Streaming GMM — Online

```python
def streaming_bic_spawn_check(new_embedding, gmm_k, gmm_params, n_samples):
    """
    Returns (should_spawn: bool, new_K: int).
    Split if BIC improves by more than BIC_THRESHOLD.
    """
    d = len(new_embedding)
    p = 2 * d  # params per GMM component (diagonal covariance)

    log_lik_K = compute_log_likelihood(gmm_params, new_embedding)
    bic_K = -2 * log_lik_K + gmm_k * p * np.log(n_samples)

    # Try splitting the highest-variance component
    candidate = split_highest_variance_component(gmm_params)
    run_em_steps(candidate, n_steps=10)  # partial convergence, not full EM
    log_lik_Kplus1 = compute_log_likelihood(candidate, new_embedding)
    bic_Kplus1 = -2 * log_lik_Kplus1 + (gmm_k + 1) * p * np.log(n_samples)

    BIC_THRESHOLD = 10  # prevents hair-trigger splitting
    if bic_Kplus1 < bic_K - BIC_THRESHOLD:
        return True, gmm_k + 1, candidate
    return False, gmm_k, gmm_params
```

### MDL Spawn Decision — Principled

```
MDL(K) = K × d × log(n)    [model description length]
       + Σ_i [-log P(c_i | cluster)]  [data given model]
       + comm_cost(K)       [token cost of cross-agent communication]

Spawn when: MDL(K+1) + comm_cost(K+1) < MDL(K)
```

The MDL formulation naturally penalizes:
- Creating new agents (larger model description)
- Copying context to multiple agents (larger comm_cost)
- Poor cluster fit (larger data description length)

---

## Causal Closure: The Hard Constraint

Unlike news articles, LLM context chunks have **causal ordering** and **dependency graphs**. This is a hard constraint that all partitioning algorithms must enforce.

```python
def enforce_causal_closure(labels, dep_graph):
    """
    If chunk j is assigned to agent A but chunk i (which j depends on)
    is assigned to agent B, then either:
    (a) merge A and B if token budgets allow, or
    (b) mark i as a "shared" chunk (copied to both agents)
    """
    changed = True
    while changed:
        changed = False
        for chunk_id in dep_graph.nodes():
            agent = labels[chunk_id]
            for dep_id in dep_graph.predecessors(chunk_id):
                dep_agent = labels[dep_id]
                if dep_agent != agent:
                    # Violation: chunk depends on content in another agent
                    # Resolution: merge agents or flag as cross-agent dep
                    if can_merge(agent, dep_agent):
                        labels = merge_agents(labels, agent, dep_agent)
                        changed = True
                    else:
                        # Copy dep_id to agent's context (communication cost)
                        mark_as_shared(dep_id, agent)
    return labels
```

---

## Handoff Protocol: Minimal Context Transfer

When a chunk must cross agent boundaries, send the minimum necessary:

```python
def compute_handoff(from_agent, to_agent, dep_graph):
    """
    Compute the minimal context summary for cross-agent dependency.
    Returns: (summaries: list[CompressedChunk], full_chunks: list[Chunk])
    """
    # Find what to_agent actually needs from from_agent
    needed_ids = transitive_deps(
        to_agent.pending_task_ids,
        exclude=set(to_agent.context_chunk_ids)
    )
    needed_ids = {cid for cid in needed_ids
                  if chunk_owner(cid) == from_agent}

    # Compare only vectors admitted to the same explicit embedding space.
    # Empty receiver context, missing space identity, or no compatible receiver
    # vector is a full-copy decision; never fabricate a vector or compare spaces.
    receiver_context_ids = set(to_agent.context_chunk_ids)
    boundary = set()
    routing_receipts = []
    routing_limitations = []
    for cid in sorted(needed_ids):
        source_space_id = chunks[cid].space_id
        if not receiver_context_ids:
            compatible_context_ids = []
            limitation = "receiver-context-empty"
        elif not source_space_id:
            compatible_context_ids = []
            limitation = "source-embedding-space-unknown"
        else:
            compatible_context_ids = [
                receiver_id for receiver_id in receiver_context_ids
                if chunks[receiver_id].space_id == source_space_id
            ]
            limitation = None if compatible_context_ids else "no-compatible-receiver-space"

        if limitation:
            routing_receipts.append({
                "chunk_id": cid,
                "source_space_id": source_space_id,
                "compatible_receiver_chunk_ids": compatible_context_ids,
                "decision": "full-copy",
                "reason": limitation,
            })
            routing_limitations.append({
                "chunk_id": cid,
                "reason": limitation,
                "decision": "full-copy",
            })
            continue

        max_similarity = max(
            embedding_sim(cid, receiver_id)
            for receiver_id in compatible_context_ids
        )
        decision = "summary" if max_similarity > 0.5 else "full-copy"
        if decision == "summary":
            boundary.add(cid)
        routing_receipts.append({
            "chunk_id": cid,
            "source_space_id": source_space_id,
            "compatible_receiver_chunk_ids": compatible_context_ids,
            "max_similarity": max_similarity,
            "decision": decision,
            "reason": "compatible-space-similarity",
        })
    interior = needed_ids - boundary

    return Handoff(
        handoff_id=new_ulid(),
        from_agent=from_agent.id,
        to_agent=to_agent.id,
        # Interior includes low-overlap, incompatible-space, and empty-context
        # chunks. All are full copies because compression is not evidence-safe.
        full_chunks=[chunks[cid] for cid in interior],
        # Boundary chunks: compressed summary (to_agent can infer the rest)
        summaries=[compress(chunks[cid]) for cid in boundary],
        # Dependency map so to_agent can request more if needed
        dep_map={cid: dep_graph.predecessors(cid) for cid in needed_ids},
        source_hashes={cid: chunks[cid].content_hash for cid in needed_ids},
        embedding_space_ids=sorted({
            chunks[cid].space_id for cid in needed_ids
            if chunks[cid].space_id
        }),
        semantic_routing_receipts=routing_receipts,
        limitations=list_known_gaps(needed_ids) + routing_limitations,
        budget_remaining=to_agent.budget_remaining,
    )
```

**Key principle**: compress chunks that are *near* the partition boundary only
when the source chunk and at least one receiver-context chunk have the same
explicit embedding-space identity. Empty receiver context, missing identity,
or incompatible spaces route to full copy and stay visible in both limitations
and the semantic-routing receipt. Never invent a vector or compare spaces
silently. Low compatible-space overlap also routes to full copy.

### Conversation Completion, Gather, and Handoff Receipts

A partition is incomplete until its conversation protocol is bounded and
replayable. Before fan-out, declare:

- termination limits for messages, wall time, tokens, spend, retries, and idle time;
- a gather policy (`all`, `quorum`, `majority`, `first-valid`, or deadline) and
  how partial or failed children appear in the result;
- delegation-chain cycle detection and the only roles allowed to delegate;
- a kill/cancel signal that every child observes, plus heartbeat/progress cadence;
- working, short-term, episodic, and long-term memory boundaries, including
  what may be persisted, redacted, summarized, or discarded.

Each child produces an attributable handoff/termination receipt: task and
agent ids, source hashes and dependency ids, compatible embedding-space ids,
per-chunk semantic-routing decisions (including empty/incompatible full-copy reasons),
claims supported by evidence, known limitations, budget consumed/remaining,
stop reason, validation, and unresolved work. The parent produces one gather
receipt binding the expected children, receipts received, gather policy,
missing or late results, conflicts, synthesis decision, and final stop reason.
“The agents talked” or “timeout” is not a completion receipt.

---

## Communication Complexity Lower Bound (Yao 1979)

You cannot eliminate all communication if agents' contexts have mutual information.

For agents A (context `C_A`) and B (context `C_B`) jointly answering query `q`:

```
Communication ≥ Ω(I(C_A; C_B | q))
```

where `I` is mutual information. This means:

- **Find partitions that minimize MI across the cut**, not just cosine distance
- **Cosine similarity is a proxy for MI** (valid for normalized Gaussian-ish embeddings)
- **The optimal partition minimizes Σ_{cut edges} I(C_u; C_v | tasks)`

Practically: weight edges by `max(0, cosine_similarity(u, v) - 0.5)` when building the graph for partitioning, rather than raw cosine similarity. This calibrates toward information-theoretic optimality.

---

## Implementation Gap Checklist

Do not infer a framework's current capabilities from this skill. Vendor and
open-source runtimes change quickly; verify their live primary documentation
before making a platform claim. Evaluate the concrete system in front of you
against these falsifiable gaps instead:

1. Is assignment order-dependent, and is there a sequence-stability test?
2. Is cross-agent communication cost modeled or treated as free?
3. Is K selected from task evidence or fixed without a measured reason?
4. Can the partition refine after execution evidence arrives?
5. Are token budgets, causal closure, and handoff receipts enforced?
6. Does every semantic comparison prove a compatible embedding space?

---

## Practical Heuristics (Implementable Today)

1. **Chunk at semantic boundaries** — paragraph breaks, function boundaries, section headers — not fixed token counts. NLTK's `TextTilingTokenizer` or LLM-based segmentation works.

2. **Embed every chunk under an explicit space contract** — use the best
   configured model appropriate to the data, privacy boundary, and latency
   budget. Persist provider, model id, immutable revision, dimensions,
   normalization, distance metric, chunker version, redaction policy, and a
   `space_id` hashed from canonical ordered metadata with every vector. MiniLM is only an explicit
   local/degraded fallback, not a universal canonical model. Reject or re-embed
   incompatible spaces; never compare them silently. Store `(chunk_id,
   embedding, space_id, token_count, dep_set)`.

3. **Maintain the causal dep graph** — as you chunk, record which chunks reference which earlier chunks (via explicit reference or sequential proximity).

4. **Use BIRCH + causal closure for online mode** — O(n) per chunk, handles streaming naturally. Set radius threshold by calibrating on 10 sample chunks (the 75th percentile pairwise distance is a good starting T).

5. **Run 20 EAC trials in background** — every 10 new chunks, run 5 trials and update co_assoc. After 20 background trials, apply any corrections with >50% co_assoc agreement.

6. **Spawn at 20% budget remaining**, not 0% — you need budget for the handoff protocol itself (system prompt for new agent + context copy).

7. **Handoff = admitted summary + dep list** — compress a boundary chunk only
   after a same-space comparison against non-empty receiver context. Send a full
   copy for low overlap, empty receiver context, missing space identity, or
   incompatible spaces, and record the reason in limitations and the receipt.

8. **For static DAGs: METIS then bounded FM refinement** — compare it against
   round-robin and role-based baselines on the actual task corpus. Do not quote
   a universal improvement factor without a reproducible benchmark.

9. **Calibrate ε empirically** — don't use persistent homology unless you truly don't know ε. Run EAC on 50 sample chunks from your domain, find the natural persistence gap in H_0.

10. **BIC threshold of 10** — prevents hair-trigger agent spawning. Only spawn when `BIC(K+1) < BIC(K) - 10`.

11. **Bound every conversation before spawning** — termination, gather policy,
    cycle detection, kill switch, progress cadence, memory boundaries, and
    child/gather receipt schemas are part of the partition plan.

---

## When to Apply Each Algorithm

| Scenario | Algorithm | Why |
|----------|-----------|-----|
| Offline pre-planning, known K | EAC + spectral | Best stability, order-independent |
| Unknown K, unknown ε | Persistent homology | Scale-free, stability-certified |
| High-throughput online | BIRCH + causal closure | O(n), streaming-native |
| Real-time with budget | RANSAC-bootstrap | Confidence-gated, adaptive |
| Static task DAG | METIS + FM | Batch-optimal, graph-aware |
| Dynamic context growth | Streaming Leiden | Local updates, community structure |
| K selection, offline | Gap statistic | Gold standard, well-studied |
| K selection, online | Streaming BIC | Incremental, scalable |

---

## Key Papers

- **EAC**: Fred & Jain, "Data Clustering Using Evidence Accumulation", ICPR 2002
- **Persistent Homology**: Edelsbrunner & Harer, "Computational Topology", 2010; Carlsson, "Topology and Data", AMS 2009
- **METIS**: Karypis & Kumar, "A Fast and High Quality Multilevel Scheme for Partitioning Irregular Graphs", SIAM 1998
- **FM Algorithm**: Fiduccia & Mattheyses, "A Linear-Time Heuristic for Improving Network Partitions", DAC 1982
- **Gap Statistic**: Tibshirani, Walther, Hastie, "Estimating the Number of Clusters in a Data Set via the Gap Statistic", JRSS-B 2001
- **BIRCH**: Zhang, Ramakrishnan, Livny, "BIRCH: An Efficient Data Clustering Method for Very Large Databases", SIGMOD 1996
- **Communication Complexity**: Yao, "Some Complexity Questions Related to Distributive Computing", STOC 1979
- **Leiden**: Traag, Waltman, van Eck, "From Louvain to Leiden: Guaranteeing Well-Connected Communities", Scientific Reports 2019
- **Kraskov MI Estimator**: Kraskov, Stögbauer, Grassberger, "Estimating Mutual Information", Physical Review E 2004
- **LLMLingua**: Jiang et al., "LLMLingua: Compressing Prompts for Accelerated Inference of Large Language Models", EMNLP 2023
- **HyperTree Planning**: Chen et al., 2025 (structures agent reasoning as hypergraph; hyperedge cut generalizes standard partitioning)
- **Dynamic LLM-Agent Network**: Liu et al. 2024 (k-NN graph structure for agent communication topology)
