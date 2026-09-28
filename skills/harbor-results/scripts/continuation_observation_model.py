"""Finite, import-safe unknown-effect continuation checker.

Run directly for deterministic JSON evidence.  This is a one-work-unit model,
not a remote service implementation or an unbounded protocol proof.
"""

from collections import deque
from dataclasses import dataclass, replace
import json


@dataclass(frozen=True)
class State:
    intent: bool = False
    old_sent: bool = False
    old_pending: bool = False
    old_done: bool = False
    old_result: bool = False
    crashed: bool = False
    epoch: int = 0
    remote_fence: bool = False
    observed: str = "unknown"  # unknown, absent, present
    retry_sent: bool = False
    retry_pending: bool = False
    retry_done: bool = False
    effects: int = 0
    dedup: tuple = ()
    local_receipt: bool = False
    stopped: bool = False
    dropped: bool = False


def successors(s, adapter, mutant=None):
    """Atomic transitions; requests in transit remain pending after a crash."""
    if not s.intent:
        yield "persist outbox intent(op=O,key=K)", replace(s, intent=True)
        return
    if not s.old_sent:
        yield "send epoch-0 call(O,K)", replace(s, old_sent=True, old_pending=True)
    if s.old_sent and not s.crashed:
        yield "caller crashes (durable state survives)", replace(s, crashed=True)
    if s.old_pending:
        yield "network loses old call before remote admission", replace(
            s, old_pending=False, old_done=True)
        admitted = not s.remote_fence or mutant == "stale_epoch"
        if admitted:
            if adapter == "dedup" and "K" in s.dedup:
                t = replace(s, old_pending=False, old_done=True, old_result=True)
                label = "remote returns stored result to old call"
            elif adapter == "dedup":
                t = replace(s, old_pending=False, old_done=True, old_result=True,
                            effects=s.effects + 1, dedup=("K",))
                label = "remote commits old call (ack may be lost)"
            else:
                t = replace(s, old_pending=False, old_done=True, old_result=True,
                            effects=s.effects + 1)
                label = "remote commits old call (ack may be lost)"
            yield label, t
        else:
            yield "remote rejects fenced epoch-0 call", replace(
                s, old_pending=False, old_done=True)
    if s.crashed and s.epoch == 0:
        # For readback this is a *remote*, durable fence, ordered with effects.
        # For other adapters it is only the successor assignment.
        yield "promote epoch 1 and install remote fence" if adapter == "readback" else "promote epoch 1", replace(
            s, epoch=1, remote_fence=adapter == "readback",
            observed="unknown")
    if ((adapter == "readback" or mutant == "absence_only") and
            s.epoch == 1 and s.observed == "unknown" and not s.local_receipt):
        yield "linearizable readback: " + ("present" if s.effects else "absent"), replace(
            s, observed="present" if s.effects else "absent")
    if s.epoch == 1 and s.observed == "present" and not s.local_receipt:
        yield "persist reconciled result receipt", replace(s, local_receipt=True)
    if s.epoch == 1 and not s.retry_sent and not s.stopped and not s.local_receipt:
        can_retry = (adapter == "dedup" or
                     adapter == "readback" and s.observed == "absent" and s.remote_fence or
                     mutant == "absence_only" and s.observed == "absent")
        if can_retry:
            key = "J" if mutant == "changed_key" else "K"
            yield f"send epoch-1 retry(O,{key})", replace(
                s, retry_sent=True, retry_pending=True)
        elif adapter == "none" and mutant is None:
            yield "stop for external reconciliation", replace(s, stopped=True)
    if s.retry_pending:
        key = "J" if mutant == "changed_key" else "K"
        if adapter == "dedup" and key in s.dedup:
            t = replace(s, retry_pending=False, retry_done=True)
            yield "remote returns stored result without effect", t
        elif adapter == "dedup":
            t = replace(s, retry_pending=False, retry_done=True,
                        effects=s.effects + 1, dedup=tuple(sorted(s.dedup + (key,))))
            yield "remote commits retry and atomic dedup result", t
        else:
            yield "remote commits retry", replace(
                s, retry_pending=False, retry_done=True, effects=s.effects + 1)
    if mutant == "early_drop" and adapter == "dedup" and s.dedup and not s.dropped:
        yield "evict dedup record while retry remains admissible", replace(
            s, dedup=(), dropped=True)
    if s.retry_done and not s.local_receipt:
        yield "persist successor result receipt", replace(s, local_receipt=True)
    if s.old_result and not s.crashed and not s.local_receipt:
        yield "persist original result receipt", replace(s, local_receipt=True)


def explore(adapter, mutant=None):
    start = State()
    queue = deque([(start, ())])
    visited = {start}
    crimes = []
    while queue:
        state, trace = queue.popleft()
        assert not state.local_receipt or state.effects >= 1
        if state.effects > 1:
            crimes.append(trace)
            break  # BFS: first witness has minimum transition length.
        for label, nxt in successors(state, adapter, mutant):
            if nxt not in visited:
                visited.add(nxt)
                queue.append((nxt, trace + (label,)))
    return {"states": len(visited), "safe": not crimes,
            "shortest_violation": list(crimes[0]) if crimes else None}


def observation_class(s):
    """Caller-visible evidence deliberately omits pending transit and effect truth."""
    return (s.intent, s.crashed, s.epoch, s.remote_fence, s.observed,
            s.retry_sent, s.local_receipt, s.stopped)


def indistinguishability_witness():
    # Find two reachable worlds with the same caller evidence.  One retains
    # an unseen call that can commit after a negative read.
    queue = deque([(State(), ())])
    seen = {State()}
    classes = {}
    while queue:
        state, trace = queue.popleft()
        assert not state.local_receipt or state.effects >= 1
        if (state.observed == "absent" and state.epoch == 1 and
                state.effects == 0 and not state.retry_sent):
            classes.setdefault(observation_class(state), {})[state.old_pending] = trace
        for label, nxt in successors(state, "none", "absence_only"):
            if nxt not in seen:
                seen.add(nxt)
                queue.append((nxt, trace + (label,)))
    matching = [(obs, pair) for obs, pair in classes.items()
                if True in pair and False in pair]
    assert matching
    observation, pair = min(matching, key=lambda item:
                            len(item[1][True]) + len(item[1][False]))
    assert "network loses old call before remote admission" in pair[False]
    assert "network loses old call before remote admission" not in pair[True]
    assert all("retry" not in step for trace in pair.values() for step in trace)
    return {"observation": list(observation),
            "hidden_worlds": ["old call pending", "old call lost"],
            "pending_trace": list(pair[True]), "lost_trace": list(pair[False]),
            "safe_policy_examples_without_fence_or_dedup":
            ["never resend; wait for authoritative evidence",
             "stop and reconcile"]}


def run():
    honest = {a: explore(a) for a in ("dedup", "readback", "none")}
    mutants = {
        "absence_only": explore("none", "absence_only"),
        "stale_epoch": explore("readback", "stale_epoch"),
        "changed_key": explore("dedup", "changed_key"),
        "early_drop": explore("dedup", "early_drop"),
    }
    assert all(v["safe"] for v in honest.values())
    assert all(not v["safe"] for v in mutants.values())
    expected = {
        "absence_only": (8, "linearizable readback: absent", "remote commits old call (ack may be lost)"),
        "stale_epoch": (8, "promote epoch 1 and install remote fence", "remote commits old call (ack may be lost)"),
        "changed_key": (7, "send epoch-1 retry(O,J)", "remote commits retry and atomic dedup result"),
        "early_drop": (8, "evict dedup record while retry remains admissible", "remote commits retry and atomic dedup result"),
    }
    for name, (length, before, after) in expected.items():
        trace = mutants[name]["shortest_violation"]
        assert len(trace) == length and trace.index(before) < trace.index(after), name
    return {"scope": "one operation; two epochs; at most old and retry calls",
            "honest": honest, "mutations": mutants,
            "indistinguishability": indistinguishability_witness()}


if __name__ == "__main__":
    print(json.dumps(run(), indent=2, sort_keys=True))
