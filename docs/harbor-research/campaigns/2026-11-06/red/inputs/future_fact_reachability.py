#!/usr/bin/env python3
"""Reachability-derived future admission for a declared finite R17 model.

The model is an explicit graph, not a runtime discovery mechanism. Its exact
keys are schema_version (1), model_id, authority (a source-description string),
initial (nonempty state IDs), states ({id, facts}), and transitions
({id, source, target}). State and transition IDs are unique. Every endpoint
must be declared, including unreachable endpoints. Facts label the CURRENT
state; expired/retracted labels are never accumulated along a path.

The fixed policy uses b4_deontic_fragment.check's six fields: facts, horn,
deontic, claims, nvars, cons. Policy facts are unconditional baseline facts;
a state's effective facts are their union with its current label. This adapter
accepts integer closed intervals and integer difference bounds. Rules, claims,
and constraints cannot change during a run. No negation or disjunction is
admitted. All objects reject unknown keys; set-valued sequences reject repeats.

Explore every reachable state ID and outgoing transition, then discard only
nonmaximal fact SETS before invoking the unchanged R17 checker. This reduction
uses upward-closed conflict under a fixed positive policy, not monotone graph
transitions. It never prunes exploration, identifies control states, or takes
an unreachable union. The reference checker and maximal-set filtering can be
quadratic; no compact reachability or optimized-checker claim is made here.

A safe result requires complete exploration. A concrete unsafe trace remains
valid after a budget stop. Unknown means incomplete with no witnessed conflict.
Budgets bound graph exploration only, not validation, filtering, or checker
runtime; callers must separately bound untrusted input size and policy cost.
Digests bind the declared artifacts, not their truth, authenticity, or coverage.
Runtime admission needs an independent model-conformance/mediation argument.

Import is inert. Public API: analyze(), replay_witness(), model_digest(), and
policy_digest(). Input sequences may be JSON lists or Python tuples; outputs
are deterministic JSON-compatible values. Invalid input raises ValueError.
"""

from collections import deque
import hashlib
import json

import b4_deontic_fragment as r17


PROOF_SCOPE = (
    "Declared finite model only; model authority is a caller declaration. "
    "Digests bind inputs, not runtime completeness or authenticity. "
    "Runtime admission requires independent conformance and complete mediation."
)


def _record(value, keys, where):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError(f"{where}: expected exactly {', '.join(keys)}")
    return value


def _sequence(value, where, length=None):
    if not isinstance(value, (list, tuple)):
        raise ValueError(f"{where}: expected a list or tuple")
    if length is not None and len(value) != length:
        raise ValueError(f"{where}: expected {length} entries")
    return value


def _name(value, where):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{where}: expected a nonempty string")
    return value


def _integer(value, where, minimum=None):
    if type(value) is not int or (minimum is not None and value < minimum):
        raise ValueError(f"{where}: expected an integer"
                         + (f" >= {minimum}" if minimum is not None else ""))
    return value


def _names(value, where):
    names = [_name(item, where) for item in _sequence(value, where)]
    if len(names) != len(set(names)):
        raise ValueError(f"{where}: duplicate entries")
    return sorted(names)


def _interval(value, where):
    lo, hi = _sequence(value, where, 2)
    _integer(lo, where)
    _integer(hi, where)
    if lo > hi:
        raise ValueError(f"{where}: reversed interval")
    return [lo, hi]


def _model(model):
    _record(model, ("schema_version", "model_id", "authority", "initial",
                    "states", "transitions"), "model")
    if type(model["schema_version"]) is not int or model["schema_version"] != 1:
        raise ValueError("model.schema_version: expected 1")
    states = []
    for row in _sequence(model["states"], "model.states"):
        _record(row, ("id", "facts"), "state")
        states.append({"id": _name(row["id"], "state.id"),
                       "facts": _names(row["facts"], "state.facts")})
    state_ids = {row["id"] for row in states}
    if not states or len(states) != len(state_ids):
        raise ValueError("model.states: expected nonempty, unique state IDs")
    initial = _names(model["initial"], "model.initial")
    if not initial or not set(initial) <= state_ids:
        raise ValueError("model.initial: expected nonempty declared state IDs")
    transitions = []
    for row in _sequence(model["transitions"], "model.transitions"):
        _record(row, ("id", "source", "target"), "transition")
        entry = {key: _name(row[key], f"transition.{key}")
                 for key in ("id", "source", "target")}
        if entry["source"] not in state_ids or entry["target"] not in state_ids:
            raise ValueError("transition: undeclared endpoint")
        transitions.append(entry)
    if len(transitions) != len({row["id"] for row in transitions}):
        raise ValueError("model.transitions: duplicate transition IDs")
    return {"schema_version": 1,
            "model_id": _name(model["model_id"], "model.model_id"),
            "authority": _name(model["authority"], "model.authority"),
            "initial": initial, "states": sorted(states, key=lambda row: row["id"]),
            "transitions": sorted(transitions, key=lambda row: row["id"])}


def _policy(policy):
    _record(policy, ("facts", "horn", "deontic", "claims", "nvars", "cons"),
            "policy")
    result = {"facts": _names(policy["facts"], "policy.facts"),
              "horn": [], "deontic": [], "claims": [], "cons": [],
              "nvars": _integer(policy["nvars"], "policy.nvars", 0)}
    for row in _sequence(policy["horn"], "policy.horn"):
        body, head = _sequence(row, "Horn rule", 2)
        result["horn"].append([_names(body, "Horn body"), _name(head, "Horn head")])
    for row in _sequence(policy["deontic"], "policy.deontic"):
        body, mode, action, scope, interval, name = _sequence(row, "deontic rule", 6)
        if mode not in ("O", "F"):
            raise ValueError("deontic mode: expected O or F")
        result["deontic"].append([
            _names(body, "deontic body"), mode, _name(action, "deontic action"),
            _names(scope, "deontic scope"), _interval(interval, "deontic interval"),
            _name(name, "deontic name")])
    for row in _sequence(policy["claims"], "policy.claims"):
        resource, interval, owner, exclusive = _sequence(row, "claim", 4)
        if type(exclusive) is not bool:
            raise ValueError("claim.exclusive: expected boolean")
        result["claims"].append([
            _name(resource, "claim resource"), _interval(interval, "claim interval"),
            _name(owner, "claim owner"), exclusive])
    for row in _sequence(policy["cons"], "policy.cons"):
        source, target, bound = _sequence(row, "difference constraint", 3)
        _integer(source, "difference source", 0)
        _integer(target, "difference target", 0)
        _integer(bound, "difference bound")
        if max(source, target) >= result["nvars"]:
            raise ValueError("difference constraint: undeclared variable")
        result["cons"].append([source, target, bound])
    return result


def _digest(value):
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=True, allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def model_digest(model):
    """Digest validated canonical model; ordering of graph rows is irrelevant."""
    return _digest(_model(model))


def policy_digest(policy):
    """Digest validated policy; rule order remains significant for witness IDs."""
    return _digest(_policy(policy))


def _check(policy, facts):
    raw = r17.check(dict(policy, facts=sorted(facts)))
    # The original reference returns sets and tuples; expose replayable JSON.
    return {"conflict": bool(raw["conflict"]), "bot": bool(raw["bot"]),
            "of": [list(pair) for pair in sorted(raw["of"])],
            "claims": [list(pair) for pair in sorted(raw["claims"])],
            "temporal": bool(raw["temporal"]),
            "cycle": (None if raw["cycle"] is None else
                      [[list(edge) for edge in raw["cycle"][0]], raw["cycle"][1]]),
            "M": sorted(raw["M"]), "fired": list(raw["fired"])}


def _fact_key(facts):
    return tuple(sorted(facts))


def analyze(model, policy, *, max_states=10000, max_transitions=100000):
    """Check complete reachable labels, or return unknown/replayable unsafe.

    max_states limits discovered distinct state IDs; max_transitions limits
    examined reachable edges, including edges to already discovered IDs. Zero
    budgets are permitted. A limit is reached only when it prevents needed work.
    Every discovered state has a predecessor path, even on an incomplete run.
    The returned maxima refer only to discovered states when complete is false.
    """
    model, policy = _model(model), _policy(policy)
    _integer(max_states, "max_states", 0)
    _integer(max_transitions, "max_transitions", 0)
    bindings = {"model_digest": _digest(model), "policy_digest": _digest(policy)}
    states = {row["id"]: row for row in model["states"]}
    outgoing = {state_id: [] for state_id in states}
    for edge in model["transitions"]:
        outgoing[edge["source"]].append(edge)
    predecessors = {}
    queue = deque()
    stop_reason = None
    for state_id in model["initial"]:
        if len(predecessors) >= max_states:
            stop_reason = "state_budget"
            break
        predecessors[state_id] = None
        queue.append(state_id)
    examined = 0
    while queue and stop_reason is None:
        source = queue.popleft()
        for edge in outgoing[source]:
            if examined >= max_transitions:
                stop_reason = "transition_budget"
                break
            target = edge["target"]
            examined += 1
            if target not in predecessors:
                if len(predecessors) >= max_states:
                    stop_reason = "state_budget"
                    break
                predecessors[target] = (source, edge["id"])
                queue.append(target)
    complete = stop_reason is None
    baseline = frozenset(policy["facts"])
    representatives = {}
    for state_id in sorted(predecessors):
        facts = baseline | frozenset(states[state_id]["facts"])
        representatives.setdefault(facts, state_id)
    family = sorted(representatives, key=_fact_key)
    maximal = [facts for facts in family
               if not any(facts < other for other in family)]
    checked = 0
    witness = None
    for facts in maximal:
        checker = _check(policy, facts)
        checked += 1
        if not checker["conflict"]:
            continue
        state_ids, transition_ids = [], []
        cursor = representatives[facts]
        while True:
            state_ids.append(cursor)
            predecessor = predecessors[cursor]
            if predecessor is None:
                break
            cursor, transition_id = predecessor
            transition_ids.append(transition_id)
        witness = {**bindings, "state_ids": state_ids[::-1],
                   "transition_ids": transition_ids[::-1], "facts": sorted(facts),
                   "checker": checker}
        break
    status = "unsafe" if witness is not None else "safe" if complete else "unknown"
    return {**bindings, "status": status, "complete": complete,
            "reason": stop_reason, "proof_scope": PROOF_SCOPE,
            "model_id": model["model_id"], "authority": model["authority"],
            "budgets": {"max_states": max_states, "max_transitions": max_transitions},
            "reachable_states": sorted(predecessors),
            "examined_transitions": examined,
            "reachable_fact_sets": [sorted(facts) for facts in family],
            "maximal_fact_sets": [sorted(facts) for facts in maximal],
            "checked_fact_sets": checked, "witness": witness}


def replay_witness(model, policy, witness):
    """Recheck artifact binding, every path edge, final label, and R17 conflict.

    A malformed model/policy raises ValueError; a malformed, tampered, stale,
    or nonconflicting witness returns False. Replay does not establish model
    conformance to a runtime, nor does it authenticate the declared authority.
    """
    model, policy = _model(model), _policy(policy)
    if not isinstance(witness, dict) or set(witness) != {
            "model_digest", "policy_digest", "state_ids", "transition_ids",
            "facts", "checker"}:
        return False
    if (witness["model_digest"] != _digest(model)
            or witness["policy_digest"] != _digest(policy)):
        return False
    state_ids, transition_ids = witness["state_ids"], witness["transition_ids"]
    if (not isinstance(state_ids, list) or not state_ids
            or not all(isinstance(item, str) for item in state_ids)
            or not isinstance(transition_ids, list)
            or not all(isinstance(item, str) for item in transition_ids)
            or len(state_ids) != len(transition_ids) + 1
            or state_ids[0] not in model["initial"]):
        return False
    states = {row["id"]: row for row in model["states"]}
    edges = {row["id"]: row for row in model["transitions"]}
    if any(state_id not in states for state_id in state_ids):
        return False
    for index, edge_id in enumerate(transition_ids):
        edge = edges.get(edge_id)
        if (edge is None or edge["source"] != state_ids[index]
                or edge["target"] != state_ids[index + 1]):
            return False
    facts = sorted(set(policy["facts"]) | set(states[state_ids[-1]]["facts"]))
    if witness["facts"] != facts:
        return False
    checker = _check(policy, facts)
    try:
        same_checker = _digest(witness["checker"]) == _digest(checker)
    except (TypeError, ValueError):
        return False
    return checker["conflict"] and same_checker


def _json_object(pairs):
    """Do not silently accept a JSON object whose later key overwrites a rule."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"JSON: duplicate key {key}")
        result[key] = value
    return result


def main():
    """Read {model, policy, optional budgets} JSON from stdin; write a receipt."""
    import sys

    try:
        request = json.load(sys.stdin, object_pairs_hook=_json_object)
        if not isinstance(request, dict) or set(request) not in (
                {"model", "policy"}, {"model", "policy", "budgets"}):
            raise ValueError("request: expected model, policy, and optional budgets")
        budgets = request.get("budgets", {})
        if not isinstance(budgets, dict) or not set(budgets) <= {
                "max_states", "max_transitions"}:
            raise ValueError("budgets: expected max_states and/or max_transitions")
        result = analyze(request["model"], request["policy"], **budgets)
    except (ValueError, TypeError) as error:
        print(json.dumps({"status": "invalid", "error": str(error)}, sort_keys=True))
        return 2
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))
    return 0 if result["status"] == "safe" else 1 if result["status"] == "unsafe" else 2


if __name__ == "__main__":
    raise SystemExit(main())
