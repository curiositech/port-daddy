#!/usr/bin/env python3
"""Run `cargo check --message-format=json` and emit a compact, paste-ready digest of
the compiler diagnostics — the thing this skill says to always hand Claude: the FULL
message, the error code, the file:line:col span, and the rendered snippet.

Why this exists: the #1 way Rust+AI sessions go sideways is pasting only the first line
of a borrow-checker error. cargo's JSON message stream carries the full structured
diagnostic; this distills it so you (or an agent) paste the WHOLE constraint shape, which
is what Claude pattern-matches on. It is read-only: it never edits code.

Two modes:
  - As a script-io tool:  command `diagnostics.parse`, payload {"crate_dir": "...", "args": [...]}
  - As a CLI:             `cargo_diagnostics.py run --crate core/pd-console`
        or pipe a captured stream:  `cargo check --message-format=json | cargo_diagnostics.py parse`

`--selftest` parses a fixed sample stream (no cargo needed) and asserts the digest shape.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _envelope import run, write_ok, write_error  # noqa: E402


def _distill(lines: list[str]) -> dict[str, Any]:
    """Turn a cargo --message-format=json stream into a digest."""
    diags: list[dict[str, Any]] = []
    counts = {"error": 0, "warning": 0}
    for raw in lines:
        raw = raw.strip()
        if not raw or not raw.startswith("{"):
            continue
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if msg.get("reason") != "compiler-message":
            continue
        m = msg.get("message", {})
        level = m.get("level", "")
        if level not in ("error", "warning"):
            continue
        counts[level] = counts.get(level, 0) + 1
        primary = next((s for s in m.get("spans", []) if s.get("is_primary")), None)
        diags.append({
            "level": level,
            "code": (m.get("code") or {}).get("code"),
            "message": m.get("message", ""),
            "span": (
                f"{primary['file_name']}:{primary['line_start']}:{primary['column_start']}"
                if primary else None
            ),
            # The rendered block is the full, human-readable diagnostic — exactly what to
            # paste to Claude. Trim to keep the digest sane.
            "rendered": (m.get("rendered") or "").rstrip()[:2000],
        })
    return {
        "ok": counts["error"] == 0,
        "errors": counts["error"],
        "warnings": counts["warning"],
        "diagnostics": diags,
        "paste_to_claude": "\n\n".join(d["rendered"] for d in diags if d["rendered"]),
    }


def from_crate(crate_dir: str, extra_args: list[str]) -> dict[str, Any]:
    if not os.path.isdir(crate_dir):
        return {"ok": False, "errors": 0, "warnings": 0, "diagnostics": [],
                "error": f"crate dir not found: {crate_dir}"}
    cmd = ["cargo", "check", "--message-format=json", *extra_args]
    try:
        r = subprocess.run(cmd, cwd=crate_dir, capture_output=True, text=True, timeout=1800)
    except FileNotFoundError:
        return {"ok": False, "errors": 0, "warnings": 0, "diagnostics": [],
                "error": "cargo not on PATH"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "errors": 0, "warnings": 0, "diagnostics": [],
                "error": "cargo check timed out (>30m)"}
    return _distill(r.stdout.splitlines())


def handler(payload: dict[str, Any]) -> dict[str, Any]:
    return from_crate(payload.get("crate_dir", "."), payload.get("args", []))


# A minimal real cargo JSON line (a borrow-checker E0502) for the selftest.
_SAMPLE = json.dumps({
    "reason": "compiler-message",
    "message": {
        "level": "error",
        "code": {"code": "E0502"},
        "message": "cannot borrow `self.agents` as mutable because it is also borrowed as immutable",
        "spans": [{"is_primary": True, "file_name": "src/app.rs", "line_start": 142, "column_start": 9}],
        "rendered": "error[E0502]: cannot borrow `self.agents` as mutable...\n  --> src/app.rs:142:9",
    },
})


def selftest() -> dict[str, Any]:
    out = _distill([_SAMPLE, "not json", "{}"])
    assert out["errors"] == 1, out
    assert out["ok"] is False
    d = out["diagnostics"][0]
    assert d["code"] == "E0502" and d["span"] == "src/app.rs:142:9", d
    assert "paste_to_claude" in out and out["paste_to_claude"]
    return {"ok": True, "parsed_errors": out["errors"]}


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        crate = "."
        if "--crate" in sys.argv:
            crate = sys.argv[sys.argv.index("--crate") + 1]
        extra = [a for a in sys.argv[2:] if a not in ("--crate", crate)]
        out = from_crate(crate, extra)
        if out.get("ok") or out.get("errors", 0) == 0:
            write_ok(out)
        else:
            write_error("has_errors", "cargo check reported errors", hint=str(out))
            sys.exit(1)
    elif len(sys.argv) > 1 and sys.argv[1] == "parse":
        write_ok(_distill(sys.stdin.read().splitlines()))
    else:
        run(handler, "diagnostics.parse", selftest=selftest)
