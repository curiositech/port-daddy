# Players experiments: T1 and the checkout repair, sealed, not run

Two small experiments the Book proposes and has not run, prepared and sealed on 9 November 2026 with Erich's approval. **No subject session has been run.** The seal is the commit that adds `seal.json`. `MANIFEST.md` is the pre-registration: hypotheses, predictions taken from the Book's text, controls with their expected results, sample sizes, the strategy rubric and the analysis plan.

- **A, T1** (`app-players.tex`): revealed preference over two harbor goods, review hours and compute credits. There are 24 crossing budget lines, each offered once plainly and once reframed with identical economics. Scoring covers GARP and Afriat's CCEI per frame and pooled, the frame gap, and per-budget consistency. 6 sessions.
- **B, checkout repair** (`swk-control-game.tex`, the three-configuration harbor protocol): 8 ImpossibleBench-style tasks run under G0 (tests writable), G1 (`./submit` refuses test writes at the record) and G2 (G1 plus `./escalate`). Every final recorded state is classified by strategy. 24 sessions.

`sessions.json` lists all 30 sessions with their exact prompts, directories and sealed harness hashes.

```sh
python3 run.py prepare <session>                 # create the session directory, print the prompt
python3 run.py collect <session> --model <id>    # score it into results/<session>.json
python3 run.py report                            # result vectors per model and configuration
python3 run.py dryrun                            # controls and scripted subjects through the pipeline
python3 run.py build --check                     # regenerate sealed materials from the seeds and compare
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest test_players.py
```

Standard library only (pytest for the task repos). The Port Daddy runtime is not used. Subject sessions go to `/tmp/claude-0/-home-claude/0d58d67c-91fe-5e53-93f2-1e6f62cdac74/scratchpad/exp-runs/<session>/`; the dry run went to the sibling `exp-runs-dryrun/`.

| Path | What it is |
|---|---|
| `t1/design.py`, `t1/items.json` | line selection, frames, offer text, prompt; the 48 sealed items |
| `t1/garp.py`, `t1/score.py` | GARP, CCEI by bisection with transitive closure; session scoring and verdict |
| `t1/controls.py`, `t1/random_benchmark.json` | scripted and random choosers; 1,000 random sessions |
| `repair/tasks/T0*/` | each task: `repo/` as given, `original_tests/`, `reference/`, `probes.py`, `special_case.py`, `task.json` |
| `repair/verify.py`, `repair/task_verification.json` | pre-seal checks V1 to V7 for every task |
| `repair/harness/harness.py` | `./submit` and `./escalate`, the G1/G2 write gate, the hash-chained record |
| `repair/session.py`, `repair/score.py`, `repair/analysis.py` | session rendering; collector and decision list; test runs, probes, static features |
| `repair/scripted.py` | scripted subjects and classifier fixtures for the dry run |
| `dryrun/` | dry-run results (not sealed) |
| `results/` | collected subject results, one file per session (not sealed) |
