#!/usr/bin/env python3
"""
audit_self_monitoring.py — find the failure-visibility gaps that let a service
bloat its own storage in silence.

This is a STRUCTURED CODE-SYMBOL scan, not text/NLP classification. It matches
concrete API surface (function names, process-handler registrations, pragma
calls) that are either present or absent — the same thing `grep` does, reported
as a gap checklist. It never tries to infer intent from prose.

What it checks (each is a real incident precondition):

  1. PULL-ONLY / WHOLE-DISK measurement present, OWN-FOOTPRINT sampling absent.
     Symptom of "measuring the wrong thing": the code asks the OS how full the
     volume is (statvfs / disk free / df) but never reads its OWN store size
     (page_count*page_size, WAL bytes, per-table COUNT). The 313 GB write storm
     lived exactly here.

  2. NO BACKGROUND SAMPLER. Footprint is only computed inside a request handler
     / status endpoint (pull-only) — nobody is watching between requests. Looks
     for a periodic driver (setInterval / setTimeout loop / cron / scheduler)
     near the footprint read.

  3. MISSING GLOBAL FAILURE HANDLERS. No process-level uncaughtException /
     unhandledRejection (Node) or equivalent, so a crash leaves no durable trace.

  4. UNGOVERNED ERROR LOGGING IN A LOOP. error-level logging inside a loop with
     no dedup/rate-limit governor — the classic self-inflicted disk-eater.

Usage:
    python3 audit_self_monitoring.py <path> [--json] [--ext .ts,.js,.py]

Exit code is non-zero if any HIGH-severity gap is found (CI-friendly).
"""

import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List

# ── Structured symbol sets (API surface, not natural language) ─────────────

# Whole-disk / free-space probes: right question, wrong subject.
WHOLE_DISK = [
    r"\bstatvfs\b", r"\bstatfs\b", r"os\.statvfs", r"check[-_]?disk[-_]?space",
    r"\bdiskusage\b", r"free[-_]?disk", r"disk[-_]?free", r"\bdf\s+-", r"shutil\.disk_usage",
]

# Own-footprint reads: the RIGHT subject.
OWN_FOOTPRINT = [
    r"page_count", r"page_size", r"[-_]wal\b", r"wal[-_]?bytes", r"walBytes",
    r"dbBytes", r"COUNT\(\*\)", r"rowCount", r"pragma\(",
]

# Periodic drivers: evidence the sampler runs without a human.
PERIODIC = [
    r"setInterval\s*\(", r"setTimeout\s*\(", r"scheduleAtFixedRate",
    r"cron", r"schedule\.", r"asyncio\.sleep", r"time\.sleep", r"\.every\(",
]

# Global failure-visibility handlers.
GLOBAL_HANDLERS = [
    r"uncaughtException", r"unhandledRejection", r"sys\.excepthook",
    r"set_exception_handler", r"panic::set_hook", r"SIGSEGV",
]

# Governor / dedup / rate-limit surface.
GOVERNOR = [
    r"governed\s*\(", r"LogGovernor", r"rate[-_]?limit", r"dedup", r"\bthrottle\b",
    r"sampleEveryN", r"windowMs", r"suppress",
]

ERROR_LOG = [
    r"\.error\s*\(", r"log\.error", r"logger\.error", r"console\.error",
    r"logging\.error", r"log::error", r"tracing::error",
]

LOOP = [r"\bfor\s*\(", r"\bwhile\s*\(", r"for\s+\w+\s+in\b", r"\.forEach\(", r"setInterval\s*\("]


def _any(patterns: List[str], text: str) -> bool:
    return any(re.search(p, text) for p in patterns)


def _loop_with_ungoverned_error(text: str) -> bool:
    """Heuristic: an error-log call textually inside a loop body, no governor in file."""
    if _any(GOVERNOR, text):
        return False
    lines = text.split("\n")
    depth_stack: List[int] = []  # indentation/brace tracking is overkill; use a sliding window
    for i, line in enumerate(lines):
        if _any(LOOP, line):
            window = "\n".join(lines[i : i + 25])
            if _any(ERROR_LOG, window):
                return True
    return False


@dataclass
class Finding:
    gap: str
    severity: str
    detail: str
    files: List[str] = field(default_factory=list)


def audit(root: Path, exts: List[str]) -> List[Finding]:
    files = [p for p in root.rglob("*") if p.is_file() and p.suffix in exts
             and "node_modules" not in p.parts and ".git" not in p.parts]

    whole_disk_files, own_files, periodic_files = [], [], []
    handler_files, ungoverned_files = [], []

    for p in files:
        try:
            t = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = str(p.relative_to(root))
        if _any(WHOLE_DISK, t):
            whole_disk_files.append(rel)
        if _any(OWN_FOOTPRINT, t):
            own_files.append(rel)
        if _any(GLOBAL_HANDLERS, t):
            handler_files.append(rel)
        if _any(OWN_FOOTPRINT, t) and _any(PERIODIC, t):
            periodic_files.append(rel)
        if _loop_with_ungoverned_error(t):
            ungoverned_files.append(rel)

    findings: List[Finding] = []

    # Gap 1: measuring the wrong thing.
    if whole_disk_files and not own_files:
        findings.append(Finding(
            "wrong-subject", "high",
            "Whole-disk/free-space probes present but NO own-footprint read "
            "(page_count*page_size, WAL bytes, per-table COUNT). This is the "
            "'measured the wrong thing' gap — a runaway in your own store never trips.",
            whole_disk_files))

    # Gap 2: pull-only (no background sampler).
    if own_files and not periodic_files:
        findings.append(Finding(
            "pull-only", "high",
            "Own-footprint reads exist but none run on a periodic driver "
            "(setInterval/cron/scheduler). Footprint is computed only on request — "
            "nobody is watching between pulls.",
            own_files))

    # Gap 0: no footprint awareness at all.
    if not own_files:
        findings.append(Finding(
            "no-footprint-monitor", "high",
            "No own-footprint sampling found anywhere. Add a background SelfMonitor "
            "reading DB bytes, WAL bytes, and per-table row counts.",
            []))

    # Gap 3: missing global failure handlers.
    if not handler_files:
        findings.append(Finding(
            "no-global-handlers", "medium",
            "No global uncaughtException/unhandledRejection (or equivalent) handler "
            "found. A crash or rejected promise leaves no durable trace.",
            []))

    # Gap 4: ungoverned error logging in a loop.
    if ungoverned_files:
        findings.append(Finding(
            "ungoverned-loop-logging", "high",
            "error-level logging inside a loop with no dedup/rate-limit governor in "
            "the file. This is the self-inflicted disk-eater — route it through a "
            "LogGovernor with a stable dedup key.",
            ungoverned_files))

    return findings


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit a codebase for self-monitoring gaps.")
    ap.add_argument("path", type=Path)
    ap.add_argument("--json", action="store_true", help="emit JSON")
    ap.add_argument("--ext", default=".ts,.js,.tsx,.mjs,.py,.go,.rs",
                    help="comma-separated file extensions to scan")
    args = ap.parse_args()

    if not args.path.exists():
        print(f"path not found: {args.path}", file=sys.stderr)
        return 2

    exts = [e if e.startswith(".") else f".{e}" for e in args.ext.split(",")]
    findings = audit(args.path, exts)

    if args.json:
        print(json.dumps([asdict(f) for f in findings], indent=2))
    else:
        if not findings:
            print("✓ No self-monitoring gaps detected.")
        else:
            print(f"\nSelf-monitoring audit: {args.path}\n" + "=" * 52)
            for f in findings:
                sym = {"high": "✗", "medium": "⚠", "low": "·"}.get(f.severity, "·")
                print(f"\n  {sym} [{f.severity.upper()}] {f.gap}")
                print(f"     {f.detail}")
                for path in f.files[:8]:
                    print(f"       - {path}")
                if len(f.files) > 8:
                    print(f"       … and {len(f.files) - 8} more")
            print()

    return 1 if any(f.severity == "high" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
