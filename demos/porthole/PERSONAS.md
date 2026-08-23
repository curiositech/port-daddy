# Porthole personas & user stories

*Draft 2026-08-19, voice-checked against port-daddy-marketing-copy. Each story is
trigger → three commands or fewer → outcome, installed in the place that persona
already lives. Competitive-research refinements land in a follow-up commit.*

## P1 — The Maintainer (README demos)

Ships an OSS CLI. The README GIF was recorded four releases ago; the flags in it
no longer exist, and a user just filed an issue about it.

- **Today:** VHS or asciinema → GIF → nobody can copy the commands, everybody trusts it less.
- **Install where they live:** `brew install porthole` or the GitHub Action.
- **Story:** `porthole rec -c "mytool init && mytool deploy"` → `porthole embed --readme`
  pastes an SVG poster that links to the live replay → `porthole test` in CI fails the
  build the day the output drifts. The demo can no longer lie, and viewers copy
  commands straight out of it.

## P2 — The DevRel / DX engineer (docs that rot)

Owns 40 tutorial pages. Every release, some screenshot of a terminal goes stale;
nobody notices until a customer does.

- **Today:** screenshots, hand-typed code blocks that drift from real output.
- **Install where they live:** `porthole.yml` next to the docs, GitHub Action in docs CI.
- **Story:** each tutorial's commands live in `porthole.yml` scenarios → CI re-records
  against every release → embeds on the docs site update themselves → a breaking output
  change fails the docs build instead of embarrassing the launch. Marketing material
  that regenerates from test runs.

## P3 — The Bug Reporter (the flow, live, after the fact)

Something broke twenty minutes ago in a long shell session. The repro is gone;
the memory is fading; the issue template says "steps to reproduce."

- **Today:** copy-pastes fragments from scrollback, apologizes for what's missing.
- **Install where they live:** shell hook (`porthole enable-flight` in .zshrc), or the
  CLI author bundles the SDK.
- **Story:** the flight recorder has been keeping the last 15 minutes in a local ring
  buffer → `porthole save-last 10m` → secret-scrub prompt → `porthole share --issue`
  attaches the replay to the GitHub issue. The maintainer scrubs the timeline at 2×,
  sees the exact flag order and the exact error, copies the failing command out of the
  replay. Session replay for terminals — the thing Sentry did for browsers.

## P4 — The Incident Responder (handing off a live investigation)

2 a.m. Shift change mid-incident. The next on-call needs to know what was already
tried, in what order, with what output.

- **Today:** a Slack paste of selected fragments, or "scroll up in the tmux."
- **Install where they live:** already-running tmux — `porthole rec --attach` wraps the pane.
- **Story:** record the investigation → `porthole share --team` (private, org namespace)
  → the incoming responder scrubs the timeline, searches the transcript, copies the
  exact `kubectl` invocations. The postmortem cites timestamped replay links instead of
  reconstructed memory.

## P5 — The Educator (lessons students can copy)

Teaches a terminal-heavy course. Students screenshot slides and re-type commands
with wrong quotes.

- **Today:** video (unpausable pace, uncopyable text) or GIFs (both).
- **Install where they live:** embed component in the course site; no student install.
- **Story:** record each lesson demo once → students play at 0.5×, pause, select and
  copy every command → the wrap toggle makes it readable on phones. The lesson is the
  terminal, not a video of one.

## P6 — The Agent-Fleet Operator (proof of work, natively Port Daddy)

Runs background coding agents. A PR claims "tests pass" — the receipt should show
the terminal that proved it.

- **Today:** trusts logs, or reads 4,000 lines of raw CI output.
- **Install where they live:** already has the daemon; fleet agents record themselves.
- **Story:** fleet runs auto-record to casts → the PR's work receipt links a porthole
  with provenance (daemon port, run id, exit status from the cast's own `x` event) →
  reviewers watch the failing test fail, then pass, at 2×. Visual evidence that is
  also text-searchable. This is the agent-visual-evidence-manifest doctrine with a
  player attached.

## Install surface summary (most convenient places)

| Persona | Where Porthole meets them |
|---|---|
| Maintainer | `brew install porthole`, GitHub Action, README embed kit |
| DevRel | `porthole.yml` + docs-CI Action |
| Bug reporter | shell hook flight recorder; CLI-author SDK crash hook |
| Incident responder | tmux attach; team share |
| Educator | web component embed; no install for students |
| Fleet operator | pd daemon integration; receipts in PRs |
