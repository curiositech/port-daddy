#!/usr/bin/env python3
"""Verify a captured relay handshake against the schema and structural invariants.

This is a static-checker (does not perform real signature verification by
default; signature checks require keys not available here). It catches:

- Schema violations
- Nonce echo failure (server_hello.nonce_c != client_hello.nonce_c)
- card.cap inconsistency with subscriptions[]
- Missing required fields
- Card expiry already passed at handshake time

Input  (Request.payload):
  {
    "client_hello": {...},
    "server_hello": {...},
    "now": int    # unix timestamp; defaults to card.iat + 1
  }

Output: { "ok": bool, "findings": [ { "severity", "code", "message" } ] }
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _envelope import run, write_ok  # noqa: E402


def handle(payload: dict) -> dict:
    ch = payload.get("client_hello") or {}
    sh = payload.get("server_hello") or {}
    findings = []

    def add(sev: str, code: str, msg: str) -> None:
        findings.append({"severity": sev, "code": code, "message": msg})

    if ch.get("msg") != "client_hello":
        add("error", "ch_msg_wrong", "client_hello.msg must be 'client_hello'")
    if sh.get("msg") != "server_hello":
        add("error", "sh_msg_wrong", "server_hello.msg must be 'server_hello'")
    for field in ("daemon", "card", "subscriptions", "nonce_c", "alg", "sig", "kid"):
        if field not in ch:
            add("error", "ch_missing", f"client_hello.{field} missing")
    for field in ("relay", "session", "nonce_c", "nonce_s", "accepted_subs",
                  "alg", "sig", "kid"):
        if field not in sh:
            add("error", "sh_missing", f"server_hello.{field} missing")

    if ch.get("nonce_c") and sh.get("nonce_c") and ch["nonce_c"] != sh["nonce_c"]:
        add("error", "nonce_echo_fail",
            "server_hello.nonce_c does not echo client_hello.nonce_c")

    card = ch.get("card", {}) or {}
    cap_index: set[tuple[str, str]] = set()
    for c in card.get("cap", []):
        op, channel = c.get("op"), c.get("channel")
        if not isinstance(op, str) or not isinstance(channel, str):
            add("error", "cap_entry_malformed",
                f"card.cap entry has non-string op/channel: {c!r}")
            continue
        cap_index.add((op, channel))
    for sub in ch.get("subscriptions", []):
        ch_name = sub.get("channel", "")
        if not isinstance(ch_name, str):
            add("error", "sub_channel_malformed",
                f"subscriptions entry has non-string channel: {sub!r}")
            continue
        # Must have either explicit (sub, channel) or wildcard parent
        ok = False
        for op, channel in cap_index:
            if op in {"sub", "pubsub"} and (channel == ch_name
                                            or (channel.endswith("*")
                                                and ch_name.startswith(channel[:-1]))):
                ok = True
                break
        if not ok:
            add("error", "sub_cap_mismatch",
                f"subscription {ch_name!r} not authorized by card.cap")

    now = int(payload.get("now") or (card.get("iat", 0) + 1))
    if card.get("exp") and card["exp"] <= now:
        add("error", "card_expired",
            f"card.exp ({card['exp']}) <= now ({now})")
    if card.get("exp") and card.get("iat") and card["exp"] - card["iat"] > 3600:
        add("warning", "card_too_long",
            "card lifetime > 1h; relay-bound cards SHOULD be <= 1h")

    relay = sh.get("relay", {})
    if not relay.get("fingerprint"):
        add("error", "relay_fp_missing", "server_hello.relay.fingerprint missing")

    return {"ok": all(f["severity"] != "error" for f in findings),
            "findings": findings}


SAMPLE_HS = {
    "client_hello": {
        "msg": "client_hello", "v": 1,
        "daemon": {"fingerprint": "abc", "version": "0.1", "harbors": ["h1"]},
        "card": {
            "iss": "abc", "sub": "agent:1",
            "aud": ["relay.portdaddy.dev"],
            "iat": 1700000000, "exp": 1700003600, "jti": "j1",
            "harbor": {"fingerprint": "h1", "scope": "project"},
            "cap": [{"op": "sub", "channel": "h1:swarm:*"}],
            "alg": "EdDSA", "kid": "abc",
        },
        "subscriptions": [{"channel": "h1:swarm:general"}],
        "nonce_c": "AAAAAAAAAAAAAAAA",
        "alg": "EdDSA", "sig": "deadbeef", "kid": "abc",
    },
    "server_hello": {
        "msg": "server_hello", "v": 1,
        "relay": {"fingerprint": "relay-fp", "name": "relay.portdaddy.dev"},
        "session": {"id": "s-1", "exp": 1700003600},
        "nonce_c": "AAAAAAAAAAAAAAAA",
        "nonce_s": "BBBBBBBBBBBBBBBB",
        "accepted_subs": [{"channel": "h1:swarm:general", "tip_seq": 0,
                           "tip_hash": "0" * 64}],
        "alg": "EdDSA", "sig": "cafef00d", "kid": "relay-fp",
    },
    "now": 1700000005,
}


def selftest() -> None:
    res = handle(SAMPLE_HS)
    assert res["ok"], res
    bad = {**SAMPLE_HS,
           "server_hello": {**SAMPLE_HS["server_hello"], "nonce_c": "ZZZZ"}}
    res2 = handle(bad)
    assert not res2["ok"]
    assert any(f["code"] == "nonce_echo_fail" for f in res2["findings"])
    write_ok({"selftest": "ok", "happy": res, "tamper": res2})


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        selftest()
    else:
        run(handle, expected_command="handshake.verify")
