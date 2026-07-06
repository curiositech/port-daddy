"""
online_k_selector.py — Online K(t) selection for multi-agent context partitioning.

Two decision engines:
  1. TokenPressureMonitor: tracks budget velocity and fires spawn signals
  2. ConsensusPartitioner: EAC-style order-stable assignment of pending tasks to agents

Dependencies: numpy only (stdlib otherwise).
"""

from __future__ import annotations
import math
import random
import time
from collections import deque
from dataclasses import dataclass, field
from typing import List, Optional, Tuple


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class ContextChunk:
    id: str
    embedding: List[float]   # normalized unit vector
    token_count: int
    dep_set: List[str]       # IDs of chunks this chunk depends on
    created_at: float = field(default_factory=time.time)


@dataclass
class AgentSlot:
    id: str
    tokens_used: int = 0
    window: int = 200_000
    chunks: List[str] = field(default_factory=list)

    @property
    def headroom(self) -> float:
        return 1.0 - self.tokens_used / self.window

    @property
    def tokens_remaining(self) -> int:
        return self.window - self.tokens_used


@dataclass
class SpawnDecision:
    action: str          # 'continue' | 'compact' | 'spawn' | 'handoff'
    urgency: float       # 0.0–1.0
    reason: str
    recommended_handoff_chunks: List[str] = field(default_factory=list)
    estimated_new_k: int = 1


# ---------------------------------------------------------------------------
# 1. Token Pressure Monitor
# ---------------------------------------------------------------------------

class TokenPressureMonitor:
    """
    Tracks token velocity and fires spawn signals at configurable thresholds.
    Uses a sliding window for velocity estimation.

    Port Daddy integration: call report() after each agent turn; subscribe to
    get_decision() to gate task dispatch.
    """

    ADVISORY  = 0.70   # first warning
    WARNING   = 0.85   # begin dump prep
    CRITICAL  = 0.95   # force action
    EMERGENCY = 0.99   # last resort compact

    # Cost constants (token estimates, tune per backend)
    C_SPAWN    = 8_000  # system prompt + preamble injection
    C_HANDOFF  = 4_000  # knowledge dump write + read
    C_COMPACT  = 2_000  # tokens lost to auto-compaction summary

    def __init__(self, window_size: int = 200_000, velocity_window_sec: float = 300.0):
        self.window_size = window_size
        self.velocity_window_sec = velocity_window_sec
        self._history: deque[Tuple[float, int]] = deque()  # (timestamp, tokens_used)
        self.compaction_count = 0

    def report(self, tokens_used: int) -> None:
        self._history.append((time.time(), tokens_used))
        cutoff = time.time() - self.velocity_window_sec
        while self._history and self._history[0][0] < cutoff:
            self._history.popleft()

    def velocity(self) -> float:
        """Tokens per second over the sliding window."""
        if len(self._history) < 2:
            return 0.0
        t0, v0 = self._history[0]
        t1, v1 = self._history[-1]
        dt = t1 - t0
        if dt < 1.0:
            return 0.0
        return (v1 - v0) / dt

    def time_to_exhaustion_sec(self, current_tokens: int) -> float:
        """Estimated seconds until window is full at current velocity."""
        v = self.velocity()
        if v <= 0:
            return float('inf')
        remaining = self.window_size - current_tokens
        return remaining / v

    def pressure(self, current_tokens: int) -> float:
        """0.0 = empty, 1.0 = full."""
        return current_tokens / self.window_size

    def get_decision(
        self,
        current_tokens: int,
        pending_task_tokens: int,
        n_pending_tasks: int,
    ) -> SpawnDecision:
        """
        Main decision gate. Call before dispatching a new task to an agent.
        """
        p = self.pressure(current_tokens)
        remaining = self.window_size - current_tokens
        tte = self.time_to_exhaustion_sec(current_tokens)

        # Velocity-adjusted future pressure
        velocity_factor = min(2.0, 1.0 + self.velocity() / 500.0)
        effective_future = pending_task_tokens * velocity_factor

        # Case 1: Comfortable
        if p < self.ADVISORY and remaining > effective_future * 1.2:
            return SpawnDecision(
                action='continue',
                urgency=p,
                reason=f"{p:.0%} used, {remaining:,} tokens remaining"
            )

        # Case 2: Can't even handoff safely
        if remaining < self.C_HANDOFF + self.C_SPAWN:
            return SpawnDecision(
                action='compact',
                urgency=0.99,
                reason=f"Insufficient headroom ({remaining:,}) for handoff ({self.C_HANDOFF + self.C_SPAWN:,})"
            )

        # Case 3: Emergency threshold
        if p >= self.EMERGENCY:
            return SpawnDecision(
                action='compact',
                urgency=1.0,
                reason=f"Emergency: {p:.0%} used"
            )

        # Case 4: Critical — must act
        if p >= self.CRITICAL:
            urgency = 0.95
            if effective_future > remaining - self.C_HANDOFF:
                return SpawnDecision(
                    action='handoff',
                    urgency=urgency,
                    reason=f"Critical: future work ({effective_future:,.0f} tok) exceeds headroom",
                    estimated_new_k=max(1, math.ceil(effective_future / (self.window_size * 0.6)))
                )
            return SpawnDecision(action='compact', urgency=urgency,
                                 reason=f"Critical: {p:.0%} used, compacting to continue")

        # Case 5: Warning zone — prefer spawn over compact if tasks are disjoint
        if p >= self.WARNING:
            cost_compact = self.C_COMPACT
            cost_spawn   = self.C_SPAWN + self.C_HANDOFF
            action = 'compact' if cost_compact < cost_spawn and remaining > effective_future * 0.5 else 'spawn'
            return SpawnDecision(
                action=action,
                urgency=0.8,
                reason=f"Warning: {p:.0%} used, {n_pending_tasks} tasks pending",
                estimated_new_k=max(1, math.ceil(n_pending_tasks / 3))
            )

        # Case 6: Advisory — monitor but continue
        return SpawnDecision(
            action='continue',
            urgency=p,
            reason=f"Advisory: {p:.0%} used, velocity {self.velocity():.0f} tok/s, ETE {tte/60:.0f}m"
        )


# ---------------------------------------------------------------------------
# 2. Consensus Partitioner (EAC-style, order-stable)
# ---------------------------------------------------------------------------

def _cosine_sim(a: List[float], b: List[float]) -> float:
    dot  = sum(x * y for x, y in zip(a, b))
    na   = math.sqrt(sum(x * x for x in a))
    nb   = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _build_dep_graph(chunks: List[ContextChunk]) -> dict[str, set[str]]:
    id_set = {c.id for c in chunks}
    return {c.id: {d for d in c.dep_set if d in id_set} for c in chunks}


def _greedy_assign(
    chunks: List[ContextChunk],
    K: int,
    token_budget: int,
    order: List[int],
) -> dict[str, int]:
    """Single greedy pass in a given chunk ordering. Returns chunk_id → agent_id."""
    centroids: List[List[float]] = []
    agent_tokens: List[int] = []
    assignment: dict[str, int] = {}

    for idx in order:
        c = chunks[idx]
        best_agent = -1
        best_sim = -1.0

        for a_id, centroid in enumerate(centroids):
            if agent_tokens[a_id] + c.token_count > token_budget:
                continue
            sim = _cosine_sim(c.embedding, centroid)
            if sim > best_sim:
                best_sim = sim
                best_agent = a_id

        if best_agent == -1 and len(centroids) < K:
            # New agent slot
            best_agent = len(centroids)
            centroids.append(list(c.embedding))
            agent_tokens.append(0)

        if best_agent == -1:
            # All slots full and over budget — join closest regardless
            best_agent = min(range(len(centroids)),
                             key=lambda a: -_cosine_sim(c.embedding, centroids[a]))

        # Update centroid (running mean)
        n = agent_tokens[best_agent]  # tokens as a proxy for count
        for j in range(len(c.embedding)):
            centroids[best_agent][j] = (centroids[best_agent][j] * n
                                        + c.embedding[j] * c.token_count) / (n + c.token_count + 1)
        agent_tokens[best_agent] += c.token_count
        assignment[c.id] = best_agent

    return assignment


def _enforce_causal_closure(
    assignment: dict[str, int],
    dep_graph: dict[str, set[str]],
    chunks_by_id: dict[str, ContextChunk],
    token_budget: int,
) -> dict[str, int]:
    """
    Merge agents that violate causal ordering.
    If j depends on i but assignment[j] != assignment[i], either merge their
    agents (if budgets allow) or mark i as shared (copied to j's agent).
    """
    agent_tokens: dict[int, int] = {}
    for cid, aid in assignment.items():
        agent_tokens[aid] = agent_tokens.get(aid, 0) + chunks_by_id[cid].token_count

    changed = True
    while changed:
        changed = False
        for cid, deps in dep_graph.items():
            for dep_id in deps:
                if assignment.get(dep_id) != assignment.get(cid):
                    a_cid = assignment[cid]
                    a_dep = assignment[dep_id]
                    combined = agent_tokens.get(a_cid, 0) + agent_tokens.get(a_dep, 0)
                    if combined <= token_budget:
                        # Merge: reassign all of a_dep's chunks to a_cid
                        for other_id, other_aid in assignment.items():
                            if other_aid == a_dep:
                                assignment[other_id] = a_cid
                        agent_tokens[a_cid] = combined
                        agent_tokens.pop(a_dep, None)
                        changed = True
                        break
            if changed:
                break
    return assignment


def consensus_partition(
    chunks: List[ContextChunk],
    K: int,
    token_budget: int,
    n_trials: int = 30,
) -> dict[str, int]:
    """
    EAC-style consensus clustering for context chunks.
    Runs n_trials greedy assignments with shuffled orderings, builds a
    co-association matrix, and returns the stable majority-vote partition.

    Respects causal ordering via enforce_causal_closure.

    Returns: dict mapping chunk_id → agent_id (0-indexed)
    """
    n = len(chunks)
    if n == 0:
        return {}
    if n == 1:
        return {chunks[0].id: 0}

    dep_graph  = _build_dep_graph(chunks)
    chunks_by_id = {c.id: c for c in chunks}
    co_assoc = [[0] * n for _ in range(n)]
    idx_of   = {c.id: i for i, c in enumerate(chunks)}

    for _ in range(n_trials):
        order = list(range(n))
        random.shuffle(order)
        asgn = _greedy_assign(chunks, K, token_budget, order)
        asgn = _enforce_causal_closure(asgn, dep_graph, chunks_by_id, token_budget)

        for i, ci in enumerate(chunks):
            for j, cj in enumerate(chunks):
                if asgn.get(ci.id) == asgn.get(cj.id):
                    co_assoc[i][j] += 1

    # Normalize
    for i in range(n):
        for j in range(n):
            co_assoc[i][j] /= n_trials

    # Agglomerative clustering on distance = 1 - co_assoc
    # Simple greedy single-linkage (fast, good enough for small n)
    cluster_of = list(range(n))
    n_clusters = n

    while n_clusters > K:
        best_i, best_j, best_sim = -1, -1, -1.0
        for i in range(n):
            for j in range(i + 1, n):
                if cluster_of[i] == cluster_of[j]:
                    continue
                if co_assoc[i][j] > best_sim:
                    best_sim = co_assoc[i][j]
                    best_i, best_j = i, j

        if best_i == -1 or best_sim < 0.01:
            break

        old_c = cluster_of[best_j]
        new_c = cluster_of[best_i]
        for k in range(n):
            if cluster_of[k] == old_c:
                cluster_of[k] = new_c
        n_clusters -= 1

    # Remap to 0-indexed agent IDs
    seen: dict[int, int] = {}
    for i in range(n):
        c = cluster_of[i]
        if c not in seen:
            seen[c] = len(seen)
        cluster_of[i] = seen[c]

    result = {chunks[i].id: cluster_of[i] for i in range(n)}
    return _enforce_causal_closure(result, dep_graph, chunks_by_id, token_budget)


# ---------------------------------------------------------------------------
# 3. Simple demo
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    # Synthetic chunks: 3 tight clusters of 3 + 1 bridge chunk
    def make_chunk(cid, embed, tokens=1000, deps=None):
        return ContextChunk(id=cid, embedding=embed, token_count=tokens,
                            dep_set=deps or [])

    # Cluster A: database-related
    cluster_a = [[0.9, 0.1, 0.0, 0.0],
                 [0.85, 0.15, 0.0, 0.0],
                 [0.88, 0.12, 0.0, 0.0]]
    # Cluster B: frontend-related
    cluster_b = [[0.0, 0.0, 0.9, 0.1],
                 [0.0, 0.0, 0.85, 0.15],
                 [0.0, 0.0, 0.88, 0.12]]
    # Bridge: similar to both A and B
    bridge = [[0.5, 0.1, 0.4, 0.0]]

    chunks = (
        [make_chunk(f'a{i}', e) for i, e in enumerate(cluster_a)] +
        [make_chunk(f'b{i}', e) for i, e in enumerate(cluster_b)] +
        [make_chunk('bridge', bridge[0], deps=['a0', 'b0'])]
    )

    result = consensus_partition(chunks, K=2, token_budget=5000, n_trials=50)
    print("Consensus partition:")
    for cid, aid in sorted(result.items()):
        print(f"  {cid} → agent {aid}")

    # Pressure monitor demo
    mon = TokenPressureMonitor(window_size=200_000)
    for t in [50_000, 80_000, 120_000, 160_000, 175_000]:
        mon.report(t)
        decision = mon.get_decision(t, pending_task_tokens=20_000, n_pending_tasks=5)
        print(f"\n  {t:,} tokens used ({t/200000:.0%}): {decision.action.upper()} — {decision.reason}")
