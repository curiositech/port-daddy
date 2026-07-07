"""
dag_partitioner.py — Token-aware DAG chain decomposition for multi-agent execution.

Finds the minimum-cost assignment of DAG nodes to agent runs, where:
  - Nodes on the same chain share one agent (zero handoff cost between them)
  - Edges crossing chains incur C_handoff tokens
  - Each chain must fit within a context window budget

Algorithm:
  1. Dilworth chain decomposition (minimum # of chains = max antichain size)
  2. Token-budget-aware chain splitting
  3. Simple Fiduccia-Mattheyses refinement to minimize cross-chain edges

Dependencies: stdlib only (no networkx, no numpy).
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, FrozenSet, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class TaskNode:
    id: str
    token_cost: int             # estimated tokens for this task
    skill_tags: List[str]       # semantic tags for routing heuristics
    description: str = ""


@dataclass
class DAGEdge:
    src: str
    dst: str
    handoff_tokens: int = 2000  # cost to transfer context across this edge


@dataclass
class AgentRun:
    """One agent's execution — an ordered chain of task nodes."""
    agent_id: int
    nodes: List[str]            # in topological order
    total_tokens: int = 0
    incoming_handoffs: List[str] = field(default_factory=list)  # source agent IDs
    outgoing_handoffs: List[str] = field(default_factory=list)  # dest agent IDs


@dataclass
class ExecutionPlan:
    agent_runs: List[AgentRun]
    total_cost: int
    n_handoffs: int
    critical_path_length: int

    def summarize(self) -> str:
        lines = [
            f"Execution Plan: {len(self.agent_runs)} agents, "
            f"{self.n_handoffs} handoffs, "
            f"{self.total_cost:,} total tokens",
            f"Critical path: {self.critical_path_length} nodes",
        ]
        for run in self.agent_runs:
            lines.append(f"  Agent {run.agent_id}: {' → '.join(run.nodes)}"
                         f" ({run.total_tokens:,} tok)")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Core graph utilities (stdlib only)
# ---------------------------------------------------------------------------

class DAG:
    def __init__(self):
        self.nodes: Dict[str, TaskNode] = {}
        self.succ:  Dict[str, Set[str]] = {}  # out-edges
        self.pred:  Dict[str, Set[str]] = {}  # in-edges
        self.edge_cost: Dict[Tuple[str, str], int] = {}

    def add_node(self, node: TaskNode) -> None:
        self.nodes[node.id] = node
        self.succ.setdefault(node.id, set())
        self.pred.setdefault(node.id, set())

    def add_edge(self, edge: DAGEdge) -> None:
        self.succ.setdefault(edge.src, set()).add(edge.dst)
        self.pred.setdefault(edge.dst, set()).add(edge.src)
        self.succ.setdefault(edge.src, set())
        self.pred.setdefault(edge.dst, set())
        self.edge_cost[(edge.src, edge.dst)] = edge.handoff_tokens

    def topological_order(self) -> List[str]:
        in_degree = {n: len(self.pred.get(n, set())) for n in self.nodes}
        queue = [n for n, d in in_degree.items() if d == 0]
        order = []
        while queue:
            queue.sort()  # deterministic order within same in-degree level
            node = queue.pop(0)
            order.append(node)
            for succ in sorted(self.succ.get(node, set())):
                in_degree[succ] -= 1
                if in_degree[succ] == 0:
                    queue.append(succ)
        if len(order) != len(self.nodes):
            raise ValueError("DAG contains a cycle")
        return order

    def critical_path_length(self) -> int:
        """Number of nodes on the longest path."""
        topo = self.topological_order()
        dp: Dict[str, int] = {n: 1 for n in self.nodes}
        for node in topo:
            for succ in self.succ.get(node, set()):
                dp[succ] = max(dp[succ], dp[node] + 1)
        return max(dp.values()) if dp else 0

    def all_pairs_reachable(self) -> Dict[str, Set[str]]:
        """Transitive closure via DFS from each node."""
        reach: Dict[str, Set[str]] = {}
        for start in self.nodes:
            visited = set()
            stack = list(self.succ.get(start, set()))
            while stack:
                n = stack.pop()
                if n not in visited:
                    visited.add(n)
                    stack.extend(self.succ.get(n, set()) - visited)
            reach[start] = visited
        return reach


# ---------------------------------------------------------------------------
# 1. Dilworth chain decomposition via bipartite matching
# ---------------------------------------------------------------------------

def _max_bipartite_matching(
    left_nodes: List[str],
    right_nodes: List[str],
    edges: Set[Tuple[str, str]],
) -> Dict[str, str]:
    """
    Augmenting-path bipartite matching (Hopcroft-Karp simplified).
    Returns left → right matching.
    """
    match_l: Dict[str, Optional[str]] = {n: None for n in left_nodes}
    match_r: Dict[str, Optional[str]] = {n: None for n in right_nodes}
    adj: Dict[str, List[str]] = {n: [] for n in left_nodes}
    for (l, r) in edges:
        adj[l].append(r)

    def try_augment(u: str, visited: Set[str]) -> bool:
        for v in adj[u]:
            if v not in visited:
                visited.add(v)
                if match_r[v] is None or try_augment(match_r[v], visited):
                    match_l[u] = v
                    match_r[v] = u
                    return True
        return False

    for u in left_nodes:
        try_augment(u, set())

    return {l: r for l, r in match_l.items() if r is not None}


def dilworth_chain_decomposition(dag: DAG) -> List[List[str]]:
    """
    Minimum chain cover of a DAG via Dilworth's theorem.

    Constructs a bipartite graph where (u_out, v_in) is an edge iff u can
    reach v. Maximum matching = maximum set of covered nodes; chains are
    extracted by following matched edges.

    Returns: list of chains (each chain = ordered list of node IDs)
    """
    reach = dag.all_pairs_reachable()
    topo  = dag.topological_order()

    # Build bipartite graph: left = "out-copy", right = "in-copy"
    left  = [f"{n}_out" for n in topo]
    right = [f"{n}_in"  for n in topo]
    edges: Set[Tuple[str, str]] = set()
    for u in topo:
        for v in reach[u]:
            edges.add((f"{u}_out", f"{v}_in"))

    matching = _max_bipartite_matching(left, right, edges)
    # matching: u_out → v_in means u is immediately followed by v in a chain

    next_in_chain: Dict[str, str] = {}
    for l, r in matching.items():
        u = l[:-4]  # strip "_out"
        v = r[:-3]  # strip "_in"
        next_in_chain[u] = v

    chain_starts = set(topo) - set(next_in_chain.values())
    chains: List[List[str]] = []
    for start in sorted(chain_starts):
        chain = [start]
        cur = start
        while cur in next_in_chain:
            cur = next_in_chain[cur]
            chain.append(cur)
        chains.append(chain)

    return chains


# ---------------------------------------------------------------------------
# 2. Token-budget-aware chain splitting
# ---------------------------------------------------------------------------

def split_chains_by_budget(
    dag: DAG,
    chains: List[List[str]],
    window_tokens: int,
    safety_factor: float = 0.70,
    c_inject: int = 6000,
) -> List[List[str]]:
    """
    If a chain's total token cost exceeds window_tokens * safety_factor,
    split it into sub-chains that each fit within budget.

    c_inject: tokens consumed by preamble/system prompt at the start of a new
              agent (the "spawn cost" paid even on a continuation chain).
    """
    budget = int(window_tokens * safety_factor)
    result: List[List[str]] = []

    for chain in chains:
        current_run: List[str] = []
        current_cost = c_inject  # pay spawn cost at the start of each run

        for node_id in chain:
            cost = dag.nodes[node_id].token_cost
            if current_cost + cost > budget and current_run:
                result.append(current_run)
                current_run = [node_id]
                current_cost = c_inject + cost
            else:
                current_run.append(node_id)
                current_cost += cost

        if current_run:
            result.append(current_run)

    return result


# ---------------------------------------------------------------------------
# 3. FM refinement — reduce cross-chain edges
# ---------------------------------------------------------------------------

def fm_refinement(
    dag: DAG,
    chains: List[List[str]],
    window_tokens: int,
    safety_factor: float = 0.70,
    max_passes: int = 20,
) -> List[List[str]]:
    """
    Fiduccia-Mattheyses single-pass: move boundary nodes between chains to
    reduce the number of cross-chain edges (handoff cost), respecting token
    budget constraints.

    Only moves that maintain topological validity (no dependency violations)
    are accepted.
    """
    budget = int(window_tokens * safety_factor)
    assign: Dict[str, int] = {}
    for ci, chain in enumerate(chains):
        for nid in chain:
            assign[nid] = ci

    chain_tokens: Dict[int, int] = {}
    for ci, chain in enumerate(chains):
        chain_tokens[ci] = sum(dag.nodes[n].token_cost for n in chain)

    def cross_edges() -> int:
        return sum(1 for (u, v) in dag.edge_cost
                   if assign[u] != assign[v])

    def can_move(nid: str, from_c: int, to_c: int) -> bool:
        cost = dag.nodes[nid].token_cost
        if chain_tokens[to_c] + cost > budget:
            return False
        # Moving would create a dep violation if any predecessor of nid is in
        # another chain that doesn't precede to_c in execution order
        for pred in dag.pred.get(nid, set()):
            if assign[pred] != to_c and assign[pred] != from_c:
                return False
        for succ in dag.succ.get(nid, set()):
            if assign[succ] != to_c and assign[succ] != from_c:
                return False
        return True

    for _ in range(max_passes):
        improved = False
        for nid in dag.topological_order():
            from_c = assign[nid]
            best_gain, best_c = 0, -1
            for to_c in range(len(chains)):
                if to_c == from_c:
                    continue
                if not can_move(nid, from_c, to_c):
                    continue
                # gain = reduction in cross-chain edges after this move
                gain = sum(
                    1 for neighbor in list(dag.succ.get(nid, set())) +
                                       list(dag.pred.get(nid, set()))
                    if assign[neighbor] == to_c
                ) - sum(
                    1 for neighbor in list(dag.succ.get(nid, set())) +
                                       list(dag.pred.get(nid, set()))
                    if assign[neighbor] == from_c and neighbor != nid
                )
                if gain > best_gain:
                    best_gain, best_c = gain, to_c

            if best_c != -1:
                chain_tokens[from_c] -= dag.nodes[nid].token_cost
                chain_tokens[best_c] += dag.nodes[nid].token_cost
                assign[nid] = best_c
                improved = True

        if not improved:
            break

    # Reconstruct chains from assignment, preserving topological order
    topo = dag.topological_order()
    chain_map: Dict[int, List[str]] = {}
    for nid in topo:
        c = assign[nid]
        chain_map.setdefault(c, []).append(nid)

    return list(chain_map.values())


# ---------------------------------------------------------------------------
# 4. Main entry point
# ---------------------------------------------------------------------------

def partition_dag(
    dag: DAG,
    window_tokens: int = 150_000,
    c_spawn: int = 8_000,
    c_handoff: int = 4_000,
    safety_factor: float = 0.70,
    fm_passes: int = 20,
) -> ExecutionPlan:
    """
    Full pipeline:
      1. Dilworth chain decomposition
      2. Budget-constrained splitting
      3. FM refinement
      4. Build execution plan with handoff annotations
    """
    chains = dilworth_chain_decomposition(dag)
    chains = split_chains_by_budget(dag, chains, window_tokens, safety_factor, c_spawn)
    chains = fm_refinement(dag, chains, window_tokens, safety_factor, fm_passes)

    assign = {nid: ci for ci, chain in enumerate(chains) for nid in chain}

    # Build AgentRun objects
    runs: List[AgentRun] = []
    for ci, chain in enumerate(chains):
        total = sum(dag.nodes[n].token_cost for n in chain) + c_spawn
        run = AgentRun(agent_id=ci, nodes=chain, total_tokens=total)
        runs.append(run)

    # Annotate handoffs
    n_handoffs = 0
    for (u, v) in dag.edge_cost:
        if assign[u] != assign[v]:
            runs[assign[u]].outgoing_handoffs.append(str(assign[v]))
            runs[assign[v]].incoming_handoffs.append(str(assign[u]))
            n_handoffs += 1

    total_cost = (
        sum(r.total_tokens for r in runs)
        + n_handoffs * c_handoff
    )

    return ExecutionPlan(
        agent_runs=runs,
        total_cost=total_cost,
        n_handoffs=n_handoffs,
        critical_path_length=dag.critical_path_length(),
    )


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    dag = DAG()
    for nid, cost, tags in [
        ('design_schema',    3000, ['architecture']),
        ('write_migration',  4000, ['database']),
        ('implement_model',  8000, ['backend']),
        ('write_api',       12000, ['backend']),
        ('write_tests',      6000, ['testing']),
        ('write_docs',       3000, ['docs']),
        ('implement_ui',    15000, ['frontend']),
        ('ui_tests',         5000, ['testing']),
        ('integration_test', 7000, ['testing']),
        ('deploy',           2000, ['infra']),
    ]:
        dag.add_node(TaskNode(id=nid, token_cost=cost, skill_tags=tags))

    for src, dst in [
        ('design_schema',    'write_migration'),
        ('write_migration',  'implement_model'),
        ('implement_model',  'write_api'),
        ('write_api',        'write_tests'),
        ('write_api',        'write_docs'),
        ('write_api',        'implement_ui'),
        ('implement_ui',     'ui_tests'),
        ('write_tests',      'integration_test'),
        ('ui_tests',         'integration_test'),
        ('integration_test', 'deploy'),
    ]:
        dag.add_edge(DAGEdge(src=src, dst=dst))

    plan = partition_dag(dag, window_tokens=30_000)
    print(plan.summarize())
