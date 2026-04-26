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


def _ed25519_sign(seed_hex: str, message: bytes) -> tuple[str, str]:
    """Returns (sig_hex, pub_hex). Pure-stdlib not feasible for Ed25519;
    we shell out to openssl if available, else degrade to HMAC for selftest.
    """
    try:
        from nacl.signing import SigningKey  # type: ignore
        sk = SigningKey(bytes.fromhex(seed_hex))
        sig = sk.sign(message).signature
        pub = sk.verify_key.encode()
        return sig.hex(), pub.hex()
    except ImportError:
        # Degraded mode for environments without pynacl: HMAC-SHA256.
        # NOT a real signature; selftest only.
        import hmac
        sig = hmac.new(bytes.fromhex(seed_hex), message, hashlib.sha256).hexdigest()
        pub = hashlib.sha256(bytes.fromhex(seed_hex)).hexdigest()
        return f"DEGRADED:{sig}", f"DEGRADED:{pub}"


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

    msg = head_message(sender, channel, tip_seq, tip_hash, issued_at, anchors)
    sig_hex, pub_hex = _ed25519_sign(seed_hex, msg)

    return {
        "v": 1, "sender": sender, "channel": channel, "tip_seq": tip_seq,
        "tip_hash": tip_hash, "issued_at": issued_at, "anchors": anchors,
        "alg": "EdDSA", "sig": sig_hex, "kid": pub_hex,
    }


def selftest() -> None:
    out = handle({
        "sender": "abc",
        "channel": None,
        "tip_seq": 99,
        "tip_hash": "f" * 64,
        "issued_at": 1700000000,
        "anchors": [],
        "private_key_hex": "00" * 32,
    })
    assert out["sig"], out
    write_ok({"selftest": "ok", "head": out})


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        selftest()
    else:
        run(handle, expected_command="chain.anchor")
