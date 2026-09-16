"""Invented longitudinal episodes, not harvested project or participant data."""


def event(sequence, kind, data, **overrides):
    """Construct a fully specified event; overrides make adversarial cases explicit."""
    return {"version": 1, "id": f"e{sequence}", "tenant": "tenant-a",
            "project": "same-project", "epoch": 1, "sequence": sequence,
            "recordedAt": sequence * 10, "validFrom": 0, "validUntil": None,
            "principal": "alice", "audience": ["alice", "bob", "stale-agent"],
            "basis": [], "kind": kind, "data": data, **overrides}


def access(**overrides):
    """Current synthetic policy is deliberately separate from the historical log."""
    return {"tenant": "tenant-a", "project": "same-project", "revision": 1,
            "readers": ["alice", "bob", "stale-agent"], **overrides}


def analytics():
    """A backdated scoped exception and an independently stale actor assertion."""
    return [
        event(1, "evidence", {"atom": "policy-record"}),
        event(2, "norm", {"modality": "F", "action": "add-database", "scopes": ["transactions", "analytics"]}, basis=["e1"]),
        event(3, "exception", {"target": "e2", "scopes": ["analytics"]}, validFrom=10, basis=["e1"]),
        event(4, "assertion", {"proposition": "No extra database is ever permitted"}, principal="stale-agent"),
        event(5, "commitment", {"debtor": "alice", "beneficiary": "bob", "action": "serve-analytics", "scopes": ["analytics"], "oracle": "analytics-test-passed"}, basis=["e1"]),
        event(6, "acknowledgment", {"target": "e5"}),
        event(7, "transition", {"target": "e5", "state": "accepted", "receipt": "acceptance-declaration"}),
        event(8, "rule", {"body": ["remove-clickhouse"], "head": "analytics-disabled"}, basis=["e1"]),
        event(9, "rule", {"body": ["analytics-disabled", "commitment-active:e5"], "head": "_BOT_"}, basis=["e5", "e7", "e1"]),
    ]


def encrypted_replay():
    """Remote ciphertext alone is safe in this fixture; decryption violates policy."""
    return [
        event(1, "evidence", {"atom": "server-plaintext-forbidden"}),
        event(2, "rule", {"body": ["server-decrypt"], "head": "server-readable"}, basis=["e1"]),
        event(3, "rule", {"body": ["server-readable", "server-plaintext-forbidden"], "head": "_BOT_"}, basis=["e1"]),
    ]
