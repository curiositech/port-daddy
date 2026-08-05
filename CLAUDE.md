# Claude entry point

`AGENTS.md` is the canonical contributor contract for this repository. Read it
before editing; this file is deliberately a short routing layer so Claude-only
instructions cannot drift into a second operating manual.

The release-critical additions are:

- Start every session with `pd attention`, live coordination checks, and a clean
  linked worktree under `~/coding/tmp/`.
- Never replace the Homebrew daemon to test a branch. Build a named feature
  berth with `pd dev up --from "$PWD" --label <feature>` and point the compiled
  candidate CLI at that exact berth.
- `pd squid on` must arm a fresh project with SessionStart attention, Pilot
  steering, all detected provider hooks, the statusline, and `/squid`; with a
  healthy daemon, the following `pd squid status` must report `LIVE`.
- Every GitHub push wakes the low-tier Documentarian, which publishes and reads
  back `documentarian:push-reviewed:<source-sha>`. A Homebrew cut additionally
  requires the exact-tree multi-agent receipt described in `docs/RELEASING.md`.
- Improve `AGENTS.md`, `CLAUDE.md`, `README.md`, and both canonical skills when a
  slice exposes stale guidance. Keep authority here by linking, not copying,
  detailed procedures from `AGENTS.md` and `docs/RELEASING.md`.
