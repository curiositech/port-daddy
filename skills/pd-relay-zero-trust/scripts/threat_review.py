#!/usr/bin/env python3
"""Walk the threat-model checklist against a proposal description.

Input  (Request.payload):
  {
    "proposal_title": str,
    "proposal_summary": str,
    "answers": {
      "exposes_new_surface_to": [adversary IDs],
      "relies_on_invariants":   [invariant IDs],
      "threatens_invariants":   [invariant IDs],
      "new_logs":               [log fields],
      "fail_mode_if_bypassed":  str,
      "key_material":           {described|"none"},
      "trust_boundary_crossed": [boundary names],
      "proverif_query_added":   bool | "n/a",
      "e2e_preserved":          bool   # required when threatens_invariants includes "I1"
    }
  }

Output: scored review with required follow-ups.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _envelope import run, write_ok  # noqa: E402

ADVERSARIES = {f"A{i}" for i in range(1, 9)}
INVARIANTS = {f"I{i}" for i in range(1, 9)}


def handle(payload: dict) -> dict:
    a = payload.get("answers", {})
    findings = []

    def add(sev: str, code: str, msg: str) -> None:
        findings.append({"severity": sev, "code": code, "message": msg})

    if not payload.get("proposal_title"):
        add("error", "missing_title", "proposal_title is required")
    if not payload.get("proposal_summary"):
        add("error", "missing_summary", "proposal_summary is required")

    surf = set(a.get("exposes_new_surface_to") or [])
    if surf - ADVERSARIES:
        add("error", "unknown_adversaries",
            f"unknown adversary IDs: {sorted(surf - ADVERSARIES)}")
    if not surf:
        add("warning", "no_surface_named",
            "proposal exposes no new surface to any adversary — verify this is honest")

    rel = set(a.get("relies_on_invariants") or [])
    if rel - INVARIANTS:
        add("error", "unknown_invariants_relied",
            f"unknown invariant IDs: {sorted(rel - INVARIANTS)}")

    thr = set(a.get("threatens_invariants") or [])
    if thr - INVARIANTS:
        add("error", "unknown_invariants_threatened",
            f"unknown invariant IDs: {sorted(thr - INVARIANTS)}")
    if thr:
        add("warning", "invariants_threatened",
            f"proposal threatens invariants {sorted(thr)} — must justify in ADR")

    if not a.get("fail_mode_if_bypassed"):
        add("error", "missing_fail_mode",
            "you must articulate the failure mode if this feature is bypassed")

    new_logs = a.get("new_logs") or []
    risky = [f for f in new_logs if any(s in f.lower()
              for s in ("payload", "plaintext", "secret", "password",
                        "private", "key", "token"))]
    if risky:
        add("error", "logs_contain_secrets",
            f"new logs include sensitive-sounding fields: {risky}")

    if "I1" in thr and not a.get("e2e_preserved"):
        add("error", "i1_violation",
            "threatening I1 (relay never sees plaintext) requires explicit refutation")

    crypto = a.get("key_material")
    if crypto and crypto != "none" and a.get("proverif_query_added") is False:
        add("warning", "missing_proverif",
            "feature uses key material; add a ProVerif query under apps/relay/formal/proverif/")

    score = 100
    score -= 25 * sum(1 for f in findings if f["severity"] == "error")
    score -= 5 * sum(1 for f in findings if f["severity"] == "warning")
    return {
        "title": payload.get("proposal_title"),
        "score": max(0, score),
        "findings": findings,
        "ship_block": any(f["severity"] == "error" for f in findings),
    }


def selftest() -> None:
    good = handle({
        "proposal_title": "Add fingerprint header to publish",
        "proposal_summary": "Include sender fingerprint as explicit header for routing.",
        "answers": {
            "exposes_new_surface_to": ["A1"],
            "relies_on_invariants": ["I1"],
            "threatens_invariants": [],
            "new_logs": ["sender_fingerprint", "channel"],
            "fail_mode_if_bypassed": "Routing falls back to per-event payload sniff (degraded)",
            "key_material": "none",
            "trust_boundary_crossed": [],
            "proverif_query_added": "n/a",
        },
    })
    assert good["ship_block"] is False, good
    bad = handle({
        "proposal_title": "Log payloads for debug",
        "proposal_summary": "Temporarily store decrypted payloads.",
        "answers": {
            "exposes_new_surface_to": ["A1", "A2"],
            "relies_on_invariants": [],
            "threatens_invariants": ["I1"],
            "new_logs": ["payload_plaintext"],
            "fail_mode_if_bypassed": "Debug logs leak content",
            "key_material": "channel_key",
            "trust_boundary_crossed": ["publisher->relay"],
            "proverif_query_added": False,
        },
    })
    assert bad["ship_block"] is True, bad
    write_ok({"selftest": "ok", "good_score": good["score"],
              "bad_findings": bad["findings"]})


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        selftest()
    else:
        run(handle, expected_command="threat.review")
