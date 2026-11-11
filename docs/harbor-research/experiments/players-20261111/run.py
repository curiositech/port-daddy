#!/usr/bin/env python3
"""Runner for the players battery, tests T2 to T8 (players-20261111).

  python3 run.py sessions                    every session, by test
  python3 run.py seal                        write seal.json over every material
  python3 run.py seal-check                  compare the materials with seal.json
  python3 run.py check                       each test's build --check and unit tests, then seal-check
  python3 run.py prepare SESSION             make the session directory; print the line a subject is launched with
  python3 run.py reply SESSION TRANSCRIPT    keep a subject's replies and its tool calls from its transcript
  python3 run.py collect SESSION             score a finished session into results/SESSION.json
  python3 run.py dryrun                      every test's controls through its pipeline
  python3 run.py report                      every test's verdict from results/

Each test lives in its own directory with its own manifest and command line
(tN/cli.py). This file seals them together and passes commands on. Standard
library only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

EXP_DIR = Path(__file__).resolve().parent
TESTS = ["t2", "t3", "t4", "t5", "t6", "t7", "t8"]
SCRATCH = Path("/tmp/claude-0/-home-claude/0d58d67c-91fe-5e53-93f2-1e6f62cdac74/scratchpad")
RUNS_ROOT = SCRATCH / "exp-runs-1111"
RESULTS = EXP_DIR / "results"
SEAL_PATH = EXP_DIR / "seal.json"
# Not sealed: what the runs produce, and the seal itself.
UNSEALED = ("results/", "dryrun/", "seal.json")
IGNORED = {"__pycache__", ".pytest_cache", ".DS_Store"}
LAUNCHER = (EXP_DIR / "launcher.txt")


def materials() -> dict[str, str]:
    """The sha256 of every sealed file, by its path under this directory."""
    found = {}
    for folder, folders, files in os.walk(EXP_DIR):
        folders[:] = sorted(name for name in folders if name not in IGNORED)
        for name in sorted(files):
            path = Path(folder) / name
            rel = path.relative_to(EXP_DIR).as_posix()
            if rel.startswith(UNSEALED) or name.endswith((".pyc", ".pyo")) or path.is_symlink():
                continue
            found[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    return found


def seal() -> int:
    note = ("sha256 of every material in this directory except results/, dryrun/ and this file. "
            "The commit that adds this file is the seal.")
    SEAL_PATH.write_text(json.dumps({"note": note, "files": materials()}, indent=1, sort_keys=True) + "\n")
    print(f"sealed {len(materials())} files")
    return 0


def seal_status() -> list[str]:
    if not SEAL_PATH.exists():
        return ["seal.json is missing"]
    sealed, now = json.loads(SEAL_PATH.read_text())["files"], materials()
    return sorted(name for name in set(sealed) | set(now) if sealed.get(name) != now.get(name))


def test_of(session: str) -> str:
    test = session.split("-")[0]
    if test not in TESTS:
        raise SystemExit(f"{session}: no such test; sessions are named t2-01 and so on")
    return test


def cli(test: str, *args: str) -> int:
    return subprocess.run([sys.executable, str(EXP_DIR / test / "cli.py"), *args], cwd=EXP_DIR).returncode


def sessions() -> dict[str, list[str]]:
    sys.path.insert(0, str(EXP_DIR))
    found = {}
    for test in TESTS:
        module = __import__(f"{test}.session", fromlist=["SESSIONS"])
        found[test] = [entry["session_id"] for entry in module.SESSIONS]
    return found


def launch_line(session: str) -> str:
    return LAUNCHER.read_text().strip().replace("<session dir>", str(RUNS_ROOT / session))


def reply(session: str, transcript: Path) -> int:
    """Keep what a subject said and did, from the transcript its harness wrote.

    The transcript is a file the subject cannot write. From it come the
    subject's closing reply, its answer to the debrief if one was asked, the
    model that served each turn, and every tool call with the paths it
    named. A path outside the session directory is listed, since a subject
    that read the experiment's materials is not a subject.
    """
    home = str(RUNS_ROOT / session)
    turns, calls, models = [], [], {}
    for line in transcript.read_text().splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        message = event.get("message") or {}
        content = message.get("content")
        if event.get("type") == "user" and isinstance(content, str):
            turns.append({"asked": content, "said": ""})
        if event.get("type") != "assistant" or not isinstance(content, list):
            continue
        model = message.get("model")
        if model:
            models[model] = models.get(model, 0) + 1
        for block in content:
            if block.get("type") == "text" and turns:
                turns[-1]["said"] = block.get("text", "")
            if block.get("type") == "tool_use":
                given = block.get("input") or {}
                named = " ".join(str(given.get(key, "")) for key in ("command", "file_path", "path", "pattern", "url", "query"))
                calls.append({"tool": block.get("name"), "named": named.strip()[:2000]})
    outside = [call for call in calls if "/" in call["named"] and home not in call["named"]]
    (RESULTS / "replies").mkdir(parents=True, exist_ok=True)
    (RESULTS / "traces").mkdir(parents=True, exist_ok=True)
    said = turns[0]["said"] if turns else ""
    text = [f"# {session}", "", "## Closing reply", "", said, ""]
    for turn in turns[1:]:
        text += ["## Asked afterwards", "", turn["asked"], "", "## Answer", "", turn["said"], ""]
    (RESULTS / "replies" / f"{session}.md").write_text("\n".join(text))
    trace = {"session": session, "transcript_sha256": hashlib.sha256(transcript.read_bytes()).hexdigest(),
             "models": models, "tool_calls": len(calls), "calls_naming_a_path_outside_the_session": outside,
             "turns": len(turns)}
    (RESULTS / "traces" / f"{session}.json").write_text(json.dumps(trace, indent=1) + "\n")
    print(f"{session}: {len(turns)} turn(s), {len(calls)} tool call(s), {len(outside)} naming a path outside, models {models}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("sessions", "seal", "seal-check", "check", "dryrun", "report"):
        sub.add_parser(name)
    for name in ("prepare", "collect"):
        sub.add_parser(name).add_argument("session")
    told = sub.add_parser("reply")
    told.add_argument("session")
    told.add_argument("transcript", type=Path)
    args = parser.parse_args(argv)

    if args.command == "sessions":
        for test, names in sessions().items():
            print(f"{test}: {len(names)}  {' '.join(names)}")
        print(f"total: {sum(len(names) for names in sessions().values())}")
        return 0
    if args.command == "seal":
        return seal()
    if args.command == "seal-check":
        differing = seal_status()
        print("materials match the seal" if not differing else "DIFFER FROM THE SEAL:\n  " + "\n  ".join(differing))
        return 1 if differing else 0
    if args.command == "check":
        failed = []
        for test in TESTS:
            if cli(test, "build", "--check") != 0:
                failed.append(f"{test}: build --check")
            unit = subprocess.run([sys.executable, "-m", "unittest", "-q", f"{test}.test_{test}"], cwd=EXP_DIR,
                                  env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
            if unit.returncode != 0:
                failed.append(f"{test}: unit tests")
        failed += [f"seal: {name}" for name in seal_status()]
        print("all checks pass" if not failed else "FAILED:\n  " + "\n  ".join(failed))
        return 1 if failed else 0
    if args.command == "prepare":
        if seal_status():
            raise SystemExit("the materials differ from the seal: no session may be prepared")
        code = cli(test_of(args.session), "prepare", args.session)
        print(launch_line(args.session))
        return code
    if args.command == "reply":
        return reply(args.session, args.transcript)
    if args.command == "collect":
        return cli(test_of(args.session), "collect", args.session)
    if args.command in ("dryrun", "report"):
        return max(cli(test, args.command) for test in TESTS)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
