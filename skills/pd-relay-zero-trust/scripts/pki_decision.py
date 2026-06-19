#!/usr/bin/env python3
"""Score PKI options against weighted criteria.

Input  (Request.payload):
  {
    "options": ["ACME", "OIDC", "WoT", "Hybrid"],   # required
    "weights": {"C1": 4, ...},                       # optional override
    "scores":  {"ACME": {"C1": 2, ...}, ...}         # optional override
  }

Output (Response.result):
  {
    "weights": {...used...},
    "scores":  {...used...},
    "ranked":  [{"option": "Hybrid", "score": 158}, ...],
    "tie_break_needed": bool,
    "narrative": "..."
  }

Selftest exits 0 with a fixed sample.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _envelope import run, write_ok  # noqa: E402

DEFAULT_WEIGHTS = {
    "C1": 4, "C2": 3, "C3": 4, "C4": 2, "C5": 3, "C6": 4,
    "C7": 3, "C8": 4, "C9": 3, "C10": 3, "C11": 3, "C12": 4,
}

DEFAULT_SCORES = {
    "ACME":   {"C1": 2, "C2": 3, "C3": 4, "C4": 2, "C5": 4, "C6": 3,
               "C7": 3, "C8": 3, "C9": 3, "C10": 5, "C11": 5, "C12": 4},
    "OIDC":   {"C1": 5, "C2": 4, "C3": 5, "C4": 1, "C5": 3, "C6": 4,
               "C7": 2, "C8": 4, "C9": 3, "C10": 4, "C11": 5, "C12": 4},
    "WoT":    {"C1": 1, "C2": 5, "C3": 1, "C4": 5, "C5": 5, "C6": 2,
               "C7": 5, "C8": 5, "C9": 4, "C10": 3, "C11": 3, "C12": 5},
    "Hybrid": {"C1": 5, "C2": 4, "C3": 5, "C4": 2, "C5": 4, "C6": 4,
               "C7": 3, "C8": 2, "C9": 2, "C10": 5, "C11": 5, "C12": 4},
}


def score(option: str, weights: dict[str, int],
          scores: dict[str, dict[str, int]]) -> int:
    s = 0
    for crit, w in weights.items():
        s += w * scores.get(option, {}).get(crit, 0)
    return s


def handle(payload: dict) -> dict:
    options = payload.get("options") or list(DEFAULT_SCORES.keys())
    weights = {**DEFAULT_WEIGHTS, **(payload.get("weights") or {})}
    scores = {opt: {**DEFAULT_SCORES.get(opt, {}),
                    **((payload.get("scores") or {}).get(opt) or {})}
              for opt in options}

    ranked = sorted(
        ({"option": opt, "score": score(opt, weights, scores)} for opt in options),
        key=lambda r: r["score"], reverse=True,
    )
    tie = (len(ranked) >= 2
           and abs(ranked[0]["score"] - ranked[1]["score"]) <= 5)
    narrative = (
        f"Top: {ranked[0]['option']} ({ranked[0]['score']}). "
        f"Runner-up: {ranked[1]['option']} ({ranked[1]['score']})." if len(ranked) >= 2 else
        f"Only option: {ranked[0]['option']}."
    )
    if tie:
        narrative += " Margin <= 5: dispatch deliberation set; do not auto-decide."
    return {
        "weights": weights,
        "scores": scores,
        "ranked": ranked,
        "tie_break_needed": tie,
        "narrative": narrative,
    }


def selftest() -> None:
    out = handle({})
    assert out["ranked"][0]["option"] in {"Hybrid", "OIDC"}, out
    write_ok({"selftest": "ok", "default_winner": out["ranked"][0]})


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        selftest()
    else:
        run(handle, expected_command="pki.score")
