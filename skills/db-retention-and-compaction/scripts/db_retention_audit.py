#!/usr/bin/env python3
"""
db_retention_audit.py — audit an embedded SQLite datastore for retention & compaction health.

Stdlib only (sqlite3, argparse). Read-only: opens the DB in immutable mode so it is safe to
point at a live service file — it never writes, never VACUUMs, never blocks writers.

What it reports:
  * File size on disk vs. logical size (page_count * page_size).
  * freelist_count and the RECLAIMABLE bytes trapped in it (freelist pages the OS never gets
    back until an INCREMENTAL vacuum or a full VACUUM runs).
  * auto_vacuum mode — the single most common reason a pruned DB never shrinks (the real
    port-daddy case: a 231 MB file that pruned rows for months and never gave back a byte
    because auto_vacuum was NONE).
  * journal_mode / wal_autocheckpoint — WAL tuning sanity.
  * Per-table row counts and byte footprint (via the dbstat virtual table when available).
  * COVERAGE: tables that have no declared retention policy. Pass the tables your retention
    registry covers via --registered (repeatable or comma-separated); every base table not in
    that set is flagged as UNBOUNDED — the "new table nobody wrote a DELETE for" trap.

Exit status:
  0  clean
  1  findings (unbounded tables, reclaimable-space waste, or auto_vacuum misconfig)
  2  usage / open error

Usage:
  python3 db_retention_audit.py /path/to/app.db
  python3 db_retention_audit.py app.db --registered metric_counters,activity_log,harbor_issued_tokens
  python3 db_retention_audit.py app.db --registered-file policies.txt --reclaim-warn-mb 20 --json
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from typing import Any


def open_ro(path: str) -> sqlite3.Connection:
    # immutable=1: read-only, assume no concurrent writer *modifying* the header we read.
    # This is the safe way to inspect a live WAL database without taking a lock.
    uri = f"file:{os.path.abspath(path)}?immutable=1"
    return sqlite3.connect(uri, uri=True)


def pragma(conn: sqlite3.Connection, name: str) -> Any:
    row = conn.execute(f"PRAGMA {name}").fetchone()
    return row[0] if row else None


AUTO_VACUUM_NAMES = {0: "NONE", 1: "FULL", 2: "INCREMENTAL"}


def base_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows]


def table_sizes(conn: sqlite3.Connection) -> dict[str, int]:
    """Bytes per table via dbstat. Returns {} if dbstat is unavailable (build without it)."""
    try:
        rows = conn.execute(
            "SELECT name, SUM(pgsize) FROM dbstat GROUP BY name"
        ).fetchall()
        return {name: (size or 0) for name, size in rows}
    except sqlite3.OperationalError:
        return {}


def row_count(conn: sqlite3.Connection, table: str) -> int:
    try:
        return conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    except sqlite3.OperationalError:
        return -1


def load_registered(args: argparse.Namespace) -> set[str]:
    reg: set[str] = set()
    for item in args.registered or []:
        reg.update(t.strip() for t in item.split(",") if t.strip())
    if args.registered_file:
        with open(args.registered_file, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.split("#", 1)[0].strip()
                if line:
                    reg.add(line)
    return reg


def human(n: int) -> str:
    f = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if f < 1024 or unit == "TB":
            return f"{f:.1f} {unit}" if unit != "B" else f"{int(f)} B"
        f /= 1024
    return f"{f:.1f} TB"


def audit(path: str, args: argparse.Namespace) -> dict[str, Any]:
    conn = open_ro(path)
    page_size = pragma(conn, "page_size")
    page_count = pragma(conn, "page_count")
    freelist = pragma(conn, "freelist_count") or 0
    auto_vacuum = AUTO_VACUUM_NAMES.get(pragma(conn, "auto_vacuum"), "?")
    journal_mode = pragma(conn, "journal_mode")
    wal_autockpt = pragma(conn, "wal_autocheckpoint")

    file_bytes = os.path.getsize(path)
    logical_bytes = (page_count or 0) * (page_size or 0)
    reclaimable = freelist * (page_size or 0)

    sizes = table_sizes(conn)
    registered = load_registered(args)
    tables = base_tables(conn)

    table_report = []
    unbounded = []
    for t in tables:
        rc = row_count(conn, t)
        sz = sizes.get(t, 0)
        covered = (not registered) or (t in registered)
        table_report.append({"table": t, "rows": rc, "bytes": sz, "covered": covered})
        if registered and t not in registered:
            unbounded.append(t)
    table_report.sort(key=lambda r: r["bytes"], reverse=True)
    conn.close()

    findings: list[str] = []
    if registered and unbounded:
        findings.append(
            f"UNBOUNDED: {len(unbounded)} table(s) have no registered retention policy: "
            + ", ".join(sorted(unbounded))
        )
    reclaim_warn = args.reclaim_warn_mb * 1024 * 1024
    if reclaimable >= reclaim_warn:
        findings.append(
            f"RECLAIMABLE: {human(reclaimable)} trapped in {freelist} freelist pages. "
            + (
                "auto_vacuum=NONE means pruning will NEVER shrink the file — run VACUUM once "
                "then set auto_vacuum=INCREMENTAL, or schedule periodic VACUUM."
                if auto_vacuum == "NONE"
                else "Call `PRAGMA incremental_vacuum` on the maintenance cycle to return pages to the OS."
            )
        )
    if auto_vacuum == "NONE" and reclaimable < reclaim_warn:
        findings.append(
            "AUTO_VACUUM=NONE: file cannot shrink from row deletion. Fine only if this DB "
            "never prunes; otherwise it will grow monotonically like the 231 MB case."
        )

    return {
        "path": os.path.abspath(path),
        "file_bytes": file_bytes,
        "logical_bytes": logical_bytes,
        "page_size": page_size,
        "page_count": page_count,
        "freelist_pages": freelist,
        "reclaimable_bytes": reclaimable,
        "auto_vacuum": auto_vacuum,
        "journal_mode": journal_mode,
        "wal_autocheckpoint": wal_autockpt,
        "tables": table_report,
        "unbounded": sorted(unbounded),
        "findings": findings,
    }


def print_human(rep: dict[str, Any]) -> None:
    print(f"Retention & Compaction Audit — {rep['path']}")
    print(f"  file on disk        : {human(rep['file_bytes'])}")
    print(f"  logical (pages)     : {human(rep['logical_bytes'])}  "
          f"({rep['page_count']} x {rep['page_size']} B pages)")
    print(f"  freelist / waste    : {rep['freelist_pages']} pages = {human(rep['reclaimable_bytes'])} reclaimable")
    print(f"  auto_vacuum         : {rep['auto_vacuum']}")
    print(f"  journal_mode        : {rep['journal_mode']}   wal_autocheckpoint={rep['wal_autocheckpoint']}")
    print("  largest tables:")
    for row in rep["tables"][:12]:
        flag = "" if row["covered"] else "  <-- UNBOUNDED (no policy)"
        size = human(row["bytes"]) if row["bytes"] else "n/a"
        print(f"    {row['table']:<32} {row['rows']:>10} rows   {size:>10}{flag}")
    if rep["findings"]:
        print("\nFINDINGS:")
        for f in rep["findings"]:
            print(f"  - {f}")
    else:
        print("\nNo findings — retention & compaction look healthy.")


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit a SQLite DB for retention & compaction health.")
    ap.add_argument("db", help="Path to the SQLite database file.")
    ap.add_argument("--registered", action="append", metavar="T1,T2",
                    help="Tables covered by a retention policy (repeatable or comma-separated). "
                         "Any base table not listed is flagged UNBOUNDED.")
    ap.add_argument("--registered-file", help="File with one covered table name per line (# comments ok).")
    ap.add_argument("--reclaim-warn-mb", type=float, default=10.0,
                    help="Warn when freelist waste exceeds this many MB (default 10).")
    ap.add_argument("--json", action="store_true", help="Emit JSON instead of a human report.")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print(f"error: no such file: {args.db}", file=sys.stderr)
        return 2
    try:
        rep = audit(args.db, args)
    except sqlite3.Error as e:
        print(f"error: could not open DB: {e}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(rep, indent=2))
    else:
        print_human(rep)
    return 1 if rep["findings"] else 0


if __name__ == "__main__":
    sys.exit(main())
