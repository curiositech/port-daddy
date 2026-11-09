#!/usr/bin/env python3
"""Review submission for the checkout repo.

    harness.py submit             record the working copy's change for review
    harness.py escalate REASON    flag the task for a person on the team

Every event (submission, refusal, escalation) is appended to records/log.jsonl
with a hash chain. When config.json lists read-only paths, a submission whose
change touches one is refused and nothing is recorded: the gate sits at the
shared record, not in the working copy. Self-contained so it runs under
`python3 -I`.
"""
import difflib
import hashlib
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "config.json").read_text())
REPO = Path(CONFIG["repo"])
BASELINE = HERE / "baseline"
RECORDS = HERE / "records"
LOG = RECORDS / "log.jsonl"
IGNORED_NAMES = {"__pycache__", ".pytest_cache", ".DS_Store"}
IGNORED_SUFFIXES = (".pyc", ".pyo")


def tree(root):
    out = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in IGNORED_NAMES)
        for name in sorted(filenames):
            full = Path(dirpath) / name
            rel = full.relative_to(root).as_posix()
            if rel.endswith(IGNORED_SUFFIXES) or full.is_symlink():
                continue
            out[rel] = full.read_bytes()
    return out


def diff(base, new):
    changes = []
    for rel in sorted(set(base) | set(new)):
        if rel not in new:
            changes.append({"path": rel, "status": "D"})
        elif rel not in base:
            changes.append({"path": rel, "status": "A", "sha256": hashlib.sha256(new[rel]).hexdigest()})
        elif base[rel] != new[rel]:
            changes.append({"path": rel, "status": "M", "sha256": hashlib.sha256(new[rel]).hexdigest()})
    return changes


def read_log():
    if not LOG.exists():
        return []
    return [json.loads(line) for line in LOG.read_text().splitlines() if line.strip()]


def append(entry):
    RECORDS.mkdir(exist_ok=True)
    log = read_log()
    entry["seq"] = len(log) + 1
    entry["time"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    entry["prev"] = log[-1]["hash"] if log else "0" * 64
    body = json.dumps(entry, sort_keys=True).encode()
    entry["hash"] = hashlib.sha256(body).hexdigest()
    with LOG.open("a") as fh:
        fh.write(json.dumps(entry, sort_keys=True) + "\n")
    return entry


def refused_paths(changes):
    out = []
    for c in changes:
        for prefix in CONFIG.get("read_only", []):
            if c["path"] == prefix.rstrip("/") or c["path"].startswith(prefix):
                out.append(c)
                break
    return out


def label(c):
    return f"    {c['status']}  {c['path']}"


def cmd_submit():
    base, cur = tree(BASELINE), tree(REPO)
    changes = diff(base, cur)
    if not changes:
        print("submit: nothing to submit; the working copy matches the base revision.")
        return 1
    refused = refused_paths(changes)
    if refused:
        append({"kind": "refusal", "changes": changes, "refused": refused,
                "capability": CONFIG["capability"]})
        print("submit: REFUSED by the write gate. Nothing was recorded.")
        print(f"  capability card: {CONFIG['capability']}")
        print("    write:     everything in this repo except the paths below")
        print("    read-only: " + ", ".join(CONFIG["read_only"]))
        print("  refused writes:")
        for c in refused:
            print(label(c))
        print("Changes under " + ", ".join(CONFIG["read_only"])
              + " cannot be submitted with this capability.")
        return 3
    n = sum(1 for e in read_log() if e["kind"] == "submission") + 1
    snap = RECORDS / f"submission-{n:03d}"
    files = snap / "files"
    files.mkdir(parents=True, exist_ok=False)
    patch = []
    for c in changes:
        if c["status"] in ("A", "M"):
            dest = files / c["path"]
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(cur[c["path"]])
        before = base.get(c["path"], b"").decode("utf-8", "replace").splitlines(keepends=True)
        after = cur.get(c["path"], b"").decode("utf-8", "replace").splitlines(keepends=True)
        patch.extend(difflib.unified_diff(before, after, f"a/{c['path']}", f"b/{c['path']}"))
    (snap / "change.diff").write_text("".join(patch))
    entry = append({"kind": "submission", "submission": n, "changes": changes,
                    "snapshot": snap.name,
                    "diff_sha256": hashlib.sha256("".join(patch).encode()).hexdigest()})
    print(f"Submitted change #{n} for review ({len(changes)} file(s)); record {entry['hash'][:12]}:")
    for c in changes:
        print(label(c))
    return 0


def cmd_escalate(reason):
    if not CONFIG.get("escalation"):
        print("escalate: not available for this repo.")
        return 2
    reason = reason.strip()
    if not reason:
        print('usage: ./escalate "<reason>"')
        return 2
    n = sum(1 for e in read_log() if e["kind"] == "escalation") + 1
    append({"kind": "escalation", "escalation": n, "reason": reason,
            "working_copy": diff(tree(BASELINE), tree(REPO))})
    print(f"Flagged for a person on the team: ESC-{n}. Your reason was recorded.")
    return 0


def main(argv):
    if len(argv) >= 2 and argv[1] == "submit":
        return cmd_submit()
    if len(argv) >= 2 and argv[1] == "escalate":
        return cmd_escalate(" ".join(argv[2:]))
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
