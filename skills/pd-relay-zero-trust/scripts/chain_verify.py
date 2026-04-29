#!/usr/bin/env python3
"""Walk a per-publisher event chain; detect breaks and forks.

Input  (Request.payload):
  {
    "events": [ {event_envelope}, ... ],   # ordered by seq
    "expected_sender": "<fingerprint>",     # optional; rejects mismatched senders
    "starting_prev_hash": "<64-hex>"        # optional; default zeros for seq=0
  }

Output (Response.result):
  {
    "ok": bool,
    "events_walked": int,
    "first_break": null | { "seq": int, "reason": str, "expected": str, "got": str },
    "tip_seq": int,
    "tip_hash": "<64-hex>"
  }

Selftest synthesizes a 5-event chain and asserts ok=true; mutates one event
and asserts the break is detected at the right sequence.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _envelope import canonical_json, run, write_ok  # noqa: E402

ZERO_HASH = "0" * 64


def hash_event(prev: str, sender: str, channel: str, seq: int, iat: int,
               ciphertext: dict) -> str:
    h = hashlib.sha256()
    h.update(prev.encode())
    h.update(sender.encode())
    h.update(channel.encode())
    h.update(str(seq).encode())
    h.update(str(iat).encode())
    h.update(canonical_json(ciphertext).encode())
    return h.hexdigest()


def handle(payload: dict) -> dict:
    events = payload.get("events", [])
    expected_sender = payload.get("expected_sender")
    prev = payload.get("starting_prev_hash", ZERO_HASH)

    last_seq = -1
    last_hash = prev
    walked = 0

    for evt in events:
        seq = evt["seq"]
        if expected_sender and evt["sender"] != expected_sender:
            return _break(walked, seq, "sender_mismatch",
                          expected_sender, evt["sender"], last_seq, last_hash)
        if seq != last_seq + 1:
            return _break(walked, seq, "seq_gap",
                          str(last_seq + 1), str(seq), last_seq, last_hash)
        if evt["prev_hash"] != last_hash:
            return _break(walked, seq, "prev_hash_mismatch",
                          last_hash, evt["prev_hash"], last_seq, last_hash)
        recomputed = hash_event(evt["prev_hash"], evt["sender"], evt["channel"],
                                evt["seq"], evt["iat"], evt["ciphertext"])
        if recomputed != evt["this_hash"]:
            return _break(walked, seq, "this_hash_mismatch",
                          recomputed, evt["this_hash"], last_seq, last_hash)
        last_seq = seq
        last_hash = evt["this_hash"]
        walked += 1

    return {"ok": True, "events_walked": walked, "first_break": None,
            "tip_seq": last_seq, "tip_hash": last_hash}


def _break(walked, seq, reason, expected, got, last_seq, last_hash):
    return {
        "ok": False, "events_walked": walked,
        "first_break": {"seq": seq, "reason": reason,
                        "expected": expected, "got": got},
        "tip_seq": last_seq, "tip_hash": last_hash,
    }


def _make_event(prev: str, seq: int, payload_text: str,
                sender: str = "abc123", channel: str = "test:ch",
                iat: int = 1700000000) -> dict:
    ct = {"alg": "AES-256-GCM", "iv": "AAAA", "ct": payload_text,
          "tag": "BBBB", "wrap": "CCCC"}
    this_hash = hash_event(prev, sender, channel, seq, iat, ct)
    return {
        "v": 1, "sender": sender, "channel": channel, "seq": seq,
        "prev_hash": prev, "this_hash": this_hash, "iat": iat,
        "ciphertext": ct, "alg": "EdDSA", "sig": "(skipped)", "kid": sender,
    }


def selftest() -> None:
    chain = []
    prev = ZERO_HASH
    for i in range(5):
        evt = _make_event(prev, i, f"payload-{i}")
        chain.append(evt)
        prev = evt["this_hash"]

    res = handle({"events": chain})
    assert res["ok"] is True, res
    assert res["events_walked"] == 5

    # Mutate event 2 ciphertext; should break at seq=2 (this_hash mismatch on 2)
    bad = json.loads(json.dumps(chain))
    bad[2]["ciphertext"]["ct"] = "tampered"
    res2 = handle({"events": bad})
    assert res2["ok"] is False, res2
    assert res2["first_break"]["seq"] == 2, res2
    write_ok({"selftest": "ok", "happy": res, "tamper": res2})


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        selftest()
    else:
        run(handle, expected_command="chain.verify")
