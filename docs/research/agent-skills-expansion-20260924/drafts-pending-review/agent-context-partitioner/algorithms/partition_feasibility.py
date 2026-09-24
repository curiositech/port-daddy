"""Deterministic proposal-only assignment against an explicit target inventory.

This does not discover missing context, select worker count, create a worker,
write successor prompts, or authorize runtime effects. FEASIBLE means only that
the supplied items fit the supplied targets and constraints.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Mapping, FrozenSet, Sequence

@dataclass(frozen=True)
class Item:
    id: str
    tokens: int
    capabilities: FrozenSet[str] = frozenset()
    audiences: FrozenSet[str] = frozenset()
    parents: tuple[str, ...] = ()

@dataclass(frozen=True)
class Target:
    id: str
    token_capacity: int
    capabilities: FrozenSet[str] = frozenset()
    audiences: FrozenSet[str] = frozenset()
    known: bool = True

@dataclass(frozen=True)
class Proposal:
    status: str
    assignments: Mapping[str, str]
    transfers: tuple[tuple[str, str, str], ...]
    gaps: tuple[str, ...]


def propose(items: Sequence[Item], targets: Sequence[Target], *, inventory_complete: bool) -> Proposal:
    """Assign known required items; dependencies crossing targets are explicit transfers.

    Stable tie order: maximize already-placed parent locality, then minimize
    projected target utilization, then target ID. This is a deterministic
    heuristic, not an optimal partition solver.
    """
    if not inventory_complete or any(not t.known for t in targets):
        return Proposal("UNKNOWN", {}, (), ("target or item inventory is incomplete",))
    if len({i.id for i in items}) != len(items) or len({t.id for t in targets}) != len(targets):
        return Proposal("INFEASIBLE", {}, (), ("duplicate item or target ID",))
    by_id = {i.id: i for i in items}
    if not items:
        return Proposal("FEASIBLE", {}, (), ())
    missing = sorted({p for i in items for p in i.parents if p not in by_id})
    if missing:
        return Proposal("UNKNOWN", {}, (), tuple(f"missing parent evidence: {x}" for x in missing))
    indegree = {i.id: len(set(i.parents)) for i in items}
    children = {i.id: [] for i in items}
    for i in items:
        for p in set(i.parents): children[p].append(i.id)
    ready = sorted(x for x, n in indegree.items() if n == 0)
    order: list[str] = []
    while ready:
        cur = ready.pop(0); order.append(cur)
        for child in sorted(children[cur]):
            indegree[child] -= 1
            if indegree[child] == 0:
                ready.append(child); ready.sort()
    if len(order) != len(items):
        return Proposal("INFEASIBLE", {}, (), ("dependency cycle",))
    used = {t.id: 0 for t in targets}
    target_by_id = {t.id: t for t in targets}
    assigned: dict[str, str] = {}
    for ident in order:
        item = by_id[ident]
        candidates = [t for t in targets
            if item.capabilities <= t.capabilities
            and (not item.audiences or item.audiences <= t.audiences)
            and used[t.id] + item.tokens <= t.token_capacity]
        if not candidates:
            return Proposal("INFEASIBLE", assigned, (), (f"no compatible capacity for {ident}",))
        candidates.sort(key=lambda t: (-sum(assigned.get(p) == t.id for p in item.parents),
                                       used[t.id] + item.tokens, t.id))
        chosen = candidates[0]
        assigned[ident] = chosen.id; used[chosen.id] += item.tokens
    transfers = tuple(sorted((p, assigned[p], assigned[i.id])
        for i in items for p in set(i.parents) if assigned[p] != assigned[i.id]))
    return Proposal("FEASIBLE", dict(assigned), transfers, ())
