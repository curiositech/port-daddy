#!/usr/bin/env python3
"""Audit a whole library of skill bundles and persist results to SQLite.

Discovers every directory containing a SKILL.md beneath each configured root,
runs audit_skill_bundle.py on it, and writes one atomic run-snapshot to a
SQLite database. Also emits a JSON summary (for downstream consumers like a
webpage) and a human-readable summary to stdout.

Database location (XDG-friendly):
    ${SKILL_HYGIENE_DB:-$HOME/.local/share/skill-hygiene/audit.db}

Schema (created idempotently):
    audit_runs    (id, run_at, auditor_version, total, passing, failing,
                   warning_only, summary_json)
    skill_audits  (id, run_id, skill_name, skill_root, ok, orphans_count,
                   drift_count, broken_links_count, missing_indexes_failure,
                   missing_indexes_warning, report_json)
    skill_issues  (id, audit_id, issue_type, path, detail_json)

Atomicity: every run writes within a single transaction. WAL mode is enabled
so readers (e.g. a webpage exporter) never see partial runs.

Usage:
    python3 audit_skill_library.py [--root skills] [--root other/skills]
                                    [--snapshot path/to/snapshot.json]
                                    [--db path/to/audit.db]
                                    [--auditor path/to/audit_skill_bundle.py]
                                    [--limit N]
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

AUDITOR_VERSION = "0.2.0"
SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at TEXT NOT NULL,
    auditor_version TEXT NOT NULL,
    total INTEGER NOT NULL,
    passing INTEGER NOT NULL,
    failing INTEGER NOT NULL,
    warning_only INTEGER NOT NULL,
    duration_seconds REAL,
    summary_json TEXT
);

CREATE TABLE IF NOT EXISTS skill_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
    skill_name TEXT NOT NULL,
    skill_root TEXT NOT NULL,
    ok INTEGER NOT NULL,
    orphans_count INTEGER NOT NULL,
    drift_count INTEGER NOT NULL,
    broken_links_count INTEGER NOT NULL,
    missing_indexes_failure INTEGER NOT NULL,
    missing_indexes_warning INTEGER NOT NULL,
    report_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_audits_run ON skill_audits(run_id);
CREATE INDEX IF NOT EXISTS idx_skill_audits_name ON skill_audits(skill_name);
CREATE INDEX IF NOT EXISTS idx_skill_audits_ok ON skill_audits(ok);

CREATE TABLE IF NOT EXISTS skill_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id INTEGER NOT NULL REFERENCES skill_audits(id) ON DELETE CASCADE,
    issue_type TEXT NOT NULL,
    path TEXT,
    detail_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_skill_issues_audit ON skill_issues(audit_id);
CREATE INDEX IF NOT EXISTS idx_skill_issues_type ON skill_issues(issue_type);
"""


def default_db_path() -> Path:
    env = os.environ.get("SKILL_HYGIENE_DB")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / ".local" / "share" / "skill-hygiene" / "audit.db"


def open_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    return conn


def discover_skills(roots: list[Path]) -> list[Path]:
    out: list[Path] = []
    for root in roots:
        root = root.resolve()
        if not root.is_dir():
            continue
        for sd in sorted(root.iterdir()):
            if not sd.is_dir():
                continue
            if (sd / "SKILL.md").exists():
                out.append(sd)
    return out


def run_one_audit(auditor: Path, skill_root: Path) -> dict:
    result = subprocess.run(
        ["python3", str(auditor), str(skill_root), "--json"],
        capture_output=True, text=True,
    )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {
            "skill_root": str(skill_root),
            "ok": False,
            "_parse_error": True,
            "_stdout": result.stdout[:500],
            "_stderr": result.stderr[:500],
        }


def issue_rows_for_report(report: dict) -> list[tuple[str, str | None, str]]:
    """(issue_type, path, detail_json) for every issue in the report."""
    rows: list[tuple[str, str | None, str]] = []
    for o in report.get("orphans") or []:
        rows.append(("orphan", o, json.dumps({})))
    for d in report.get("drift") or []:
        idx_path = d.get("index")
        for entry in d.get("missing_from_index") or []:
            rows.append(("missing_from_index", idx_path, json.dumps({"entry": entry})))
        for entry in d.get("ghost_entries") or []:
            rows.append(("ghost_entry", idx_path, json.dumps({"entry": entry})))
    for b in report.get("broken_links") or []:
        rows.append((
            "broken_link",
            b.get("from"),
            json.dumps({k: b.get(k) for k in ("target", "resolved", "kind", "suggestions")}),
        ))
    for m in report.get("missing_indexes_failure") or []:
        rows.append(("missing_index_failure", m, json.dumps({})))
    for m in report.get("missing_indexes_warning") or []:
        rows.append(("missing_index_warning", m, json.dumps({})))
    return rows


def persist_run(conn: sqlite3.Connection, audits: list[dict],
                duration_seconds: float) -> tuple[int, dict]:
    """Insert one run snapshot atomically. Returns (run_id, summary_stats)."""
    total = len(audits)
    passing = sum(1 for a in audits if a["report"]["ok"])
    failing = total - passing
    warning_only = sum(
        1 for a in audits
        if a["report"]["ok"] and (a["report"].get("missing_indexes_warning") or [])
    )

    summary = {
        "total": total,
        "passing": passing,
        "failing": failing,
        "warning_only": warning_only,
        "failing_skills": sorted(a["skill_name"] for a in audits if not a["report"]["ok"]),
    }

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    cur = conn.cursor()
    cur.execute(
        "INSERT INTO audit_runs (run_at, auditor_version, total, passing, failing, "
        "warning_only, duration_seconds, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (now, AUDITOR_VERSION, total, passing, failing, warning_only,
         duration_seconds, json.dumps(summary)),
    )
    run_id = cur.lastrowid

    for a in audits:
        report = a["report"]
        cur.execute(
            "INSERT INTO skill_audits (run_id, skill_name, skill_root, ok, "
            "orphans_count, drift_count, broken_links_count, "
            "missing_indexes_failure, missing_indexes_warning, report_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                run_id,
                a["skill_name"],
                a["skill_root"],
                1 if report["ok"] else 0,
                len(report.get("orphans") or []),
                len(report.get("drift") or []),
                len(report.get("broken_links") or []),
                len(report.get("missing_indexes_failure") or []),
                len(report.get("missing_indexes_warning") or []),
                json.dumps(report),
            ),
        )
        audit_id = cur.lastrowid
        for issue_type, path, detail_json in issue_rows_for_report(report):
            cur.execute(
                "INSERT INTO skill_issues (audit_id, issue_type, path, detail_json) "
                "VALUES (?, ?, ?, ?)",
                (audit_id, issue_type, path, detail_json),
            )

    conn.commit()
    return run_id, summary


def _relativise(skill_root: str, base: Path) -> str:
    """Return a repo-relative path for the snapshot, never an absolute one."""
    p = Path(skill_root)
    try:
        return p.relative_to(base).as_posix()
    except ValueError:
        return p.name


def write_snapshot(snapshot_path: Path, run_id: int, summary: dict,
                   audits: list[dict], base: Path, deterministic: bool = False) -> None:
    """Write the snapshot. In deterministic mode the run_id and generated_at
    are omitted so commits don't churn on irrelevant metadata — the file only
    diffs when the actual audit findings change.

    Non-deterministic mode (the default) preserves run_id + generated_at for
    consumers that care about trend over time (the SkillAuditPage shows the
    run timestamp, for instance, when a real run from SQLite is available).
    """
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot: dict = {
        "auditor_version": AUDITOR_VERSION,
        "summary": summary,
        "skills": [
            {
                "name": a["skill_name"],
                "root": _relativise(a["skill_root"], base),
                "ok": a["report"]["ok"],
                "orphans": a["report"].get("orphans") or [],
                "drift": a["report"].get("drift") or [],
                "broken_links": a["report"].get("broken_links") or [],
                "missing_indexes_failure": a["report"].get("missing_indexes_failure") or [],
                "missing_indexes_warning": a["report"].get("missing_indexes_warning") or [],
            }
            for a in audits
        ],
    }
    if not deterministic:
        snapshot["run_id"] = run_id
        snapshot["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    snapshot_path.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", action="append", dest="roots",
                        help="skill library root (repeatable). Default: skills/")
    parser.add_argument("--auditor", default="skills/skill-hygiene/scripts/audit_skill_bundle.py")
    parser.add_argument("--db", default=str(default_db_path()))
    parser.add_argument("--snapshot", default=None,
                        help="write a JSON snapshot of this run to this path")
    parser.add_argument("--limit", type=int, default=0,
                        help="audit at most this many skills (0 = no limit)")
    parser.add_argument("--no-persist", action="store_true",
                        help="do not write to SQLite (snapshot still emitted if --snapshot given)")
    parser.add_argument("--deterministic", action="store_true",
                        help="omit run_id and generated_at from the snapshot so commits "
                             "of the snapshot file don't churn on metadata. Recommended for "
                             "any snapshot that gets checked in.")
    args = parser.parse_args()

    roots = [Path(r) for r in (args.roots or ["skills"])]
    auditor = Path(args.auditor).resolve()
    if not auditor.exists():
        print(f"ERROR: auditor not found: {auditor}", file=sys.stderr)
        return 2

    skills = discover_skills(roots)
    if args.limit:
        skills = skills[:args.limit]
    print(f"Auditing {len(skills)} skill(s) across {len(roots)} root(s)...", file=sys.stderr)

    t0 = time.time()
    audits: list[dict] = []
    for sd in skills:
        report = run_one_audit(auditor, sd)
        audits.append({
            "skill_name": sd.name,
            "skill_root": str(sd),
            "report": report,
        })
    duration = time.time() - t0

    run_id: int | None = None
    if args.no_persist:
        passing = sum(1 for a in audits if a["report"]["ok"])
        summary = {"total": len(audits), "passing": passing,
                   "failing": len(audits) - passing}
    else:
        db_path = Path(args.db).expanduser().resolve()
        conn = open_db(db_path)
        try:
            run_id, summary = persist_run(conn, audits, duration)
        finally:
            conn.close()
        print(f"Persisted run #{run_id} to {db_path}", file=sys.stderr)

    if args.snapshot:
        snap_path = Path(args.snapshot).expanduser().resolve()
        write_snapshot(
            snap_path, run_id or 0, summary, audits,
            base=Path.cwd().resolve(),
            deterministic=args.deterministic,
        )
        print(f"Wrote snapshot to {snap_path}", file=sys.stderr)

    print(f"\nLibrary audit summary ({duration:.1f}s)")
    print(f"  total:   {summary['total']}")
    print(f"  passing: {summary['passing']}")
    print(f"  failing: {summary['failing']}")
    if summary.get("warning_only"):
        print(f"  passing w/ warnings: {summary['warning_only']}")
    if summary.get("failing_skills"):
        print(f"\n  Failing:")
        for s in summary["failing_skills"]:
            print(f"    - {s}")

    return 0 if summary["failing"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
