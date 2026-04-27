#!/usr/bin/env python3
"""Round-trip AES-256-GCM envelope wrap/unwrap; selftest verifies tamper detection.

Input  (envelope.encrypt):
  { "key_hex": "<64>", "plaintext_b64": "<>", "aad": "<optional>" }
Input  (envelope.decrypt):
  { "key_hex": "<64>", "iv_b64": "<>", "ct_b64": "<>", "tag_b64": "<>",
    "aad": "<optional>" }

Outputs the AES-GCM envelope or the recovered plaintext.

Real production code should use the daemon's note-encryption module.
This script exists to validate spec round-tripping and provide a CLI for
debugging.
"""
from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _envelope import run, write_ok  # noqa: E402


def _aesgcm():
    # Catch BaseException (not just Exception) because the cryptography
    # package can raise pyo3_runtime.PanicException at import time on
    # broken installs, and PanicException is a BaseException subclass.
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        AESGCM(b"\x00" * 32).encrypt(b"\x00" * 12, b"x", None)
        return AESGCM
    except BaseException:  # noqa: BLE001
        return None


def encrypt(payload: dict) -> dict:
    AESGCM = _aesgcm()
    if AESGCM is None:
        raise RuntimeError("cryptography package not installed; run pip install cryptography")
    key = bytes.fromhex(payload["key_hex"])
    if len(key) != 32:
        raise ValueError("key must be 32 bytes (256 bits)")
    pt = base64.b64decode(payload["plaintext_b64"])
    aad = payload.get("aad", "").encode() if payload.get("aad") else None
    iv = os.urandom(12)
    ct_full = AESGCM(key).encrypt(iv, pt, aad)
    ct, tag = ct_full[:-16], ct_full[-16:]
    return {
        "alg": "AES-256-GCM",
        "iv": base64.b64encode(iv).decode(),
        "ct": base64.b64encode(ct).decode(),
        "tag": base64.b64encode(tag).decode(),
    }


def decrypt(payload: dict) -> dict:
    AESGCM = _aesgcm()
    if AESGCM is None:
        raise RuntimeError("cryptography package not installed; run pip install cryptography")
    key = bytes.fromhex(payload["key_hex"])
    iv = base64.b64decode(payload["iv_b64"])
    ct = base64.b64decode(payload["ct_b64"])
    tag = base64.b64decode(payload["tag_b64"])
    aad = payload.get("aad", "").encode() if payload.get("aad") else None
    pt = AESGCM(key).decrypt(iv, ct + tag, aad)
    return {"plaintext_b64": base64.b64encode(pt).decode()}


def selftest() -> None:
    if _aesgcm() is None:
        write_ok({"selftest": "skipped", "reason": "cryptography not installed"})
        return
    key = os.urandom(32).hex()
    msg = b"hello relay, this is a secret"
    enc = encrypt({"key_hex": key, "plaintext_b64": base64.b64encode(msg).decode(),
                   "aad": "channel:test"})
    dec = decrypt({"key_hex": key, "iv_b64": enc["iv"], "ct_b64": enc["ct"],
                   "tag_b64": enc["tag"], "aad": "channel:test"})
    assert base64.b64decode(dec["plaintext_b64"]) == msg
    # Tamper test
    bad_ct = base64.b64decode(enc["ct"])
    bad_ct = bytes([bad_ct[0] ^ 1, *bad_ct[1:]])
    tamper_caught = False
    try:
        decrypt({"key_hex": key, "iv_b64": enc["iv"],
                 "ct_b64": base64.b64encode(bad_ct).decode(),
                 "tag_b64": enc["tag"], "aad": "channel:test"})
    except Exception:
        tamper_caught = True
    assert tamper_caught
    write_ok({"selftest": "ok", "round_trip": True, "tamper_caught": True})


def handle(payload: dict) -> dict:
    if "iv_b64" in payload:
        return decrypt(payload)
    return encrypt(payload)


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        selftest()
    else:
        # Accept either envelope.encrypt or envelope.decrypt. We parse stdin
        # once here (run() would read stdin a second time and find it empty).
        import json as _j
        from _envelope import VERSION, write_error, write_ok  # noqa: E402
        raw = sys.stdin.read()
        if not raw.strip():
            write_error("empty_request", "stdin was empty")
            sys.exit(2)
        try:
            req = _j.loads(raw)
        except _j.JSONDecodeError as e:
            write_error("invalid_json", f"stdin is not valid JSON: {e}")
            sys.exit(2)
        if req.get("kind") != "request" or req.get("version") != VERSION:
            write_error("invalid_envelope",
                        "expected kind=request and matching version")
            sys.exit(2)
        cmd = req.get("command")
        if cmd not in ("envelope.encrypt", "envelope.decrypt"):
            write_error("wrong_command",
                        f"expected envelope.encrypt or envelope.decrypt; got {cmd!r}",
                        trace_id=req.get("trace_id"))
            sys.exit(2)
        try:
            result = handle(req.get("payload", {}))
        except Exception as e:  # noqa: BLE001 — boundary
            write_error("handler_failed", str(e), trace_id=req.get("trace_id"))
            sys.exit(1)
        write_ok(result, trace_id=req.get("trace_id"))
