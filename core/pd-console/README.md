# pd-console

The GPU-native operator console for Port Daddy (ADR-0046). It opens on one
full-window **Work** screen: describe an outcome, watch Port Daddy admit a
governed agent, follow that exact agent's live transcript, and open the resulting
pull request with its current checks. Fleet, Sessions, Health, and the other deep
truth surfaces remain available from the view launcher; they are not competing
defaults. There's also a headless TUI build for terminals and CI.

## Quickstart

```bash
cd core/pd-console

make            # build + launch the native window  (the one you want)
make install    # build + open ~/Applications/pd-console-latest.app
make devapp DEVBUILD=harness-roster
```

That's it. `make` builds the release window and opens it; `make install` updates
the `latest` lane app without touching the production app. From the **FleetBar**
menubar app, the popover's **Open Operator Console** button launches the operator
lane.

The normal journey needs no terminal vocabulary:

1. Open pd-console.
2. Choose **Start a mission** and describe the outcome in plain English.
3. Stay on the Work screen while the exact agent, model, live output, files, and
   checks arrive.
4. Open the attached pull request from the same screen.

## Mission flow

![Mission-first Work screen](../../docs/artifacts/gpui/mission-first-running.png)

The [three-state mission proof](../../docs/artifacts/gpui/mission-first-flow.gif)
shows admission, live work, and delivery. These artifacts come from pd-console's
render-agnostic `Block` model because gpui 0.2.2 does not expose Metal framebuffer
readback. They verify the same mission data and semantic colors used by the native
window without pretending to be a screen capture.

Generate a particular proof state with `--headless-capture <path>
--mission-state starting|in_progress|settled|failed`.

| Command        | What it does |
|----------------|--------------|
| `make` / `make run` | Build (release) + launch the window |
| `make install` | Build + open `~/Applications/pd-console-latest.app` |
| `make devapp DEVBUILD=harness-roster` | Build + open an isolated dev app named `pd-console_dev-harness-roster.app` |
| `make dev`     | Fast debug build + launch (quicker iteration) |
| `make repl`    | Headless TUI console — no GPU, builds anywhere |
| `make shots`   | Capture window screenshots (needs macOS Screen Recording permission) |
| `make test`    | Run the pane/decoder unit tests |
| `make check`   | Type-check the no-GPU path (what CI runs on Linux) |

Open straight to a pane: `cargo run --release --features gpui --bin pd-console -- --pane sorties`
(or `open ~/Applications/pd-console-dev-apps/pd-console_dev-harness-roster.app --args --pane active-agents`
for an isolated harness-roster dev build).

## App Lanes

Use lanes when several agents are iterating on the console at once:

| Lane | App | Use it for |
|------|-----|------------|
| `prod` | `~/Applications/pd-console-prod.app` | the released operator app |
| `latest` | `~/Applications/pd-console-latest.app` | current `main` after a merge |
| `dev` | `~/Applications/pd-console-dev-apps/pd-console_dev-<name>.app` | one branch, one feature, one clearly labeled test app |

Direct lane commands:

```bash
bash scripts/package-console.sh --latest
bash scripts/package-console.sh --devbuild harness-roster
PD_CONSOLE_NO_LAUNCH=1 bash scripts/package-console.sh --devbuild harness-roster
```

Each lane has its own bundle identifier and badged icon, so Dock entries and
LaunchServices caches do not blur production, main, and feature builds together.

## How it's built

The window depends on [`gpui`](https://crates.io/crates/gpui) (Metal/macOS), which is
an **optional** dependency: the window bin carries `required-features = ["gpui"]`, so
the default `cargo check`/`cargo test` and the `pd-console-repl` build everywhere
without it (that's the Linux CI gate). The window is built and verified on macOS by
the `rust-console-gpui` CI job. Daemon discovery is canonical: an explicit
`PORT_DADDY_URL`, then the running daemon's atomically published
`~/.port-daddy/daemon.port`, then the stable berth default. A stale
development-daemon selection file is never startup authority, so closing a dev
berth cannot strand the next ordinary launch on a dead port.
