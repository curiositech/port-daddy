# Visual Evidence — `pd roadmap chomp` (roadmap doc-ingestion slice)

Provenance for every artifact in this directory. Nothing here is a mockup:
each PNG is a headless-Playwright rendering of a committed verbatim transcript
(`.txt`) of a REAL command, and the webm is a guided scroll through those same
real captures. Per the sanctioned ladder in
`skills/port-daddy-agent-skill/references/visual-evidence.md` (rung 1:
headless; zero desktop footprint, no windows opened).

## Capture context

- **Branch:** `claude/roadmap-doc-chomp`
- **Commit at capture:** `5d7dedc61798bdf2e193f9a5f10481bcbedfa9e8` (this SHA is
  also visible *inside* the evidence — it is the `source_refs_json.commit`
  the chomp stamped on every derived row)
- **Pipeline label:** REAL-PIPELINE / EPHEMERAL-DAEMON — the real CLI
  (`bin/port-daddy-cli.ts` via tsx) against a real daemon (`server.ts`,
  isolated `PORT_DADDY_PREFIX` sandbox DB on port 9899) chomping the repo's
  REAL planning documents `V4-DAG.md` and
  `port-daddy-asciinema-skills-plan.md`. No seeded fixtures; the only
  "seeding" is that the daemon's DB starts empty (which is what makes the
  0→121 insert and the idempotent re-run honest).
- **Reproduce:** steps in the header of `capture.sh`; then `render.mjs`
  (PNGs) and `record-walkthrough.mjs` (webm). All three scripts are committed
  here.

## Artifacts

| Artifact | What it shows | Command (verbatim in the transcript) | Label |
|---|---|---|---|
| `t01-preview.txt/.png` | Default run is a PREVIEW: exact project→epic→story→task tree from 2 real docs (121 items), nothing written | `pd roadmap chomp V4-DAG.md port-daddy-asciinema-skills-plan.md --harbor port-daddy` | REAL |
| `t02-empty-states.txt/.png` | **Null states**: a corpus with no ingestible structure (LICENSE → 0 items + warning) and a missing doc (`MISSING`) — what the operator actually sees | `pd roadmap chomp LICENSE docs/DOES-NOT-EXIST.md --harbor port-daddy` | REAL |
| `t03-enrich-honest.txt/.png` | `--enrich` with no LLM backend configured: honest "deterministic extraction only" degradation, nothing faked | `… roadmap chomp … --enrich` with `PD_CHOMP_BACKEND=`/`PD_FLEET_DEFAULT_BACKEND=` empty | REAL |
| `t04-write-emit-pr-plan.txt/.png` | THE write act: 121 rows upserted through the daemon + the emitted PR-plan artifact paths + duplicate-slug warnings + 119 `parent_of` edges written | `pd roadmap chomp … --as chomp-evidence --emit-pr-plan <dir>` | REAL |
| `t05-idempotent-rerun.txt/.png` | Idempotent re-run: `0 new, 121 existing/protected`; every row marked `protected` (never clobbered) | same command, second run | REAL |
| `t06-roadmap-list.txt/.png` | The derived items read back from the `roadmap_items` DB-of-record | `pd roadmap --status all --harbor port-daddy --limit 200` | REAL |
| `t07-item-source-refs.txt/.png` | One derived row's full JSON: `kind`, `descriptionMd`, provenance note, and `sourceRefs: [{type:doc, path:V4-DAG.md, commit:5d7dedc6…}]` | `curl /roadmap/items/port-daddy-v4-implementation-dag?harbor=port-daddy` | REAL |
| `t08-pr-plan-artifacts.txt/.png` | What the emitted doc-removal PR contains: `remove-docs.txt` (git rm list), the work receipt head, the regenerated snapshot head | `cat`/`head` of the emit dir | REAL |
| `chomp-receipt.json` | The FULL machine-readable work receipt from the write run (docs read + formats + counts, all 121 items with actions, dangling deps, warnings, `sourceCommit`) | copied verbatim from the emit dir | REAL |
| `emitted-pr-body.md` | The ready PR body the emit produced for the doc-removal PR | copied verbatim from the emit dir | REAL |
| `walkthrough.webm` | Motion walkthrough: planning doc → preview tree → write + emitted PR plan → PR artifacts → source_refs provenance (guided scroll through the real captures above) | `record-walkthrough.mjs` | REAL (rendering of real transcripts) |
| `capture.sh`, `render.mjs`, `record-walkthrough.mjs` | The capture/render scripts themselves (committed per the evidence mandate) | — | — |

## Notes

- ANSI escapes are stripped from transcripts (`sed` in `capture.sh`) so the
  committed text diffs cleanly; the `⚠ writes → ephemeral:prefix` plane
  banner visible in every mutating capture is the daemon-plane warning the
  CLI really printed.
- PNGs clamp transcripts longer than 120 lines and say so in-image; the full
  text is always the committed `.txt` beside the PNG.
- The evidence deliberately does NOT delete `V4-DAG.md` /
  `port-daddy-asciinema-skills-plan.md` from this branch: filing the emitted
  doc-removal PR is the operator's explicit act (the PR-only write doctrine
  this slice implements). `t08` + `emitted-pr-body.md` show exactly what that
  PR would contain.
