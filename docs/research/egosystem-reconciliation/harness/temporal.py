"""Bounded, synthetic Project Epistemology replay; no I/O or runtime authority.

Records are already-admitted fixture events, NOT a production wire protocol.
Current fixture access policy is supplied separately from historical events.
Ticks are integer valid times; intervals are closed to match Harbor R17.
"""
from copy import deepcopy
import json

MAX_EVENTS = 512
MAX_BYTES = 1_000_000
MAX_SAFE = 9007199254740991
FIELDS = {
    "evidence": {"atom"},
    "assertion": {"proposition"},
    "rule": {"body", "head"},
    "norm": {"modality", "action", "scopes"},
    "exception": {"target", "scopes"},
    "invalidate": {"target"},
    "erase": {"target"},
    "commitment": {"debtor", "beneficiary", "action", "scopes", "oracle"},
    "transition": {"target", "state", "receipt"},
    "participation": {"state"},
    "acknowledgment": {"target"},
}
ENVELOPE = {"version", "id", "tenant", "project", "epoch", "sequence",
            "recordedAt", "validFrom", "validUntil", "principal", "audience",
            "basis", "kind", "data"}


def require(condition, code):
    """Reject an invalid fixture instead of manufacturing a complete projection."""
    if not condition:
        raise ValueError(code)


def integer(value):
    """Use the same bounded integer domain as the offline packet format."""
    return type(value) is int and 0 <= value <= MAX_SAFE


def text(value):
    """IDs are opaque bounded strings, never inferred from prose or paths."""
    return isinstance(value, str) and bool(value.strip()) and len(value) <= 256


def strings(value, nonempty=False):
    """Require bounded, unique ground atoms; no variables or natural-language parsing."""
    return (isinstance(value, list) and len(value) <= 128
            and (bool(value) or not nonempty) and all(text(x) for x in value)
            and len(set(value)) == len(value))


def validate_event(event):
    """Validate the entire supported vocabulary before folding any fixture event."""
    require(isinstance(event, dict) and set(event) == ENVELOPE, "MALFORMED_EVENT")
    require(type(event["version"]) is int and event["version"] == 1, "UNKNOWN_SCHEMA")
    for key in ["id", "tenant", "project", "principal"]:
        require(text(event[key]), "MALFORMED_ID")
    for key in ["epoch", "sequence", "recordedAt", "validFrom"]:
        require(integer(event[key]), "MALFORMED_TIME_OR_SEQUENCE")
    end = event["validUntil"]
    require(end is None or (integer(end) and end >= event["validFrom"]), "MALFORMED_INTERVAL")
    require(strings(event["audience"], True) and strings(event["basis"]), "MALFORMED_REFERENCES")
    kind, data = event["kind"], event["data"]
    require(isinstance(kind, str) and kind in FIELDS, "UNKNOWN_EVENT")
    require(isinstance(data, dict) and set(data) == FIELDS[kind], "MALFORMED_PAYLOAD")
    for key, value in data.items():
        if key in ["scopes", "body"]:
            require(strings(value, key == "scopes"), "MALFORMED_ATOMS")
        else:
            require(text(value), "MALFORMED_PAYLOAD")
    if kind == "norm":
        require(data["modality"] in ["O", "F"], "OUTSIDE_FRAGMENT")
    if kind == "transition":
        require(data["state"] in ["accepted", "refused", "cancelled", "fulfilled"], "UNKNOWN_TRANSITION")
    if kind == "participation":
        require(data["state"] in ["present", "departed"], "UNKNOWN_PARTICIPATION")


def project(events, *, tenant, project_id, principal, access, epoch,
            as_of, effective_at):
    """Replay one fixture stream, then apply CURRENT access and payload erasure.

    Motivation: historical queries must not restore revoked access or erased
    evidence. A caller supplies the whole epoch; a missing/reordered sequence or
    unsupported record rejects the result. No cache, signing, ACL lookup, or
    append endpoint is implemented here. Every input remains unchanged.
    """
    require(isinstance(access, dict) and set(access) == {"tenant", "project", "revision", "readers"}, "NOT_AUTHORIZED")
    require(access["tenant"] == tenant and access["project"] == project_id
            and integer(access["revision"]) and strings(access["readers"])
            and principal in access["readers"], "NOT_AUTHORIZED")
    require(all(integer(x) for x in [epoch, as_of, effective_at]), "MALFORMED_QUERY")
    require(isinstance(events, list) and len(events) <= 4096, "INPUT_LIMIT")
    require(all(isinstance(e, dict) for e in events), "MALFORMED_EVENT")
    # Tenant/project are structural namespace keys, not unstructured matching.
    stream = [e for e in events if e.get("tenant") == tenant and e.get("project") == project_id]
    require(len(stream) <= MAX_EVENTS, "EVENT_LIMIT")
    encoded = json.dumps(stream, sort_keys=True, allow_nan=False).encode()
    require(len(encoded) <= MAX_BYTES, "BYTE_LIMIT")
    seen, ordered, previous_time = {}, [], 0
    for event in stream:
        validate_event(event)
        require(event["epoch"] == epoch, "UNSUPPORTED_EPOCH_HANDOFF")
        if event["id"] in seen:
            require(event == seen[event["id"]], "IDEMPOTENCY_CONFLICT")
            continue
        require(event["sequence"] == len(ordered) + 1, "SEQUENCE_GAP_OR_REORDER")
        require(event["recordedAt"] >= previous_time, "RECORDED_TIME_REORDER")
        # Reference closure is checked on admitted records, before projections.
        refs = event["basis"] + ([event["data"]["target"]] if "target" in event["data"] else [])
        require(all(ref in seen for ref in refs), "UNKNOWN_OR_FORWARD_REFERENCE")
        seen[event["id"]] = event
        ordered.append(event)
        previous_time = event["recordedAt"]
    require(as_of <= len(ordered), "INCOMPLETE_PREFIX")
    erased = {e["data"]["target"] for e in ordered if e["kind"] == "erase"}
    prefix = ordered[:as_of]
    current = [e for e in prefix if e["validFrom"] <= effective_at
               and (e["validUntil"] is None or effective_at <= e["validUntil"])]
    invalid = {e["data"]["target"] for e in current if e["kind"] == "invalidate"}
    hidden = erased
    visible = {}
    for event in current:
        # A hidden, expired or erased premise hides its derivatives.
        # Do not expose hidden IDs, counts or a special "private premise" label.
        refs = event["basis"] + ([event["data"]["target"]] if "target" in event["data"] else [])
        if (event["id"] in hidden or principal not in event["audience"]
                or any(ref not in visible for ref in refs)):
            continue
        visible[event["id"]] = deepcopy(event)
        # A corrected premise challenges support, not an accepted policy's
        # authority. Keep the assertion/norm/commitment and label its support;
        # only an explicit institutional transition can change the commitment.
        visible[event["id"]]["support"] = (
            "invalidated" if event["id"] in invalid
            or any(visible[ref]["support"] == "invalidated" for ref in refs)
            else "current")
    commitments, participation, acknowledgments = {}, {}, []
    for event in visible.values():
        kind, data = event["kind"], event["data"]
        if kind == "exception":
            target = visible[data["target"]]
            require(target["kind"] == "norm", "EXCEPTION_TARGET")
            require(set(data["scopes"]) <= set(target["data"]["scopes"]), "EXCEPTION_SCOPE_WIDENING")
            target["data"]["scopes"] = [s for s in target["data"]["scopes"] if s not in data["scopes"]]
        elif kind == "commitment":
            commitments[event["id"]] = {**deepcopy(data), "state": "proposed", "basis": event["basis"], "receipt": None}
        elif kind == "transition":
            require(data["target"] in commitments, "COMMITMENT_TARGET")
            c = commitments[data["target"]]
            state = data["state"]
            allowed = ((state in ["accepted", "refused"] and c["state"] == "proposed"
                        and event["principal"] == c["debtor"])
                       or (state == "cancelled" and c["state"] == "accepted"
                           and event["principal"] == c["beneficiary"])
                       or (state == "fulfilled" and c["state"] == "accepted"
                           and event["principal"] == c["debtor"]))
            require(allowed, "INVALID_COMMITMENT_TRANSITION")
            if state == "fulfilled":
                receipt = visible.get(data["receipt"])
                require(receipt is not None and data["receipt"] in event["basis"]
                        and receipt["kind"] == "evidence"
                        and receipt["support"] == "current"
                        and receipt["data"]["atom"] == c["oracle"], "MISSING_ORACLE_RECEIPT")
            c.update(state=state, receipt=event["id"])
        elif kind == "participation":
            participation[event["principal"]] = data["state"]
        elif kind == "acknowledgment":
            acknowledgments.append({"principal": event["principal"], "target": data["target"]})
    return {"tenant": tenant, "project": project_id, "epoch": epoch,
            "asOf": as_of, "effectiveAt": effective_at, "accessRevision": access["revision"],
            "records": list(visible.values()), "commitments": commitments,
            "participation": participation, "acknowledgments": acknowledgments,
            "effectAuthority": False}
