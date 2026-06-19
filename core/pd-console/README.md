# pd-console

The GPU-native operator console for Port Daddy (ADR-0046) — a native window with a
sidebar of panes (Fleet, Sorties, Dispatch, Sessions, Health, …), each polling the
live daemon. There's also a headless TUI build for terminals and CI.

## Quickstart

```bash
cd core/pd-console

make            # build + launch the native window  (the one you want)
make install    # drop a release app into ~/Applications and open it
```

That's it. `make` builds the release window and opens it; `make install` makes it
permanent (Spotlight → "pd-console", or drag `~/Applications/pd-console.app` to the
Dock). From the **FleetBar** menubar app, the popover's **Open Operator Console**
button launches the same window.

| Command        | What it does |
|----------------|--------------|
| `make` / `make run` | Build (release) + launch the window |
| `make install` | Build a release `~/Applications/pd-console.app` and open it |
| `make dev`     | Fast debug build + launch (quicker iteration) |
| `make repl`    | Headless TUI console — no GPU, builds anywhere |
| `make shots`   | Capture window screenshots (needs macOS Screen Recording permission) |
| `make test`    | Run the pane/decoder unit tests |
| `make check`   | Type-check the no-GPU path (what CI runs on Linux) |

Open straight to a pane: `cargo run --release --features gpui --bin pd-console -- --pane sorties`
(or `open -a pd-console --args --pane sorties` once installed).

## How it's built

The window depends on [`gpui`](https://crates.io/crates/gpui) (Metal/macOS), which is
an **optional** dependency: the window bin carries `required-features = ["gpui"]`, so
the default `cargo check`/`cargo test` and the `pd-console-repl` build everywhere
without it (that's the Linux CI gate). The window is built and verified on macOS by
the `rust-console-gpui` CI job. Daemon discovery is canonical (`PORT_DADDY_URL` →
`~/.port-daddy/daemon.port`); no hardcoded port.
