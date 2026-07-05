# PR #519 — active-lineage proof via the scripting control plane

The PR body's sole holdback was the **active-state** visual: the Conductor gate
targeting a live lineage instead of the whole fleet. Display capture kept dying
in the agent environment (TCC Screen Recording denied; `screencapture -x -l`
returns "could not create image from window"), so this proof set uses the
PR #694 scripting control plane — `--control-sock` newline-JSON commands typed
against the **running GPUI console** — which is exactly what that control plane
was built for.

## What each file proves

| File | Proof |
| --- | --- |
| `ping.json` | Console booted, bound to daemon `http://127.0.0.1:3104`, focused pane `conductor`. |
| `panes.json` | Live pane roster from the running view (conductor present). |
| `focus-conductor.json` | Control-plane `focus conductor` accepted. |
| `state-conductor-active-lineage.json` | **The missing active-state proof.** The live view's conductor pane holds root `L-proof-root` with a running depth-0 launch and a settled child — the exact non-terminal-root condition `ConductorHead::head()` targets, yielding the "⎈ Halt lineage: ship the Daemon Fleet Conductor (1 running)" gate header. |
| `daemon-fleet-conductor.json` | The daemon side of the same truth (`GET /fleet/conductor`). |
| `manifest.json` | Per-artifact provenance (daemon port, run id, sha256, commit, honest source labels). |

## Honest limits

- The lineage rows are **seeded fixture data** in an isolated proof daemon
  (scratch `PORT_DADDY_DB`, port 3104) — labeled `fixture` in the manifest. The
  console, the daemon endpoint, the control socket, and the render pipeline are
  all real and live. The production daemon and its DB were not touched.
- The gate header string is rendered chrome, not a pane `Block`, so it does not
  appear in the JSON dump. The dump proves the live view holds the lineage the
  header derives from; `head()`'s derivation is covered by this branch's
  `head_targets_the_first_active_lineage` / `head_is_none_when_idle` unit tests.
- The proof build is this PR's ConductorHead delta ported onto `origin/main` +
  PR #694's control plane (local scratch tree, never pushed) — required because
  this branch predates main's `app.rs`/`main.rs` churn. A pixel screenshot from
  a Screen-Recording-permitted terminal remains the ideal follow-up; repro
  recipe is in the PR comment.
