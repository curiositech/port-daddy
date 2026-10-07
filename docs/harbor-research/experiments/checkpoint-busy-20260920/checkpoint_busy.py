#!/usr/bin/env python3
"""One serial, two-connection SQLite checkpoint-busy witness. No crash test.

Outputs may only be created in a NEW run-NN directory beside this script.
No existing database is accepted as input. No cleanup or overwrite operation.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPECTED = {
    "journal_mode": "wal", "synchronous": 1,
    "busy_timeout": 0, "wal_autocheckpoint": 0,
}
BASELINE = [[1, "synthetic baseline"]]
LATEST = BASELINE + [[2, "synthetic later commit"]]


def resolve_new_run(base, name):
    """Read-only preflight; mkdir(exist_ok=False) remains the creation guard."""
    base = Path(base)
    if not re.fullmatch(r"run-[0-9]{2}", name):
        raise ValueError("Only a run-NN child name is accepted")
    if base.is_symlink() or not base.is_dir():
        raise ValueError("Lab must be an existing real directory")
    target = base / name
    if target.exists() or target.is_symlink():
        raise FileExistsError("Refusing to reuse an existing run or symlink")
    return target


def checkpoint_complete(result):
    """Only completion of this checkpoint, NEVER physical durability proof."""
    return (isinstance(result, (list, tuple)) and len(result) == 3
            and all(type(x) is int for x in result)
            and result[0] == 0 and result[1] >= 0 and result[1] == result[2])


def validate_witness(w):
    assert w["connection_count"] == 2
    assert w["settings"] == {"writer": EXPECTED, "reader": EXPECTED}
    obs = w["observations"]
    assert obs["reader_initial"] == BASELINE
    assert obs["writer_after_commit"] == LATEST
    assert obs["reader_after_writer_commit"] == BASELINE
    assert obs["reader_after_busy"] == BASELINE
    assert obs["writer_after_busy"] == LATEST
    assert obs["reader_after_release_and_retry"] == LATEST
    first, second = w["checkpoint_attempts"]
    assert first["command_issued"] is True and first["reader_transaction_active"] is True
    assert first["triple"][0] == 1 and 0 <= first["triple"][2] < first["triple"][1]
    assert first["completion_verified"] is False and not checkpoint_complete(first["triple"])
    assert second["command_issued"] is True and second["reader_transaction_active"] is False
    assert second["completion_verified"] is True and checkpoint_complete(second["triple"])
    assert w["durability_verified"] is False
    assert w["process_crash_tested"] is False and w["power_loss_tested"] is False


def write_json_new(path, value):
    with path.open("x", encoding="utf-8") as out:
        json.dump(value, out, indent=2)
        out.write("\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run", default="run-01", help="Fresh child only; never an existing path")
    args = ap.parse_args()
    run_dir = resolve_new_run(HERE, args.run)
    run_dir.mkdir(mode=0o700, exist_ok=False)
    db = run_dir / "synthetic.sqlite3"
    # Reserve this exact fresh file before SQLite opens it; mode=rw cannot create
    # a different database if a path is mistyped or disappears.
    fd = os.open(str(db), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    uri = db.as_uri() + "?mode=rw"
    events = []
    writer = reader = None
    witness = {
        "run_id": args.run, "started_utc": datetime.now(timezone.utc).isoformat(),
        "python_version": sys.version, "python_executable": sys.executable,
        "sqlite_version": sqlite3.sqlite_version,
        "sqlite_module_version": sqlite3.version,
        "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "launch_argv": sys.argv, "cwd": str(Path.cwd()),
        "database": str(db), "database_uri": uri,
        "connection_count": 2, "connect_arguments": {"uri": True, "timeout": 0, "isolation_level": None},
        "execution": "One process; serial calls; two explicit connections; no threads",
        "settings": {}, "commands": events, "observations": {}, "checkpoint_attempts": [],
        "durability_verified": False, "process_crash_tested": False, "power_loss_tested": False,
    }

    def sql(connection, role, statement):
        before = connection.in_transaction
        cur = connection.execute(statement)
        rows = [list(row) for row in cur.fetchall()]
        cur.close()
        events.append({"sequence": len(events) + 1, "connection": role, "sql": statement,
                       "rows": rows, "transaction_before": before,
                       "transaction_after": connection.in_transaction})
        return rows

    def observe(connection, role, name):
        rows = sql(connection, role, "SELECT id, payload FROM synthetic_rows ORDER BY id;")
        witness["observations"][name] = rows

    def checkpoint():
        active = reader.in_transaction
        rows = sql(writer, "writer", "PRAGMA main.wal_checkpoint(FULL);")
        assert len(rows) == 1 and len(rows[0]) == 3
        triple = rows[0]
        witness["checkpoint_attempts"].append({
            "command_issued": True, "reader_transaction_active": active,
            "triple": triple, "completion_verified": checkpoint_complete(triple),
        })

    try:
        # The only two database opens in this runner. Neither accepts user data.
        writer = sqlite3.connect(uri, uri=True, timeout=0, isolation_level=None)
        reader = sqlite3.connect(uri, uri=True, timeout=0, isolation_level=None)
        for role, connection in (("writer", writer), ("reader", reader)):
            for command in ("PRAGMA main.journal_mode=WAL;", "PRAGMA main.synchronous=NORMAL;",
                            "PRAGMA busy_timeout=0;", "PRAGMA wal_autocheckpoint=0;"):
                sql(connection, role, command)
            settings = {}
            for key, command in (("journal_mode", "PRAGMA main.journal_mode;"),
                                 ("synchronous", "PRAGMA main.synchronous;"),
                                 ("busy_timeout", "PRAGMA busy_timeout;"),
                                 ("wal_autocheckpoint", "PRAGMA wal_autocheckpoint;")):
                settings[key] = sql(connection, role, command)[0][0]
            assert settings == EXPECTED, settings
            witness["settings"][role] = settings

        witness["sqlite_source_id"] = sql(writer, "writer", "SELECT sqlite_source_id();")[0][0]
        sql(writer, "writer", "CREATE TABLE synthetic_rows (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);")
        sql(writer, "writer", "BEGIN IMMEDIATE;")
        sql(writer, "writer", "INSERT INTO synthetic_rows VALUES (1, 'synthetic baseline');")
        sql(writer, "writer", "COMMIT;")
        sql(reader, "reader", "BEGIN;")
        observe(reader, "reader", "reader_initial")  # BEGIN alone does not pin the snapshot.
        sql(writer, "writer", "BEGIN IMMEDIATE;")
        sql(writer, "writer", "INSERT INTO synthetic_rows VALUES (2, 'synthetic later commit');")
        sql(writer, "writer", "COMMIT;")
        observe(writer, "writer", "writer_after_commit")
        observe(reader, "reader", "reader_after_writer_commit")
        checkpoint()
        observe(reader, "reader", "reader_after_busy")
        observe(writer, "writer", "writer_after_busy")
        sql(reader, "reader", "ROLLBACK;")  # Read-only transaction; release its snapshot.
        checkpoint()
        observe(reader, "reader", "reader_after_release_and_retry")
        validate_witness(witness)

        # Preserve bytes while both connections are quiescent, before SQLite's
        # normal last-close housekeeping can remove its WAL/shm sidecars.
        # These are witness copies, not a tested backup/restore mechanism.
        saved = run_dir / "pre-close-files"
        saved.mkdir(mode=0o700)
        witness["pre_close_file_witnesses"] = {}
        for suffix in ("", "-wal", "-shm"):
            original = Path(str(db) + suffix)
            assert original.is_file() and not original.is_symlink()
            data = original.read_bytes()
            destination = saved / original.name
            with destination.open("xb") as out:
                out.write(data)
            witness["pre_close_file_witnesses"][str(destination.relative_to(run_dir))] = {
                "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            }
        witness["finite_assertions"] = "pass"
    except Exception as exc:
        witness["finite_assertions"] = "failed"
        witness["error"] = {"type": type(exc).__name__, "message": str(exc)}
        write_json_new(run_dir / "failed-results.json", witness)
        raise
    finally:
        if reader is not None:
            reader.close()
        if writer is not None:
            writer.close()

    witness["normal_close"] = "Connections closed normally; no explicit cleanup or deletion"
    witness["database_after_close_sha256"] = hashlib.sha256(db.read_bytes()).hexdigest()
    results = run_dir / "results.json"
    write_json_new(results, witness)
    print(json.dumps({"results": str(results), "sha256": hashlib.sha256(results.read_bytes()).hexdigest(),
                      "checkpoint_triples": [a["triple"] for a in witness["checkpoint_attempts"]],
                      "assertions": witness["finite_assertions"], "durability_verified": False}, indent=2))


if __name__ == "__main__":
    main()
