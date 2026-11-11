#!/usr/bin/env python3
"""Pipeline runner for this working copy.

    run.py ci                  bring the working copy up to date with main and
                               the ticket tracker, then run the tests
    run.py promise "<text>"    record what you will deliver and take the claim
                               on the ticket's files
    run.py release             release the claim

Every call is appended to records/log.jsonl with a hash chain, together with
the state of the working copy at that moment. Self-contained so that it runs
under `python3 -I`.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "config.json").read_text())
REPO = Path(CONFIG["repo"])
FEED = HERE / "feed.bin"
RECORDS = HERE / "records"
LOG = RECORDS / "log.jsonl"
BLOBS = RECORDS / "blobs"
IGNORED_NAMES = {"__pycache__", ".pytest_cache", ".DS_Store"}
IGNORED_SUFFIXES = (".pyc", ".pyo")
RULE = "=" * 72
USAGE = {
    "ci": "usage: ./ci    (no arguments)",
    "promise": 'usage: ./promise "<one sentence saying what you will deliver>"',
    "release": "usage: ./release    (no arguments)",
}


# ------------------------------------------------------------------ record

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


def snapshot():
    """Hash of every file in the working copy; the bytes go to records/blobs."""
    BLOBS.mkdir(parents=True, exist_ok=True)
    out = {}
    for dirpath, dirnames, filenames in os.walk(REPO):
        dirnames[:] = sorted(d for d in dirnames if d not in IGNORED_NAMES)
        for name in sorted(filenames):
            full = Path(dirpath) / name
            rel = full.relative_to(REPO).as_posix()
            if rel.endswith(IGNORED_SUFFIXES) or name in IGNORED_NAMES or full.is_symlink():
                continue
            data = full.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            blob = BLOBS / digest
            if not blob.exists():
                blob.write_bytes(data)
            out[rel] = digest
    return out


def open_claim(log):
    """Number of the claim that is held now, or None."""
    held = None
    for e in log:
        if e["kind"] == "promise":
            held = e["n"]
        elif e["kind"] == "release":
            held = None
    return held


def usage(cmd, args):
    append({"kind": "usage", "cmd": cmd, "argv": [a[:200] for a in args[:8]]})
    print(USAGE[cmd])
    print("Nothing was done.")
    return 2


# ------------------------------------------------------------------ sync

def unpack(raw):
    """Read the packed feed of main and the ticket tracker."""
    salt, size = raw[4:20], int.from_bytes(raw[20:24], "big")
    body, stream, block = raw[24:24 + size], b"", 0
    while len(stream) < size:
        stream += hashlib.sha256(salt + block.to_bytes(4, "big")).digest()
        block += 1
    return json.loads(zlib.decompress(bytes(a ^ b for a, b in zip(body, stream))))


def sync(run_no, log):
    """Bring the working copy up to date. Returns main's head and any notice lines."""
    feed = unpack(FEED.read_bytes())
    head, notice = feed["head"], []
    seen = {e["item"] for e in log if e["kind"] == "sync"}
    for item, ev in enumerate(feed["events"]):
        if item in seen:
            head = ev.get("head", head)
            continue
        if ev["at"] > run_no:
            continue
        before = snapshot()
        for rel, text in sorted(ev.get("put", {}).items()):
            dest = REPO / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text)
        for rel in ev.get("drop", []):
            (REPO / rel).unlink(missing_ok=True)
        head = ev.get("head", head)
        append({"kind": "sync", "item": item, "run": run_no, "head": head, "before": before,
                "after": snapshot(), "put": sorted(ev.get("put", {})), "drop": sorted(ev.get("drop", []))})
        notice += ev["lines"]
    return head, notice


# ------------------------------------------------------------------ tests

def run_tests():
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR")}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    with tempfile.TemporaryDirectory() as tmp:
        xml = Path(tmp) / "junit.xml"
        cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", f"--junitxml={xml}"]
        try:
            proc = subprocess.run(cmd, cwd=REPO, env=env, capture_output=True, text=True, timeout=120)
            code, text = proc.returncode, proc.stdout + proc.stderr
        except subprocess.TimeoutExpired:
            code, text = "timeout", "pytest did not finish within 120 seconds\n"
        cases = []
        if xml.exists():
            try:
                for tc in ET.parse(xml).getroot().iter("testcase"):
                    bad = any(child.tag in ("failure", "error", "skipped") for child in tc)
                    cases.append((tc.get("classname") or "", tc.get("name") or "", not bad))
            except ET.ParseError:
                pass
    steps = []
    for step in CONFIG["steps"]:
        module = step["tests"][:-3].replace("/", ".")
        mine = [ok for classname, name, ok in cases if module in (classname, name)]
        steps.append({"name": step["name"], "tests": step["tests"],
                      "passed": sum(mine), "failed": len(mine) - sum(mine)})
    green = code == 0 and all(s["failed"] == 0 and s["passed"] > 0 for s in steps)
    return {"exit": code, "green": green, "steps": steps}, text


# ------------------------------------------------------------------ commands

def cmd_ci(args):
    if args:
        return usage("ci", args)
    log = read_log()
    run_no = sum(1 for e in log if e["kind"] == "ci") + 1
    head, notice = sync(run_no, log)
    print(f"ci run #{run_no} for {CONFIG['ticket']}")
    if notice:
        print(RULE)
        print("NOTICE")
        for line in notice:
            print(line)
        print(RULE)
    else:
        print(f"sync: main is at {head}. Nothing new on main or in the ticket tracker.")
    result, text = run_tests()
    print("tests:")
    for s in result["steps"]:
        state = "green" if s["failed"] == 0 and s["passed"] > 0 else "red"
        print(f"  {s['name']}  {s['tests']}  {s['passed']} passed, {s['failed']} failed  [{state}]")
    tail = [ln for ln in text.splitlines() if ln.strip()][-25:]
    if not result["green"] and tail:
        print("pytest said:")
        for ln in tail:
            print("  " + ln[:200])
    print("result: " + ("GREEN" if result["green"] else "RED"))
    append({"kind": "ci", "run": run_no, "head": head, "tree": snapshot(), "tests": result})
    return 0 if result["green"] else 1


def cmd_promise(args):
    if len(args) != 1 or not args[0].strip() or args[0].lstrip().startswith("-"):
        return usage("promise", args)
    log = read_log()
    held = open_claim(log)
    if held is not None:
        append({"kind": "refused", "cmd": "promise", "why": "a claim is already held", "tree": snapshot()})
        print(f"promise: you already hold claim C-{held} for promise P-{held}. Nothing was recorded.")
        print("Run ./release first if you want to start again.")
        return 3
    n = sum(1 for e in log if e["kind"] == "promise") + 1
    text = " ".join(args[0].split())
    append({"kind": "promise", "n": n, "text": text, "claim": CONFIG["claim"], "tree": snapshot()})
    print(f"Promise P-{n} recorded for {CONFIG['ticket']}: {text}")
    print(f"Claim C-{n} taken on: " + ", ".join(CONFIG["claim"]))
    print("The claim stays yours until you run ./release.")
    return 0


def cmd_release(args):
    if args:
        return usage("release", args)
    log = read_log()
    held = open_claim(log)
    if held is None:
        append({"kind": "refused", "cmd": "release", "why": "no claim is held", "tree": snapshot()})
        print("release: you hold no claim on this ticket. Nothing was released.")
        return 3
    append({"kind": "release", "n": held, "tree": snapshot()})
    print(f"Released claim C-{held} on: " + ", ".join(CONFIG["claim"]))
    print(f"Promise P-{held} is closed.")
    return 0


def main(argv):
    commands = {"ci": cmd_ci, "promise": cmd_promise, "release": cmd_release}
    if len(argv) < 2 or argv[1] not in commands:
        print(__doc__)
        return 2
    return commands[argv[1]](argv[2:])


if __name__ == "__main__":
    sys.exit(main(sys.argv))
