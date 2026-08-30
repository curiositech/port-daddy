# pd-console

The GPU-native operator console for Port Daddy (ADR-0046). It opens on one
full-window **Mission** conversation: describe an outcome, watch Port Daddy
admit a governed agent, follow that exact agent's live transcript, and open the
resulting pull request with its current checks. Plan, suggested skills, claims,
evidence, and cost stay attached as contextual cards. Fleet, Sessions, Health,
and the other deep-truth surfaces are inspectors opened from that flow; they are
not competing defaults. There's also a headless TUI build for terminals and CI.

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
3. Stay in Mission while the exact agent, model, live output, files, and
   checks arrive.
4. Open the attached pull request from the same screen.

Mission starts ordinary work. **Parley** remains an explicit coordination
action for a real disagreement: convene it from a verified Sextant selection or
with `pd parley` in the emergency CLI, then open its durable outcome as an
inspector beside Mission. It is not a second default conversation.

## Native terminal drawer

The **>_ CLI** control raises one persistent login shell over the current Mission
context; `Ctrl-A` then <code>`</code> is the keyboard equivalent. Drag the named
**RESIZE** edge to change its height. The PTY row count follows the authored
height immediately, so full-screen commands reflow instead of being clipped.

Wheel or trackpad input moves through retained shell history. While history is
raised, the header shows the exact offset and a **RETURN LIVE** control; typing
also returns to the live prompt. In alternate-screen programs such as `less` or
`vim`, wheel rows are forwarded as up/down navigation rather than pretending the
shell's primary scrollback is visible.

## Mission flow

![Mission conversation](docs/artifacts/gpui/proof-mission-spine/mission-running.png)

The [three-state mission proof](docs/artifacts/gpui/proof-mission-spine/proof.gif)
shows admission, live work, and delivery. The [proof
manifest](docs/artifacts/gpui/proof-mission-spine/MANIFEST.md) separately records
the real native WorkIntent/agent/transcript round trip and labels the raster as
the render-agnostic `Block` model. It does not pretend that a block-model capture
is a GPUI/Metal screenshot.

Generate a particular proof state with `--headless-capture <path>
--mission-state starting|in_progress|settled|failed`.

### Claims and roadmap proof

![Claims metadata ledger](docs/artifacts/claims-roadmap-20260829/claims-ledger-wide.png)

The [Claims and Jira roadmap proof](docs/artifacts/claims-roadmap-20260829/proof.gif)
shows the same live claim cohort under two sort keys, then the source-labelled
Planner view. Its [manifest](docs/artifacts/claims-roadmap-20260829/MANIFEST.md)
records the exact daemon, source, capture provenance, and narrow-width evidence.
These images are the TCC-independent `Block` renderer, visibly watermarked as
such; they are not presented as GPUI/Metal framebuffer captures.

The proof recipe is part of the binary rather than a one-off screenshot script:

```bash
PORT_DADDY_URL=http://127.0.0.1:9876 core/target/release/pd-console-repl \
  --capture-claims claims.png --capture-sort owner --capture-select 0 \
  --capture-ledger-rows 6 --capture-width 1180

PORT_DADDY_URL=http://127.0.0.1:9876 core/target/release/pd-console-repl \
  --capture-planner roadmap.png --capture-ledger-rows 8 --capture-width 520
```

### Conversation authority

- The first turn is persisted verbatim as a provider-neutral WorkIntent. The
  console does not silently rewrite it into another prompt.
- The daemon validates, admits, starts, and receipts work deterministically. It
  does not author an answer or make an LLM judgment; the attributed body does.
- While execution is in flight, new turns steer that exact live body. After
  review or termination, the next turn creates a fresh governed WorkIntent even
  if a stale roster heartbeat still exists.
- A cold launch rehydrates the exact persisted operator and attributed-agent
  turns from the execution transcript, reconstructs the deterministic admission
  receipt between them, and suppresses duplicate historical SSE replay.
- When the Surface Gateway also emits a compatibility dispatch alias for the
  same execution, Mission keeps the native console WorkIntent as its identity;
  genuine legacy dispatches remain visible when no native peer exists.
- Switching daemon berths clears berth-scoped conversation, receipt, and waiting
  state before the new daemon is projected.
- Context cards open real Plan, Claims, Suggestions, Activity, and Cost
  inspectors beside Mission. The persistent terminal is an emergency tool, not
  the app's internal adapter.

### Reproduce a feature build

The timestamped dev lane is the durable recipe for a branch build; it never
overwrites `latest` or `prod`:

```bash
PD_CONSOLE_NO_LAUNCH=1 bash core/pd-console/scripts/package-console.sh --devbuild mission-spine

PORT_DADDY_URL=http://127.0.0.1:3186 PD_CONSOLE_WORKDIR="$PWD" \
  ~/Applications/pd-console-dev-apps/pd-console-dev-<YYYYMMDD-HHMM>-mission-spine.app/Contents/MacOS/pd-console \
  --pane mission \
  --control-sock ~/coding/tmp/pd-console-mission-spine.sock

printf '%s\n' '{"cmd":"chat","text":"Describe the next bounded change."}' \
  | nc -U ~/coding/tmp/pd-console-mission-spine.sock
printf '%s\n' '{"cmd":"state","pane":"mission"}' \
  | nc -U ~/coding/tmp/pd-console-mission-spine.sock
```

The compiled Port Daddy bundle embeds the complete Agent Harbor schema set, so
this flow is also testable outside a source checkout. Missing schemas still fail
closed; embedding is packaging, not an authority bypass.

| Command        | What it does |
|----------------|--------------|
| `make` / `make run` | Build (release) + launch the window |
| `make install` | Build + open `~/Applications/pd-console-latest.app` |
| `make devapp DEVBUILD=harness-roster` | Build + open an isolated timestamped dev app named `pd-console-dev-<YYYYMMDD-HHMM>-harness-roster.app` |
| `make dev`     | Fast debug build + launch (quicker iteration) |
| `make repl`    | Headless TUI console — no GPU, builds anywhere |
| `make shots`   | Capture window screenshots (needs macOS Screen Recording permission) |
| `make test`    | Run the pane/decoder unit tests |
| `make check`   | Type-check the no-GPU path (what CI runs on Linux) |

Open straight to a pane: `cargo run --release --features gpui --bin pd-console -- --pane sorties`
(or `open ~/Applications/pd-console-dev-apps/pd-console-dev-<YYYYMMDD-HHMM>-harness-roster.app --args --pane active-agents`
for an isolated harness-roster dev build).

## App Lanes

Use lanes when several agents are iterating on the console at once:

| Lane | App | Use it for |
|------|-----|------------|
| `prod` | `~/Applications/pd-console-prod.app` | the released operator app |
| `latest` | `~/Applications/pd-console-latest.app` | current `main` after a merge |
| `dev` | `~/Applications/pd-console-dev-apps/pd-console-dev-<YYYYMMDD-HHMM>-<name>.app` | one branch, one feature, one clearly labeled test app |

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
