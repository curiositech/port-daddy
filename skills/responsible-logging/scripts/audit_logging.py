#!/usr/bin/env python3
"""
audit_logging.py — scan a service/daemon codebase for the responsible-logging
anti-patterns, ranked by severity. Stdlib-only, no dependencies.

It flags, by EXACT code tokens (not NLP over prose — this reads structured source
you control):

  CARDINAL  error/warn-level log calls that sit inside an unthrottled loop / retry /
            poll / interval / event handler with no visible dedup or backoff. This is
            the shape that wrote 313 GB in the Port Daddy incident.
  HIGH      launchd .plist / systemd .service units that capture stdout/stderr to a
            file the service framework never rotates (the "captured stdout is never
            rotated" trap).
  HIGH      winston/pino File transports declared without maxsize/maxFiles (or
            equivalent) — an unbounded, unrotated log file.
  MEDIUM    raw console.* / print / println / fmt.Print* / System.out sprawl that
            bypasses the one structured logger.

Usage:
  audit_logging.py <path> [--json] [--quiet]
  audit_logging.py .            # audit the current repo
  audit_logging.py src --json   # machine-readable findings

Exit code: 0 = clean, 1 = at least one CARDINAL finding, 2 = only lower-severity
findings. Wire the exit code into CI to keep the class of bug closed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

# --- what "logging" looks like across stacks (exact tokens, case-sensitive) ---------
LOG_ERROR = re.compile(
    r"""(?ix)
    \b(?:
        (?:logger|log|logging|console|slog)\s*\.\s*(?:error|fatal|warn|warning|critical)
      | log\.(?:Error|Warn|Fatal|Panic)          # Go zerolog/logrus
      | (?:tracing|log)::(?:error|warn)!          # Rust
    )\s*\(
    """,
)
# raw stdout/stderr writes that bypass a structured logger
RAW_SINKS = re.compile(
    r"""(?x)
    \b(?:
        console\.(?:log|info|debug|error|warn)
      | System\.(?:out|err)\.print
      | fmt\.(?:Print|Println|Printf|Fprintln|Fprintf)
      | print!|println!|eprintln!|eprint!            # Rust macros
    )\b
    """,
)
# loop / retry / poll / interval / handler openers — the "unthrottled" context
LOOP_CONTEXT = re.compile(
    r"""(?x)
    \b(?:
        for | while | forever | loop
      | setInterval | setTimeout
      | retry | backoff | poll | heartbeat | tick
      | \.on\s*\(            # event handler registration
      | addEventListener
    )\b
    """,
)
# tokens that indicate the loop IS already governed — suppress false positives
GOVERNED = re.compile(
    r"""(?ix)
    \b(?:
        governed | logGovernor | log_governor | rateLimit | rate_limit
      | dedup | throttle | sample | once | circuitbreaker | circuit_breaker
      | breaker | backoff\s*\( | suppress
    )\b
    """,
)

CODE_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs", ".py", ".java", ".kt"}
UNIT_EXT = {".plist", ".service"}
SKIP_DIRS = {".git", "node_modules", "dist", "build", "target", "vendor", ".venv", "coverage", "__pycache__"}

WINDOW = 8  # lines of context to look back/forward for loop signals


def iter_files(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            ext = os.path.splitext(name)[1]
            if ext in CODE_EXT or ext in UNIT_EXT:
                yield os.path.join(dirpath, name), ext


def scan_code(path: str, lines: list[str], findings: list[dict]):
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(("//", "#", "*", "/*")):
            continue
        # CARDINAL: error/warn log inside a loop/retry/poll context, not governed
        if LOG_ERROR.search(line):
            lo, hi = max(0, i - WINDOW), min(len(lines), i + WINDOW + 1)
            ctx = "".join(lines[lo:hi])
            if LOOP_CONTEXT.search(ctx) and not GOVERNED.search(ctx):
                findings.append({
                    "severity": "CARDINAL",
                    "file": path, "line": i + 1,
                    "rule": "error-log-in-unthrottled-loop",
                    "text": stripped[:160],
                    "hint": "Route through a per-key LogGovernor (dedup+rate-limit+rollup) or add backoff.",
                })
        # MEDIUM: raw sink sprawl
        if RAW_SINKS.search(line):
            findings.append({
                "severity": "MEDIUM",
                "file": path, "line": i + 1,
                "rule": "raw-sink-bypasses-logger",
                "text": stripped[:160],
                "hint": "Use the one structured logger, not raw console/print sprawl.",
            })


def scan_unit(path: str, text: str, findings: list[dict]):
    ext = os.path.splitext(path)[1]
    if ext == ".plist":
        # launchd: StandardOutPath/StandardErrorPath capture to a file launchd never rotates.
        if re.search(r"Standard(?:Out|Error)Path", text):
            findings.append({
                "severity": "HIGH",
                "file": path, "line": 0,
                "rule": "launchd-captured-stdout-never-rotated",
                "text": "StandardOutPath/StandardErrorPath present",
                "hint": "launchd never rotates this file. Log to a rotating transport, or pipe via newsyslog/logrotate; keep stdout terse.",
            })
    elif ext == ".service":
        if re.search(r"Standard(?:Output|Error)\s*=\s*(?:append|file):", text):
            findings.append({
                "severity": "HIGH",
                "file": path, "line": 0,
                "rule": "systemd-file-capture-never-rotated",
                "text": "StandardOutput/StandardError=file:/append: present",
                "hint": "systemd file: capture is not rotated. Prefer journald (StandardOutput=journal) or a rotating sink.",
            })


def scan_transport(path: str, text: str, findings: list[dict]):
    # winston/pino File transport with no size/count cap = unbounded log file.
    for m in re.finditer(r"(?s)transports\.File\s*\((\{.*?\})\)", text):
        block = m.group(1)
        if "maxsize" not in block and "maxSize" not in block:
            line = text[: m.start()].count("\n") + 1
            findings.append({
                "severity": "HIGH",
                "file": path, "line": line,
                "rule": "unrotated-file-transport",
                "text": "winston File transport without maxsize/maxFiles",
                "hint": "Set maxsize + maxFiles (e.g. 50MB x 5, tailable) so the file self-rotates.",
            })


def audit(root: str) -> list[dict]:
    findings: list[dict] = []
    for path, ext in iter_files(root):
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        if ext in UNIT_EXT:
            scan_unit(path, text, findings)
            continue
        lines = text.splitlines(keepends=True)
        scan_code(path, lines, findings)
        scan_transport(path, text, findings)
    order = {"CARDINAL": 0, "HIGH": 1, "MEDIUM": 2}
    findings.sort(key=lambda f: (order.get(f["severity"], 9), f["file"], f["line"]))
    return findings


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit a codebase for responsible-logging anti-patterns.")
    ap.add_argument("path", help="Directory (or file) to scan.")
    ap.add_argument("--json", action="store_true", help="Emit findings as JSON.")
    ap.add_argument("--quiet", action="store_true", help="Only print the summary + non-zero exit.")
    args = ap.parse_args()

    if not os.path.exists(args.path):
        print(f"error: path not found: {args.path}", file=sys.stderr)
        return 3

    findings = audit(args.path)
    counts = {sev: sum(1 for f in findings if f["severity"] == sev) for sev in ("CARDINAL", "HIGH", "MEDIUM")}

    if args.json:
        print(json.dumps({"counts": counts, "findings": findings}, indent=2))
    else:
        if not args.quiet:
            for f in findings:
                loc = f"{f['file']}:{f['line']}" if f["line"] else f["file"]
                print(f"[{f['severity']:8}] {f['rule']}\n           {loc}\n           {f['text']}\n           -> {f['hint']}\n")
        print(f"Summary: {counts['CARDINAL']} CARDINAL, {counts['HIGH']} HIGH, {counts['MEDIUM']} MEDIUM")

    if counts["CARDINAL"]:
        return 1
    if counts["HIGH"] or counts["MEDIUM"]:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
