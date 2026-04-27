#!/usr/bin/env python3
"""Build a signed chain head suitable for external anchoring.

Input  (Request.payload):
  {
    "sender": "<fingerprint>",
    "channel": null | "<channel>",
    "tip_seq": int,
    "tip_hash": "<64-hex>",
    "issued_at": int,
    "anchors": [...optional...],
    "private_key_hex": "<64-hex>"  # ed25519 32-byte seed (selftest only)
  }

Output (Response.result):
  { ...chain head... }

Selftest signs a head with a deterministic key and verifies.
Real use should integrate with the daemon's key store, NOT take key bytes via stdin.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _envelope import canonical_json, run, write_ok  # noqa: E402


def _ed25519_sign(seed_hex: str, message: bytes,
                  allow_degraded: bool = False) -> tuple[str, str, str]:
    """Returns (alg, sig_hex, pub_hex).

    Real signature: alg = "EdDSA", produced via PyNaCl.
    If PyNaCl is missing and allow_degraded=True, returns an HMAC-SHA256
    placeholder under alg = "DEGRADED-HMAC-SHA256" so callers (and downstream
    verifiers) see the truth instead of a forged "EdDSA" tag. If degraded
    mode is not explicitly allowed, this raises — fail-closed by default.
    """
    try:
        from nacl.signing import SigningKey  # type: ignore
        sk = SigningKey(bytes.fromhex(seed_hex))
        sig = sk.sign(message).signature
        pub = sk.verify_key.encode()
        return "EdDSA", sig.hex(), pub.hex()
    except ImportError as e:
        if not allow_degraded:
            raise RuntimeError(
                "Ed25519 signing requires PyNaCl (pip install pynacl). "
                "Pass allow_degraded=True only for non-production selftests."
            ) from e
        import hmac
        sig = hmac.new(bytes.fromhex(seed_hex), message, hashlib.sha256).hexdigest()
        pub = hashlib.sha256(bytes.fromhex(seed_hex)).hexdigest()
        return "DEGRADED-HMAC-SHA256", sig, pub


def head_message(sender: str, channel: str | None, tip_seq: int,
                 tip_hash: str, issued_at: int,
                 anchors: list | None) -> bytes:
    payload = {
        "v": 1, "sender": sender, "channel": channel, "tip_seq": tip_seq,
        "tip_hash": tip_hash, "issued_at": issued_at,
        "anchors": anchors or [],
    }
    return canonical_json(payload).encode()


def handle(payload: dict) -> dict:
    sender = payload["sender"]
    channel = payload.get("channel")
    tip_seq = int(payload["tip_seq"])
    tip_hash = payload["tip_hash"]
    issued_at = int(payload["issued_at"])
    anchors = payload.get("anchors") or []
    seed_hex = payload["private_key_hex"]
    allow_degraded = bool(payload.get("allow_degraded", False))

    msg = head_message(sender, channel, tip_seq, tip_hash, issued_at, anchors)
    alg, sig_hex, pub_hex = _ed25519_sign(seed_hex, msg,
                                          allow_degraded=allow_degraded)

    return {
        "v": 1, "sender": sender, "channel": channel, "tip_seq": tip_seq,
        "tip_hash": tip_hash, "issued_at": issued_at, "anchors": anchors,
        "alg": alg, "sig": sig_hex, "kid": pub_hex,
    }


def selftest() -> None:
    # Selftest must run without PyNaCl available — opt into degraded mode
    # explicitly so the output's alg field tells the truth.
    out = handle({
        "sender": "abc",
        "channel": None,
        "tip_seq": 99,
        "tip_hash": "f" * 64,
        "issued_at": 1700000000,
        "anchors": [],
        "private_key_hex": "00" * 32,
        "allow_degraded": True,
    })
    assert out["sig"], out
    assert out["alg"] in ("EdDSA", "DEGRADED-HMAC-SHA256"), out
    write_ok({"selftest": "ok", "head": out})


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        selftest()
    else:
        run(handle, expected_command="chain.anchor")
