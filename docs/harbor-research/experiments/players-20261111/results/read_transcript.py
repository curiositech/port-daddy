#!/usr/bin/env python3
"""Read a subject's transcript. Written after the seal: it replaces the
transcript walk of `run.py reply`, which is sealed and stays as it was.

  python3 results/read_transcript.py SESSION TRANSCRIPT

The sealed reader assumed two things about the harness's transcripts, and
both turned out wrong once subjects ran:

- A subject's closing report is not a text block. It is the `message` of a
  call to the harness's `SubagentHandback` tool. The sealed reader would
  have kept an empty reply for every session.
- The harness adds messages of its own to a transcript, marked `isMeta`: a
  reminder about `SubagentHandback` at the start, and the debrief itself,
  which arrives between a line the harness puts before it ("The
  coordinator sent a message while you were working:") and one it puts
  after ("Address this before completing your current task."). The sealed
  reader counted the first of these messages as the debrief.

This reader fixes the walk and nothing else. It writes the same files in
the same shape, so the sealed runner's other commands read them
unchanged. The path check (`run.strays`) and the debrief parser
(`run.debrief`) are the sealed ones, imported.

It also records what the sealed reader did not know to look for: the
working directory the harness gave the subject, which is the directory of
the session that launched it and not the session directory.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import run  # noqa: E402  (the sealed runner)

RELAYED = "The coordinator sent a message while you were working:\n"
URGED = "Address this before completing your current task."
HANDBACK = "SubagentHandback"


def walk(transcript: Path, home: str) -> dict:
    turns, calls, models, cwds = [], [], {}, {}
    for line in transcript.read_text().splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("cwd"):
            cwds[event["cwd"]] = cwds.get(event["cwd"], 0) + 1
        message = event.get("message") or {}
        content = message.get("content")
        if event.get("type") == "user" and isinstance(content, str):
            if not event.get("isMeta"):
                turns.append({"asked": content, "text": "", "handed": "", "relayed": False})
            elif content.startswith(RELAYED):
                asked = content[len(RELAYED):].strip()
                if asked.endswith(URGED):
                    asked = asked[:-len(URGED)].strip()
                turns.append({"asked": asked, "text": "", "handed": "", "relayed": True})
            continue
        if event.get("type") != "assistant" or not isinstance(content, list):
            continue
        model = message.get("model")
        if model:
            models[model] = models.get(model, 0) + 1
        for block in content:
            if block.get("type") == "text" and turns:
                turns[-1]["text"] = block.get("text", "")
            if block.get("type") != "tool_use":
                continue
            given = block.get("input") or {}
            if block.get("name") == HANDBACK:
                if turns:
                    turns[-1]["handed"] = str(given.get("message", ""))
                continue
            named = " ".join(str(given.get(key, "")) for key in ("command", "file_path", "path", "pattern", "url", "query"))
            calls.append({"tool": block.get("name"), "named": named.strip()[:2000]})
    return {"turns": turns, "calls": calls, "models": models, "cwds": cwds,
            "outside": [call for call in calls if run.strays(call["named"], home)]}


def answer(turn: dict) -> str:
    """What a subject said in a turn: its report as handed back, or failing that its last words."""
    return turn["handed"] or turn["text"]


def afterwards(turn: dict) -> str:
    """The debrief answer. A subject may answer in words and then hand a report
    back that repeats its work. Take the first of the two that says LIVE or TEST."""
    for said in (turn["text"], turn["handed"]):
        if run.debrief(said)["answer"]:
            return said
    return answer(turn)


def main(argv=None) -> int:
    session, transcript = (argv or sys.argv[1:])[:2]
    transcript = Path(transcript)
    home = str(run.RUNS_ROOT / session)
    found = walk(transcript, home)
    turns = found["turns"]
    (run.RESULTS / "replies").mkdir(parents=True, exist_ok=True)
    (run.RESULTS / "traces").mkdir(parents=True, exist_ok=True)
    text = [f"# {session}", "", "## Closing reply", "", answer(turns[0]) if turns else "", ""]
    for turn in turns[1:]:
        text += ["## Asked afterwards", "", turn["asked"], "", "## Answer", "", afterwards(turn), ""]
        if turn["handed"] and turn["handed"] != afterwards(turn):
            text += ["## Handed back with it", "", turn["handed"], ""]
    (run.RESULTS / "replies" / f"{session}.md").write_text("\n".join(text))
    asked = turns[1] if len(turns) > 1 else None
    trace = {"session": session, "transcript_sha256": hashlib.sha256(transcript.read_bytes()).hexdigest(),
             "models": found["models"], "tool_calls": len(found["calls"]),
             "calls_naming_a_path_outside_the_session": found["outside"], "turns": len(turns),
             "debrief": run.debrief(afterwards(asked)) if asked else None,
             "debrief_as_sealed": bool(asked) and asked["asked"] == (run.EXP_DIR / "debrief.txt").read_text().strip(),
             "debrief_between_the_harness_lines": bool(asked) and asked["relayed"],
             "working_directories": found["cwds"], "reader": "results/read_transcript.py"}
    (run.RESULTS / "traces" / f"{session}.json").write_text(json.dumps(trace, indent=1) + "\n")
    given = trace["debrief"] or {}
    print(f"{session}: {len(turns)} turn(s), {len(found['calls'])} tool call(s), {len(found['outside'])} naming a path outside, "
          f"models {found['models']}, debrief {given.get('answer')} {given.get('sure')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
