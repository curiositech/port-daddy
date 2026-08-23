# pd-console

The GPU-native operator console for Port Daddy (ADR-0046) — a native window with a
sidebar of panes (Fleet, Sorties, Dispatch, Sessions, Health, …), each polling the
live daemon. There's also a headless TUI build for terminals and CI.

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
the `rust-console-gpui` CI job. Daemon discovery is canonical (`PORT_DADDY_URL` →
`~/.port-daddy/console-daemon.url` → `~/.port-daddy/daemon.port` → the stable
berth default), so a fresh console always opens against the canonical daemon
address and renders reachability honestly instead of failing pre-window.
