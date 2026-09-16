"""Pure bounded adapter to the existing Harbor R17 research checker.

No language model, text search, hidden authority or production registration.
The dynamic import is a fixed repository source file, never a packet-supplied path.
"""
import importlib.util
from pathlib import Path
from temporal import require, strings

_source = Path(__file__).resolve().parents[4] / "skills/harbor-results/scripts/b4_deontic_fragment.py"
_spec = importlib.util.spec_from_file_location("harbor_r17", _source)
R17 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R17)


def analyze(view, proposed_atoms, *, max_steps=4096):
    """Return R17 conflict witnesses over the authorized synthetic projection.

    Proposed atoms are explicit hypothetical actions, not world observations.
    A hard bound rejects work rather than returning a false conflict-free result.
    This adapter covers Horn and O/F conflicts at the query tick; R17's resource
    and difference-constraint engines remain covered by its original sweep.
    """
    require(strings(proposed_atoms), "MALFORMED_PROPOSAL")
    require(not any(a.startswith("commitment-active:") for a in proposed_atoms), "RESERVED_COMMITMENT_ATOM")
    require(type(max_steps) is int and 1 <= max_steps <= 100_000, "INVALID_BOUND")
    records = view["records"]
    require(len(records) <= 128, "FRAGMENT_LIMIT")
    require(not any(e["support"] == "invalidated" and e["kind"] in
                    ["evidence", "rule", "norm", "exception", "commitment", "transition"] for e in records),
            "INVALIDATED_PREMISE")
    facts, horn, norms, sources, lineage = set(proposed_atoms), [], [], {}, {}
    for event in records:
        lineage[event["id"]] = list(dict.fromkeys([event["id"]] + [ref for basis in event["basis"] for ref in lineage[basis]]))
    for atom in proposed_atoms:
        sources[atom] = ["hypothetical-action:" + atom]
    tick = view["effectiveAt"]
    for event in records:
        data = event["data"]
        if event["kind"] == "evidence":
            require(not data["atom"].startswith("commitment-active:"), "RESERVED_COMMITMENT_ATOM")
            facts.add(data["atom"])
            sources.setdefault(data["atom"], lineage[event["id"]])
        elif event["kind"] == "rule":
            require(not data["head"].startswith("commitment-active:"), "RESERVED_COMMITMENT_ATOM")
            horn.append((tuple(data["body"]), data["head"], event["id"]))
        elif event["kind"] == "norm" and data["scopes"]:
            norms.append(((), data["modality"], data["action"], tuple(data["scopes"]), (tick, tick), event["id"]))
        elif event["kind"] == "commitment":
            c = view["commitments"][event["id"]]
            if c["state"] == "accepted":
                norms.append(((), "O", c["action"], tuple(c["scopes"]), (tick, tick), event["id"]))
                atom = "commitment-active:" + event["id"]
                require(atom not in sources, "RESERVED_COMMITMENT_ATOM")
                facts.add(atom)
                sources[atom] = list(dict.fromkeys(lineage[event["id"]] + lineage[c["receipt"]]))
    # Rule closure yields a finite, independently inspectable derivation DAG.
    # Runtime effort is counted, never inferred from a wall-clock timeout alone.
    steps, changed = 0, True
    while changed:
        changed = False
        for body, head, rule_id in horn:
            steps += len(body) + 1
            require(steps <= max_steps, "CONSEQUENCE_BOUND_EXCEEDED")
            if head not in sources and all(atom in sources for atom in body):
                sources[head] = list(dict.fromkeys(lineage[rule_id] + [ref for atom in body for ref in sources[atom]]))
                changed = True
    policy = {"facts": facts, "horn": [(b, h) for b, h, _ in horn],
              "deontic": norms, "claims": [], "nvars": 0, "cons": []}
    result = R17.check(policy)
    require(result["M"] == set(sources), "DERIVATION_DISAGREEMENT")
    witnesses = []
    if result["bot"]:
        witnesses.append({"kind": "integrity", "premises": sources[R17.BOT]})
    for i, j in sorted(result["of"]):
        premises = list(dict.fromkeys(lineage[norms[i][5]] + lineage[norms[j][5]]))
        for index in [i, j]:
            if norms[index][5] in view["commitments"]:
                premises = list(dict.fromkeys(premises + lineage[view["commitments"][norms[index][5]]["receipt"]]))
        witnesses.append({"kind": "obligation-prohibition", "premises": premises,
                          "action": norms[i][2], "scopes": sorted(set(norms[i][3]) & set(norms[j][3]))})
    return {"conflict": result["conflict"], "witnesses": witnesses,
            "derivations": sources, "steps": steps,
            "completeWithinFragment": True, "effectAuthority": False}
