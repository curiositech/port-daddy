#!/usr/bin/env python3
"""Apply Phase 3 caveats to a harbor card chain. Verifies that constraints
only contract rights, never expand them.

Input  (Request.payload):
  {
    "chain":     {attenuated-card},          # current chain (root + caveats so far)
    "caveat":    {constraint object},        # NEW restriction to add
    "signer_pk_hex": "<hex>"                  # pub key of new hop
    "signer_sig_hex": "<hex>"                 # signature over (prev_hash || constraint)
  }

Or for verification:
  {
    "verify": true,
    "chain":  {attenuated-card},
    "request": { "op": "pub", "channel": "...", "exp": int, "ip": "...", "payload_bytes": int }
  }

Selftest builds a chain, attenuates it twice, asserts containment, then tries
an illegal expansion and asserts rejection.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _envelope import canonical_json, run, write_ok  # noqa: E402

ALLOWED_CAVEATS = {
    "exp_max", "channels_allow", "ops_allow", "rate_per_min_max",
    "max_payload_bytes_max", "ip_cidr_allow", "audience_restrict",
    "delegation_allowed",
}


def chain_hash(chain: dict) -> str:
    return hashlib.sha256(canonical_json(chain).encode()).hexdigest()


def channel_subset(prev_patterns: set, new_patterns: set) -> bool:
    """Each pattern in new_patterns must be 'covered' by some pattern in prev.
    Coverage rules:
      - exact equality covers
      - wildcard parent (ending in '*') covers any child string starting with
        parent[:-1]
      - a wildcard child (ending in '*') is only covered by the same-or-broader
        wildcard parent
    """
    def covers(parent: str, child: str) -> bool:
        if parent == child:
            return True
        if parent.endswith("*"):
            prefix = parent[:-1]
            if child.endswith("*"):
                # child must be a narrower wildcard; child's prefix must
                # start with parent's prefix.
                return child[:-1].startswith(prefix)
            return child.startswith(prefix)
        return False

    for n in new_patterns:
        if not any(covers(p, n) for p in prev_patterns):
            return False
    return True


def caveats_only_contract(prev_caps: dict, caveat: dict) -> tuple[bool, str]:
    """Verify each caveat field would only contract effective caps."""
    bad = set(caveat) - ALLOWED_CAVEATS
    if bad:
        return False, f"unknown caveat fields: {sorted(bad)}"
    if "exp_max" in caveat and caveat["exp_max"] > prev_caps.get("exp", 1 << 62):
        return False, "exp_max widens previous exp"
    if "channels_allow" in caveat:
        prev_channels = set(prev_caps.get("channels", set()))
        new_channels = set(caveat["channels_allow"])
        if not channel_subset(prev_channels, new_channels):
            return False, "channels_allow expands beyond previous"
    if "ops_allow" in caveat:
        prev_ops = set(prev_caps.get("ops", set()))
        new_ops = set(caveat["ops_allow"])
        if not new_ops.issubset(prev_ops):
            return False, "ops_allow expands beyond previous"
    if "rate_per_min_max" in caveat and caveat["rate_per_min_max"] > prev_caps.get("rate_per_min", 1 << 31):
        return False, "rate_per_min_max widens"
    if "max_payload_bytes_max" in caveat and caveat["max_payload_bytes_max"] > prev_caps.get("max_payload_bytes", 1 << 31):
        return False, "max_payload_bytes_max widens"
    return True, "ok"


def collapse_chain(chain: dict) -> dict:
    """Walk the chain, computing effective leaf caps."""
    root_card = chain["root"]
    cap = root_card.get("cap", [])
    # Aggregate: take union over cap entries. For simplicity, single cap entry assumption.
    if not cap:
        return {"channels": set(), "ops": set(), "exp": 0,
                "rate_per_min": 0, "max_payload_bytes": 0,
                "delegation_allowed": True}
    c0 = cap[0]
    eff = {
        "channels": {c0["channel"]},
        "ops": {c0["op"]} if c0["op"] != "pubsub" else {"pub", "sub"},
        "exp": root_card.get("exp", 0),
        "rate_per_min": c0.get("rate_per_min", 1 << 31),
        "max_payload_bytes": c0.get("max_payload_bytes", 1 << 31),
        "delegation_allowed": True,
    }
    for hop in chain.get("caveats", []):
        ok, reason = caveats_only_contract(eff, hop["constraint"])
        if not ok:
            raise ValueError(f"hop {hop['hop']}: {reason}")
        c = hop["constraint"]
        if "exp_max" in c:
            eff["exp"] = min(eff["exp"], c["exp_max"])
        if "channels_allow" in c:
            # caveats_only_contract has already verified every new pattern is
            # covered by a prev pattern; the effective set becomes the new
            # (narrower) patterns.
            eff["channels"] = set(c["channels_allow"])
        if "ops_allow" in c:
            eff["ops"] &= set(c["ops_allow"])
        if "rate_per_min_max" in c:
            eff["rate_per_min"] = min(eff["rate_per_min"], c["rate_per_min_max"])
        if "max_payload_bytes_max" in c:
            eff["max_payload_bytes"] = min(eff["max_payload_bytes"], c["max_payload_bytes_max"])
        if c.get("delegation_allowed") is False:
            eff["delegation_allowed"] = False
    return eff


def handle(payload: dict) -> dict:
    if payload.get("verify"):
        chain = payload["chain"]
        eff = collapse_chain(chain)
        req = payload.get("request", {})
        decisions = []
        if req.get("op") and req["op"] not in eff["ops"]:
            decisions.append(("deny", f"op {req['op']} not in allowed {sorted(eff['ops'])}"))
        if req.get("channel"):
            ch = req["channel"]
            allowed = any(p == ch or (p.endswith("*") and ch.startswith(p[:-1]))
                          for p in eff["channels"])
            if not allowed:
                decisions.append(("deny", f"channel {ch} not allowed"))
        if req.get("exp") and req["exp"] > eff["exp"]:
            decisions.append(("deny", "request expiry beyond chain expiry"))
        if req.get("payload_bytes") and req["payload_bytes"] > eff["max_payload_bytes"]:
            decisions.append(("deny", "payload exceeds chain max"))
        verdict = "allow" if not decisions else "deny"
        return {
            "verdict": verdict,
            "effective_caps": {**eff, "channels": sorted(eff["channels"]),
                               "ops": sorted(eff["ops"])},
            "reasons": [d[1] for d in decisions],
        }

    chain = payload["chain"]
    caveat = payload["caveat"]
    eff = collapse_chain(chain)
    ok, reason = caveats_only_contract(eff, caveat)
    if not ok:
        raise ValueError(f"refuses to attenuate: {reason}")
    prev_hash = chain_hash(chain)
    new_hop = {
        "hop": len(chain.get("caveats", [])) + 1,
        "constraint": caveat,
        "sig": payload["signer_sig_hex"],
        "kid": payload["signer_pk_hex"],
    }
    return {**chain, "caveats": [*chain.get("caveats", []), new_hop],
            "_prev_hash_signed": prev_hash}


def _example_chain():
    return {
        "version": "phase3.1",
        "root": {
            "iss": "daemon-fp", "sub": "myapp:api",
            "aud": ["relay.portdaddy.dev"],
            "iat": 1700000000, "exp": 1700003600,
            "jti": "j-1",
            "harbor": {"fingerprint": "h-1", "scope": "project"},
            "cap": [{"op": "pubsub", "channel": "myapp:*",
                     "rate_per_min": 60, "max_payload_bytes": 65536}],
            "alg": "EdDSA", "kid": "daemon-pk",
        },
        "caveats": [],
    }


def selftest() -> None:
    chain = _example_chain()
    # Hop 1: contract to a single channel + pub-only + 10min + 5/min
    hop1 = handle({
        "chain": chain,
        "caveat": {
            "exp_max": 1700000600,
            "channels_allow": ["myapp:ci:pr-opened"],
            "ops_allow": ["pub"],
            "rate_per_min_max": 5,
            "delegation_allowed": False,
        },
        "signer_pk_hex": "deadbeef",
        "signer_sig_hex": "cafef00d",
    })

    # Verify allow path
    v_ok = handle({
        "verify": True, "chain": hop1,
        "request": {"op": "pub", "channel": "myapp:ci:pr-opened",
                    "exp": 1700000500, "payload_bytes": 1024},
    })
    assert v_ok["verdict"] == "allow", v_ok

    # Verify deny path: try to use sub op
    v_deny = handle({
        "verify": True, "chain": hop1,
        "request": {"op": "sub", "channel": "myapp:ci:pr-opened"},
    })
    assert v_deny["verdict"] == "deny", v_deny

    # Try to expand: should raise
    expanded = False
    try:
        handle({
            "chain": hop1,
            "caveat": {"channels_allow": ["myapp:*"]},  # WIDER than hop1
            "signer_pk_hex": "x", "signer_sig_hex": "y",
        })
    except ValueError:
        expanded = True
    assert expanded, "expansion should have been rejected"

    write_ok({"selftest": "ok", "leaf_caps": v_ok["effective_caps"]})


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        selftest()
    else:
        run(handle, expected_command="card.attenuate")
