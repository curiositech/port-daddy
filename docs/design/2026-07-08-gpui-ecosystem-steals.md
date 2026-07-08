# GPUI ecosystem — what pd-console & Harbor should steal

**Date:** 2026-07-08 · **Provenance:** a full sweep of all 73 entries in
[zed-industries/awesome-gpui](https://github.com/zed-industries/awesome-gpui), mined for
product / tech / idea inspiration for two efforts: **pd-console** (the GPU-native operator
console on GPUI 0.2.2, "one pane, two faces": panes emit render-agnostic `Block`/`Tone`
primitives painted by a GPUI/Metal renderer and a headless ratatui renderer) and the
**Harbor editor** (planned cooperative GPUI IDE — Loro CRDT buffers, regional claims,
agent-as-peer governance living in the daemon; console is the reference renderer; cloud
agents first-class; VS Code / web / phone are future renderer clients).

Star counts and gpui versions are point-in-time (2026-07-08) and flagged where unverified.

---

## 0. The governing constraint: COPY-NOT-DEPEND (the gpui-version trap)

**This decides everything below.** Many repos *declare* `gpui = "0.2.2"` but then
`[patch.crates-io]` / `[replace]` it to a **zed git rev**. A git-pinned gpui is a
**different Cargo identity** than pd-console's registry `gpui 0.2.2` — you cannot link both
in one binary without moving pd-console onto that same (fast-drifting) zed rev. So each
candidate is one of:

- **REGISTRY-0.2.2-SAFE** — real crates.io `0.2.2`; can be a normal dependency today.
- **GIT-PATCH-TRAP** — pins gpui to a zed git rev; **copy the source in, don't depend.**

| Repo | gpui status | verdict |
|---|---|---|
| AprilNEA/gpui-symbols | crates.io `0.2.2` exact | **SAFE — depend** |
| inkwadra/gpui-tea | `0.2.2` exact | SAFE |
| gpui-hooks, gpui-nav (0.2.1), gpui-router (0.2.1) | registry | SAFE |
| tu6ge/ferrum-flow | `0.2.2` exact | SAFE |
| tschk/crepuscularity | `0.2.2` exact | SAFE |
| penso/arbor | `0.2.2` exact | SAFE |
| 0xErwin1/dbflux | `0.2.2` exact | SAFE |
| longbridge/gpui-component (`main`) | git-pin on `main` | **TRAP — copy** |
| longbridge/gpui-component (**published 0.5.x**) | crates.io, used w/ registry 0.2.2 | **VERIFY** (see §8, blocks text-input) |
| pacifio/gpui-flow | git-unpinned (floats zed main) | TRAP — copy + pin |
| packetThrower/zorite crates | git-pin | TRAP — copy |
| pierreaubert/gpui-toolkit | zed git **tag v1.9.0** | TRAP — copy |
| stayhydated/gpui-storybook | git-pin | TRAP |
| zed-industries/zed crates | workspace (zed rev) | study / vendor slices |

---

## 1. Headline verdicts

1. **Nobody renders GPUI offscreen to pixels.** The whole field routes around it by
   serializing semantic state and repainting on thin renderers — field-wide validation of
   pd-console's Block/Tone "two faces" and Harbor's daemon-governance thesis. Keep the
   operator's rule; don't chase offscreen GPUI pixels. (See §9; full write-up in the
   sibling headless-capture finding, PR #881.)
2. **longbridge/gpui-component is the de-facto standard kit** (~12k★; used by onetcli,
   pgui, zedis, pawse, sukusho, based, DBFlux) — but the `main`-branch git-pin makes it
   copy-not-depend unless the published 0.5.x proves registry-safe (§8).
3. **The richest steals are agentic-console analogs** (Arbor, Codux, DBFlux, hunk) — several
   are near-clones of what pd-console already is.

---

## 2. Immediate drop-ins (hours; registry-0.2.2-safe)

- **[AprilNEA/gpui-symbols](https://github.com/AprilNEA/gpui-symbols)** — native SF Symbols
  (9000+), type-safe `Icon` + `define_icons!` macro. `gpui="0.2.2"` exact. Kills
  pd-console's no-icons / emoji-ban gap **today**. `[GFX][UX]` → **pd-console (all panes/badges)**.
- **[inkwadra/gpui-tea](https://github.com/inkwadra/gpui-tea)** — Elm runtime with keyed
  latest-wins `Command`/`Subscription`; formalizes pd-console's ad-hoc producer/consumer
  channels. `0.2.2` exact. `[PERF]`

---

## 3. Agentic / multi-agent console

- **[penso/arbor](https://github.com/penso/arbor)** (~782★, `0.2.2` exact, active) — closest
  whole-product analog: **one daemon backs 4 clients (gui/httpd/cli/mcp) over HTTP+bearer**;
  live-detects running Claude Code / Codex / OpenCode sessions over WebSocket;
  worktree-from-GitHub-issue; **Procfile process manager with restart tracking**; 38 themes
  synced desktop↔web live. Study its roster/process-manager layout. `[AGENT][UX]` → pd-console.
- **[0xErwin1/dbflux](https://github.com/0xErwin1/dbflux)** (`0.2.2` exact) — **mutation
  policies** (read-only / approval-required, with *chunked cancellable* execution on
  UPDATE/DELETE = a real HITL gate for agents mutating shared state) + a **driver RPC
  protocol** (drivers register out-of-process, not linked in → agents add capabilities
  without recompiling the host). `[AGENT][UX]` → pd-console gates + Harbor governance.
- **[vicanso/zedis](https://github.com/vicanso/zedis)** — **escalating destructive-action
  confirms** tiered by target risk (fleet kill/restart). `[AGENT][UX]` → pd-console controls.
- **[ssut/WSL2-HyperV-Firewall-Manager](https://github.com/ssut/WSL2-HyperV-Firewall-Manager)**
  — git-like **draft → review-diff → commit/rollback** for risky actions (queue fleet
  mutations for review). `[UX]`
- **[CES-Ltd/Lumi](https://github.com/CES-Ltd/Lumi)** — per-surface **in-process MCP servers**
  exposing app internals as LLM tools (novel; but 22 crates in a day then silent — likely a
  speculative dump; treat as idea only). `[AGENT]`

---

## 4. Performance

- **[packetThrower/zorite](https://github.com/packetThrower/zorite) `crates/gpui-pdf`** (TRAP)
  — bounded-memory virtualization + **GPU-texture lifecycle discipline**: pre-size every slot
  (accurate scrollbars) but only near-viewport rasterizes; scrolled-away frees **both** the
  CPU buffer **and** the GPU atlas texture (`view.release(window,cx)`); incremental paint;
  zoom never blanks. For huge pd-console panes (long fleet logs/history) beyond `uniform_list`.
- **[packetThrower/Baudrun](https://github.com/packetThrower/Baudrun)** (TRAP) — `flume`
  **sync-thread → async-UI bridge** (reusable for log/process tailing); best multi-window
  pattern found (drag saved profile past a window edge → spawns in its own window already
  connected). `[UX][PERF]`
- **[inkwadra/gpui-tea](https://github.com/inkwadra/gpui-tea)** — see §2 (keyed latest-wins).

---

## 5. Graphics

- **[pierreaubert/gpui-toolkit](https://github.com/pierreaubert/gpui-toolkit)** (TRAP, zed
  tag v1.9.0, active) — **`gpui-px`** Plotly-express charts (`scatter/line/bar/heatmap` in 3
  lines, Viridis) for health/metrics panes; **`gpui-ui-kit/workflow/`** node-graph canvas;
  **`command_palette.rs`** (⌘K fuzzy) + **`gpui-keybinding`** conflict detection. (This is the
  real home of gpui-d3rs/gpui-px, *not* `sotf`.) `[PERF][GFX][UX]` → pd-console.
- **[packetThrower/zorite](https://github.com/packetThrower/zorite) `crates/gpui-whiteboard`**
  (TRAP) — host-agnostic **infinite pan/zoom canvas** (world-space camera, shapes/ink/z-order,
  JSON-serializable). Idiom to steal everywhere: **theme colors read from a `Fn()->Style`
  closure at paint time** → live retheme, zero plumbing (mirrors Tone→OKLCH resolve-at-paint).
- **[tahayvr/omarchist](https://github.com/tahayvr/omarchist)** (~706★) — **live theme
  designer** (color pickers + real-time preview) — directly relevant to pd-console theming.

---

## 6. UX metaphors

- **[pacifio/gpui-flow](https://github.com/pacifio/gpui-flow)** (TRAP) — near drop-in
  **fleet-DAG canvas**: bezier/smoothstep edges, drag-to-connect + snap, box-select,
  undo/redo, **viewport-culled @1000 nodes**, minimap, and `node_renderer("type", |node,…|)`
  returning **any** GPUI element (render agent `Block`/`Tone` directly).
  `get_incomers/outgoers/connected_edges` = DAG dependency queries. `[AGENT][PERF][UX]` →
  pd-console fleet view + Harbor.
- **[MatthiasGrandl/loungy](https://github.com/MatthiasGrandl/loungy)** (~1720★, unmaintained
  but battle-tested) — the **"State Stack" command-palette pattern**: one shared `Query` drives
  `View`+`Actions`+`Toast`+`Loading`; a `workspace` flag pushes nested views in place →
  infinitely deep list→detail→sub-detail, every level reusing the same search/keyboard behavior.
  `[UX]` → pd-console ⌘K.
- **[feigeCode/onetcli](https://github.com/feigeCode/onetcli)** — unified tab/pane shell
  hosting heterogeneous connections = pd-console's "many agent panes, one shell." `[UX]`

---

## 7. Harbor editor / collab / architecture

- **[zed-industries/zed](https://github.com/zed-industries/zed) `crates/text` + `crates/clock`**
  — custom OT/CRDT (Lamport clock + version-vector) where **`ReplicaId` reserves first-class
  constants for LOCAL / REMOTE_SERVER / AGENT / LOCAL_BRANCH**. Baking "agent" and "branch"
  into the clock *is* Harbor's agent-as-peer governance, already designed. Transport =
  `crates/rpc` (websocket + protobuf + zstd) → `crates/collab` (hub-spoke, not P2P).
  `[COLLAB][ARCH]` → Harbor.
- **[duxweb/codux](https://github.com/duxweb/codux)** — the verified **Harbor blueprint**: a
  platform-neutral **headless governed core** (12 non-GPUI crates: codux-protocol,
  -protocol-ffi, -remote-transport, -runtime-core/-live, -terminal-core/-pty, -git, -llm,
  -memory, -ai-history/-ai-sessions) + **thin peer clients** (apps/desktop = GPUI, mobile =
  Flutter via C-ABI FFI, apps/agent = headless host) that are **E2E-encrypted P2P/relay
  peers**. Transport = **Iroh QUIC** (`iroh=1.0`; custom ALPN isolates preview traffic).
  `headless_screen.rs` (~92 KB) serializes the terminal cell grid → snapshot for thin clients
  — nobody rasterizes GPUI offscreen. **Corrections from source:** protocol crate is **1.8.1**
  (not "v3.2"); **encryption is explicitly upstream of the transport crate** ("Owns / Does Not
  Own" per-crate READMEs). Steals: the **"Owns / Does Not Own" convention** and the
  **independently-versioned protocol crate** (Harbor's client-agnostic wire contract), plus
  **credential-injection-in-a-helper-process so secrets never enter the model's context**.
  `[AGENT][ARCH]` → Harbor + pd-console.
- **[tschk/crepuscularity](https://github.com/tschk/crepuscularity)** (`0.2.2` exact, solo) —
  "one pane, two faces" **generalized and real**: a typed AST (`Element/Text/If/For/Match/…`)
  + Tailwind-style class strings, where **each backend interprets the same classes** (confirmed
  GPUI + Ratatui + web + webext). The reference for evolving Block/Tone into a richer shared IR.
  `[ARCH]`
- **[tu6ge/ferrum-flow](https://github.com/tu6ge/ferrum-flow)** (`0.2.2` exact) — plugin
  node-editor whose **`crates/sync_plugin` does Yrs CRDT + awareness** — a real CRDT node-graph
  collab precedent for Harbor. `[COLLAB]`
- **[l0ng-ai/tty7](https://github.com/l0ng-ai/tty7)** (new 2026-07-06, active, git-pin) —
  clean **daemon↔client wire protocol**: no RPC framework; Unix domain socket (perms-gated) on
  macOS/Linux, Windows loopback-TCP + token-preamble handshake (client proves it read a
  user-private port file before a protocol byte is parsed); daemon owns PTYs, survives client
  quit, 16 MiB backpressure. Read `src/daemon/{protocol,server,pane}.rs` as a Harbor
  daemon-authority reference. `[ARCH]`
- Other two-faces validations: **[douglance/zlyph](https://github.com/douglance/zlyph)**
  (`zlyph-core` 26 tests, zero UI deps; thin tui + gpui shells),
  **[natew/react-native-gpui](https://github.com/natew/react-native-gpui)** (React reconciler
  → serialized node tree → Hermes-in-Rust; locally vendored+patched gpui 0.2.2 — data point
  for a Harbor web/VS-Code client SDK), **[lassejlv/termy](https://github.com/lassejlv/termy)**.

---

## 8. Distribution / packaging / auto-update

- **[zed](https://github.com/zed-industries/zed) `script/bundle-mac` + `crates/auto_update`**
  — notarization recipe: `codesign --deep --options runtime --entitlements` → `notarytool
  submit --wait` → `stapler staple`; `AutoUpdater` pulls `GET /releases/{channel}/{version}/asset`.
- **[smolcars/hunk](https://github.com/smolcars/hunk)** — signed/notarized DMG via GitHub
  Actions + a dedicated `hunk-updater` crate.
- **[pavi2410/based](https://github.com/pavi2410/based)** — verifies release-asset **SHA-256
  digest** against the GitHub Releases API (**serverless update-trust**); `mise run package` →
  dmg/deb/AppImage/exe + Homebrew + winget.
- **[duanebester/pgui](https://github.com/duanebester/pgui) `table_delegate.rs`** — a working
  virtualized `gpui_component::table` grid to mirror. Confirms **gpui-component 0.5.x is
  published to crates.io** and combined with registry `gpui 0.2.2` in shipping apps → **VERIFY
  this dependency tree** before choosing copy-vs-depend for the pd-tube text input (§9, blocks
  that work).

---

## 9. Special sections

### Offscreen GPUI → image (honest negative)
No repo does true GPUI-elements → image offscreen. Everyone serializes semantic state and
repaints on a thin renderer (Codux/zlyph/Crepuscularity), or rasterizes the *other* direction
(`gpui-pdf`: PDF→bitmap→GPUI). zed's `TestAppContext::draw` is in-memory snapshot state, not an
image export. **Keep the operator's rule.**

### GPUI testing harnesses
zed's **`crates/gpui/src/app/test_context.rs` `TestAppContext` (`pub fn draw<E>`)** is the only
real harness. **gpui-storybook** is a live gallery (`#[story]`), **not** visual-regression
(zero golden-image usage) and is git-pinned. `gpui-book`'s Testing chapter is an unwritten stub.
Net: **pd-console's per-pane Block/Tone unit tests are already ahead of the ecosystem.**

### Text input / editor buffer (GPUI ships none)
- **[longbridge/gpui-component](https://github.com/longbridge/gpui-component/tree/main/crates/ui/src/input)
  `input/`** — production text input: `RenderOnce` builder + `Entity<InputState>` (ropey rope,
  cursor, selection) + custom `Element` (paint/hit-test/blink) + `native.rs` (macOS IME).
  Apache-2.0. Copy the module (TRAP) — the `pd tube` cockpit input.
- **[packetThrower/zorite](https://github.com/packetThrower/zorite) `crates/gpui-editor`** —
  cleaner alt: from-scratch `EntityInputHandler` + `unicode-segmentation` grapheme cursors,
  **zero gpui-component dep**, runnable demo. Best if you want no gpui-component coupling.

### Terminals (cell-grid in GPUI)
termy + Baudrun + tty7 use `alacritty_terminal` for VT-parse + grid state only; GPUI does 100%
render with **dirty-span cell caching** — the recipe for a GPU face over Harbor's ratatui pane.

---

## 10. Graveyard (examined; low value for a console/IDE)
REST clones: postman-gpui, [setu](https://github.com/bajrangCoder/setu). Toys/learning:
[bmo](https://github.com/rubbieKelvin/bmo), [gpui-todos](https://github.com/duanebester/gpui-todos),
[gpui-base64](https://github.com/badgooooor/gpui-base64),
[gpui-calculator](https://github.com/kriskw1999/gpui-calculator),
[gpui-list](https://github.com/duanebester/gpui-list) (shared-global-model idiom worth a peek).
Niche/platform-locked: [sukusho](https://github.com/ssut/sukusho) (Win),
[bandmeter](https://github.com/emamoah/bandmeter) (Linux eBPF), [clp](https://github.com/lostf1sh/clp)
(Wayland), ropy, picoforge, remindr, vleer, fast-forward. **Surprise-promotes from the tail:**
[OpenLogi](https://github.com/AprilNEA/OpenLogi) (~5623★, most-popular GPUI app; 20-language
native settings craft), [nohrs](https://github.com/noh-rs/nohrs) (SQLite+Tantivy hybrid history
search; reusable-components crate split).

---

## 11. Uncertainties to verify (flagged, not fabricated)
- **gpui-component published 0.5.x vs `main` git-pin** dependency tree — the single most
  important thing to verify before the text-input (changes copy-vs-depend). Roadmap:
  `gpui-component-0-5-x-dependability-verify`.
- Codux protocol crate is **1.8.1**; any "3.2" is an unconfirmed wire-format number, not the
  crate version.
- hunk/zlyph exact gpui versions unknown (per-crate); Lumi liveness reads as a speculative dump.
- Pulsar-Native's node-graph editor lives in a separate `WGPUI-Component` repo (a gpui *fork*,
  not portable as-is) — unverified this pass.

---

## 12. Roadmap items spawned (see `../roadmap/roadmap.snapshot.json`)
- `gpui-symbols-icon-integration` — native SF Symbols → pd-console (all panes/badges)
- `mutation-policy-hitl-gate` — DBFlux-style approval/read-only + cancellable exec → pd-console controls + Harbor governance
- `gpui-flow-fleet-dag-canvas` — bezier DAG canvas (culled @1000 nodes) → pd-console fleet view + Harbor
- `harbor-replicaid-agent-branch-clock` — zed ReplicaId AGENT/BRANCH clock constants → Harbor editor
- `gpui-px-metrics-charts` — Plotly-express charts → pd-console health/metrics panes
- `gpui-component-0-5-x-dependability-verify` — copy-vs-depend decision (blocks text-input) → pd-console pd-tube input
