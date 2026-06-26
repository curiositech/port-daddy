# Terminal-recording snapshots — living integration tests with a HiTL gate

The website's terminal recordings (`public/casts/**/*.cast`, rendered to
`public/gifs/**`) are produced by **booting the real compiled daemon and running
real `pd` commands** (`website-v2/scripts/record-site-terminal-gifs.sh`,
`website-v2/scripts/record-agent-terminal-gifs.sh`). That makes them *living integration
tests*: if a command's output changes, the recording changes.

This directory holds the **golden behavioral transcript** for each cast — the
deterministic signal extracted from the recording, used to gate behavior drift.

## How it works

1. **Extract** (`website-v2/scripts/lib/cast-transcript.mjs`): a `.cast` → its concatenated
   terminal output, with event **timing dropped**, ANSI stripped, and a small,
   enumerated set of **ephemerals scrubbed** (ports, `session-`/`agent-` ids,
   UUIDs, PIDs, dates/clocks, durations, `[14h]`-style age markers, epoch
   seconds, `/Users|/home` paths). Everything left is *behavior*.
2. **Gate** (`website-v2/scripts/snapshot-recordings.mjs`): each cast's transcript is
   compared to its golden here (`<cast-path>.txt`). Drift → the
   `website-terminal-recordings` CI check fails with a readable diff.
3. **Approve (HiTL)**: drift is only greened by a human — review the diff, and if
   the change is intended:
   ```
   cd website-v2 && npm run snapshot:update
   git add website-v2/recordings-snapshots && git commit
   ```
   That committed transcript diff, reviewed in the PR, **is** the approval.

## Why a seeded world

`pd status`/`pd notes`/`pd sessions` print live daemon state, which differs
between a fresh CI daemon and a busy dev box. To make the recordings *reproducible*
(so drift means a real change, never ambient noise), recording runs against an
**isolated daemon on a fixed DB seeded with a deterministic demo world** (fixed
projects/agents/sessions/notes/ports). The normalizer then mops up the only
remaining record-time ephemerals (uptime, age, now). See
`website-v2/scripts/seed-recording-world.mjs` and the `website-terminal-recordings` job.

## Adding a new ephemeral

If a real CI run flags "drift" that is actually an un-scrubbed id/timestamp, add a
rule to `EPHEMERAL_RULES` in `website-v2/scripts/lib/cast-transcript.mjs`. Do **not**
blanket-normalize bare numbers — PD hashes identity→port deterministically, so most
numbers are stable, and masking them would hide genuine output changes.
