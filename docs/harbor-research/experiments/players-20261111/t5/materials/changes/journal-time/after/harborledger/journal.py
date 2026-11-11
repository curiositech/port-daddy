"""An append-only journal. Each entry carries the hash of the entry before it (R9)."""

import copy
import hashlib
import json

GENESIS = "0" * 64


def entry_hash(prev, seq, kind, payload):
    """Hash of one entry. Every field of the entry goes in."""
    body = json.dumps(
        {"prev": prev, "seq": seq, "kind": kind, "payload": payload},
        sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(body.encode()).hexdigest()


class Journal:
    def __init__(self):
        self._entries = []

    def __len__(self):
        return len(self._entries)

    def append(self, kind, payload, at=None):
        """Add an entry and return a copy of it. `at` is the time of writing, when the caller has one."""
        prev = self._entries[-1]["hash"] if self._entries else GENESIS
        seq = len(self._entries) + 1
        payload = copy.deepcopy(payload)
        entry = {"seq": seq, "prev": prev, "kind": kind, "payload": payload, "at": at}
        entry["hash"] = entry_hash(prev, seq, kind, payload)
        self._entries.append(entry)
        return copy.deepcopy(entry)

    def entries(self, kind=None):
        """Copies of the entries, oldest first. With kind, only entries of that kind."""
        return [copy.deepcopy(e) for e in self._entries if kind is None or e["kind"] == kind]

    def entries_since(self, at):
        """Copies of the entries written at or after the given time, oldest first."""
        return [copy.deepcopy(e) for e in self._entries if e["at"] is not None and e["at"] >= at]

    def verify(self):
        """Return 0 when the chain is whole, else the seq of the first bad entry."""
        prev = GENESIS
        for position, e in enumerate(self._entries, start=1):
            expected = entry_hash(e["prev"], e["seq"], e["kind"], e["payload"])
            if e["seq"] != position or e["prev"] != prev or e["hash"] != expected:
                return position
            prev = e["hash"]
        return 0
