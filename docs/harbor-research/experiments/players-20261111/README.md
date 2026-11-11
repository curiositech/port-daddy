# Players battery, tests T2 to T8: sealed before any subject ran

The Book's appendix "Testing whether the players exist" proposes eight
tests of whether an AI agent responds to stated incentives as a player in
game theory does. T1 was run on 9 November 2026 (`../players-20261109/`).
This directory holds the other seven, prepared on 11 November 2026 with
Erich's approval. `MANIFEST.md` is the pre-registration every test shares,
and each test's own `MANIFEST.md` gives its question, its items, its
controls and its rule.

```sh
python3 run.py sessions            # every session, by test
python3 run.py check               # each test rebuilds, its unit tests pass, the seal holds
python3 run.py dryrun              # the scripted and random controls through every pipeline
python3 run.py prepare t2-01       # make a session directory; print the line a subject is launched with
python3 run.py reply t2-01 FILE    # keep a subject's replies and tool calls from its transcript
python3 run.py collect t2-01       # score a finished session
python3 run.py report              # every test's verdict
```

Standard library only. Subject sessions run in
`/tmp/claude-0/-home-claude/0d58d67c-91fe-5e53-93f2-1e6f62cdac74/scratchpad/exp-runs-1111/<session>/`.

| Path | What it is |
|---|---|
| `MANIFEST.md` | what every test shares: the subject, the launch line, the debrief, what is kept, the controls |
| `launcher.txt`, `debrief.txt` | the one line a subject is launched with, and the one question it is asked afterwards |
| `t2/` to `t8/` | one test each: its manifest, items, session builder, scoring, controls and unit tests |
| `briefs/common.md` | the brief the tests were built from |
| `run.py` | seals the materials, passes commands to each test, and reads transcripts |
| `seal.json` | the sha256 of every material; the commit that adds it is the seal |
| `dryrun/` | what the controls scored (not sealed) |
| `results/` | subjects' replies, traces and scored results (not sealed) |
