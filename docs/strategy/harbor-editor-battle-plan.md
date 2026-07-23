<!-- Generated 2026-06-20 by the beat-zed-collab-ide workflow: 6 web-research + 3 design + synthesis, 10 agents. -->

# Harbor Editor — The Battle Plan to Beat Zed at Collaborative Editing for Humans + Agents

*Chief architect's decision. Spine = Design A (Harbor Editor / CRDT-as-governable-kernel). Grafted: Design B's `SurfaceKind::Editor{path,region}` typed variant + reuse-only P0 + ACP/MCP bridge; Design C's `SyncTransport` trait + offline-LAN demo as the topology proof — but its transport-first build order is **rejected** as a timeline trap.*

---

## 1. Thesis & the wedge

Zed proved humans and agents can be co-present in one CRDT buffer, then stopped at co-presence: a CRDT guarantees bytes merge, never that *intent* agrees. Port Daddy already owns the exact layer Zed lacks — file/symbol/region claims (`routes/symbols.ts`, `POST /conflicts/predict`), the commit guard, salvage of dead agents (`routes/recovery.ts`), Ed25519 capability cards (`core/harbor-card-rs/src/lib.rs`), and an immutable-note audit trail — all running as a durable, self-hosted daemon on `:9876`. **We win by making the CRDT *governable*: take the one genuinely-missing primitive (a fast Rust collaborative buffer) off the shelf — Loro v1.13.x — bind its awareness layer to PD claims so a claim *is* a presence range the guard can refuse to merge across, and treat every editing actor (human OR agent) as a first-class Loro replica keyed to its PD identity.** The buffer merges bytes; the daemon governs intent; the harbor card decides who may write the region at all. **First place we beat Zed: the salvageable agent in a shared buffer** — kill an agent mid-edit and a successor replays its op-log, inherits its claim, and finishes with full provenance. That is structurally impossible in Zed's trust-the-room, cloud-only, ephemeral-session model.

## 2. Why we win (honest)

**Where Zed is genuinely strong — do not fight here:**
- **Editor core and latency.** Native Rust + GPUI, ~2ms input, 120fps, CRDT in its DNA since 2022, mature rope/multibuffer/tree-sitter/LSP. We will **not** out-edit Zed on typing latency or LSP depth. Borrow editor primitives; win elsewhere.
- **ACP gravity.** 60+ agent registry, JetBrains on board. ACP is becoming the LSP-for-agents. We **adopt it as an integration seam**, not a competitor (graft from Design B).
- **Multiplayer-as-shared-infra.** Same CRDT bus for humans and agents. Real, load-bearing. Our answer is the *durable, governed* counterpart, not a better sync.

**Where Zed's single-driver assumption breaks** (these are the seams):
- CRDT auto-merge hides **logical conflict**: "merges cleanly" ≠ "merges correctly." No claim, lock, or intent primitive exists in Zed.
- Coordination is **ephemeral** — session-scoped, evaporates when the room closes. No durable who-owns-what / who-decided-what.
- Agents are **tools on a human's session** — thin identity, no provenance, no attestation, no salvage when the process drops.
- Collab is **cloud-only and not self-hostable** (open feature requests #8260/#13503/#33151 unanswered) — no LAN, no air-gap.

**The 4 differentiators we own:**
1. **Agents-as-peers** — every actor is a Loro replica with a PeerID minted from its PD identity (`project:stack:context`), rendered identically to a human (cursor, claimed range, name), with a queryable provenance trail. Zed's agent identity is a tool attached to a thread.
2. **Claim-enforced concurrent edit** — symbol/region claims sit *above* Loro; `POST /conflicts/predict` surfaces contradictory plans on the same symbol as a `Conflicted`-tone guard band **before a byte is written**. CRDTs cannot express this.
3. **Salvage** — a dead actor's op-log + claim persist to content-addressed `/blob` + immutable notes; `pd salvage` replays and inherits. Zed loses the work when the ACP process drops.
4. **Multi-harbor self-hosting** — LAN / shared / remote, buffer never transits a vendor cloud, capability-scoped per path/region via signed Ed25519 cards. Zed is cloud-only, all-or-nothing filesystem trust.

## 3. Architecture

**Editor core (gpui).** Add `SurfaceKind::Editor { path, region }` to `core/pd-console/src/mux.rs` (the enum is at **mux.rs:33**, beside the existing `FileTree` variant at **mux.rs:41**). The split/tab/zoom `Workspace` tree (mux.rs:129, `split`/`swap_surface`/`bind_entity` at 179/257/266) is unit-tested and GPUI-free — **do not rebuild a window manager.** The editor view implements the existing object-safe `Surface`/`Pane` trait (`pane.rs:56` `SurfaceAction`, `pane.rs:67` `Subscription`, `mutate`/`subscription`/`on_stream` at 95/107/114). One pane, two faces: GPUI shell paints rich text; the ratatui TUI paints a read-only line-claim view of the same doc. On-screen edit (selection, IME, shaping) reuses GPUI text primitives — same framework as Zed — rather than writing layout from zero.

**The CRDT choice: Loro v1.13.x.** Rationale, honestly:
- **Fastest in 2026 benchmarks** (B4 trace, 260K-char doc): ~290ms apply vs Yjs 430 / Automerge 680; 68kB encoded vs 160/250; 15MB mem vs 28/41.
- **Documented, embeddable Rust crate** with first-class Rust + Swift + WASM APIs (Swift matters for a future macOS-native path). Zed's CRDT is internal, *not* a reusable library — adopting it means reimplementing it. cola/diamond-types are text-only building blocks (no presence, no persistence, diamond-types is WIP). Loro ships `EphemeralStore`, `Awareness`, stable cursors (`get_cursor`/`get_cursor_pos`), rich-text marks, and the multiplexed Loro Protocol.
- **Lineage = Fugue + Eg-Walker** — same algorithmic class as Zed's, partition-tolerant.
- **Fallback:** Yrs only if CodeMirror/Monaco bindings ever dominate; Automerge only if Git-like document history becomes a product feature. Neither is the bet today.

Each open file = one `LoroDoc` holding a `LoroText`. Every actor gets a stable Loro **PeerID minted from its PD identity** (OS user for humans, `project:stack:context` for agents); Lamport clocks order concurrent inserts so attribution and merge are correct under conflict.

**Presence.** Loro `EphemeralStore` (timestamp-LWW) + `Awareness` carry cursor/selection/viewport **and the PD twist: the actor's current claim as an awareness range** — the bridge object. Agent presence renders identically to human presence (named replica, cursor, "editing region X"), satisfying the arXiv-2509.11826 "agent activity visible to ALL collaborators" finding. The fast ephemeral lane (lossy-OK cursors) is **mirrored, debounced, into the daemon's durable claims table** so presence becomes queryable history that survives reconnect.

**Coordination kernel — the daemon IS the collab server (no new sync backend).** Fastify `:9876`:
- File claims: `POST /sessions/:id/files`, `GET /files/who-owns` (`routes/sessions.ts`).
- Symbol/region claims + the wedge: `POST /symbols/parse`, **`POST /conflicts/predict` (routes/symbols.ts:216)**.
- Transport default: Loro Protocol multiplexes doc-ops + ephemeral cursors + claim-awareness over the **existing tube pub/sub** (`POST /msg/:channel`, `GET /msg/:channel/subscribe` SSE) — the exact plumbing the `AgentTranscript` surface already folds via `on_stream()`.
- Durability: doc snapshots → content-addressed `/blob` (`routes/blob.ts`); op-log deltas + claim acquire/release → immutable notes. This is the salvage substrate.

**Authz — capability-scoped, not trust-the-room.** Harbor enforcement envelopes (`PUT /harbors/:name/envelope`, dry-run `POST /harbors/:name/check`, `routes/harbors.ts`) backed by signed Ed25519 cards (`core/harbor-card-rs/src/lib.rs`, `HarborCardClaims{sub,harbor,cap[],iat,exp,jti}`, 218 LOC, Kani proof targets). An agent without a write-cap for `src/auth/*.rs` has its Loro ops **rejected at daemon ingress** — structural, not advisory. ADR-0053 DOM DADDY is the out-of-band ENFORCE path.

**Transport per harbor — abstracted behind a `SyncTransport` trait (grafted from Design C), but proven last.** The editor never knows which water it's in; Loro Protocol frames ride whichever transport the harbor resolves to:
- **Shared (default, P3):** host's daemon is authoritative for the claim/governance ledger + `/blob`; joiners connect over daemon HTTP+SSE. Lowest friction, pure reuse.
- **LAN (P4):** iroh 1.0 QUIC/mDNS for direct P2P doc+ephemeral sync, host daemon's tube SSE as the coordination bus. **iroh is net-new — it appears nowhere in the codebase today** (verified), so it is gated behind a topology phase, never the critical path.
- **Remote (P5):** daemon on a remote host over the partially-built relay (`lib/relay-client.ts`, `routes/relay.ts` exist; ADR-0027/0049 mesh is design-plus-partial, **not** the full iroh-relay NAT-traversal stack); Loro's E2E-encrypted doc channel keeps buffer contents private — only ciphertext + signed claim metadata transit the relay.

**Bespoke viz (Track B, isolated).** `pd-timeline-proto` (Vello 0.3 + Parley + wgpu, `core/pd-timeline-proto/src/{data,scene,main}.rs` — proposed, unbuilt, M4 Max confirmed) renders a living-harbor presence/causal-thread overlay fed by `GET /activity/timeline`. Stays **workspace-excluded with its own Cargo.lock** so heavy GPU deps never hit the Linux CI gate (mirrors the current arrangement; FleetPopoverTests rot is the cautionary tale). NOT on the critical path.

**Agent bridge.** `agent.rs` conversation mux (629 LOC, 8 backends, per-agent tube channel, typed SSE `StreamEnvelope`s) gives inline per-file agent chat + steering for free. Plus an **ACP+MCP bridge** (grafted from B): expose PD claims/guard/salvage/nudge to ACP agents so PD coordinates the agents Zed/JetBrains already host — coordinate-the-swarm even if our own editor lags.

## 4. The co-edit model (human H + agent A, one file)

Humans and agents are **co-equal Loro replicas**, distinguished only by PeerID provenance and the capability set on their harbor card — never by being a different *kind* of participant (Zed's flaw).

1. **Open.** Both join the file's `LoroDoc` as replicas; daemon mints/binds each PeerID to its PD identity.
2. **Claim before keystroke.** A is dispatched to refactor `parse_header`. Before typing it calls `POST /symbols/parse` then claims the symbol's line range (`POST /sessions/A/files`, region-scoped — **not** a whole-file lock, so H can edit `render()` in the same file). H claims via a UI affordance; A via the MCP tool `claim_region`.
3. **Predict.** The daemon runs `POST /conflicts/predict` against live claims. Overlap → the requester gets a `Conflicted`-tone guard band + a `pd nudge` (existing suggestion-broker) to negotiate — **not** a silent CRDT merge. The harbor envelope is checked here; an actor lacking write-cap for that path is refused *before any op*.
4. **Edit.** Granted, the claim lands in Loro `Awareness` as a colored, labeled range ("agent A — parse_header") visible to everyone. Edits flow as Loro ops over the tube; bytes merge conflict-free, each authored to its replica.
5. **Who-wins on contention.** H tries to type **inside A's claimed range** → Coordination Guard intercepts (the same guard that gates commits), shows a `Lima`/`Gated` chip "claimed by agent A", and offers nudge or parley (negotiate the claim) — never a silent merge. **The guard message points ONLY to the correct action (request handoff), never names a bypass flag (hard rule).** Default ownership rule: **first granted, non-revoked claim wins**; the contender must negotiate or pick another region. ENFORCE mode (governed harbors) rejects the out-of-claim op at daemon ingress; advisory mode surfaces the band and lets it through with a note.
6. **Commit gate.** `pd guard check --staged` refuses if an edited region's claim is held by another *live* actor — the semantic gate Zed's auto-merge skips. Provenance (which actor, which card `jti`, which note justified it) lands in an immutable note.
7. **Salvage (the wedge).** A's process dies mid-edit. Its claim + flushed op-log + scope note persist (`/blob` snapshot + session record). `POST /recovery/request` surfaces "agent A left dirty work on parse_header (claim held, snapshot `blob:…`)"; a successor consumes via `POST /recovery/consume`, replays A's ops onto the live doc, inherits the claim, and finishes — full attribution. Zed loses this entirely.

Agents reach all of this through agent-neutral MCP tools (`claim_region`, `release_region`, `coordination_preflight`, `salvage`) — first-class, **never Claude-specific**.

## 5. Phased roadmap

> Build order corrects Design C's fatal inversion: **the buffer is the risk, not the transport.** Prove the editor + coordination over the daemon bus we already have; abstract topology behind `SyncTransport` from day one but defer iroh/relay until the wedge is demoed. Each phase reuses a named PD asset.

| Phase | Goal | Concrete deliverables | Reuses |
|---|---|---|---|
| **P0 — Walking skeleton (reuse-only, ~1 wk)** | Editor surface hosts a file with zero buffer work | `SurfaceKind::Editor{path,region}` in mux.rs; read-only file viewer as a `Pane` (`view()`/`refresh()` → Blocks) in GPUI **and** TUI; `FileTree` → open-in-Editor wiring | mux.rs Workspace tree, pane.rs Surface contract, FileTree variant |
| **P1 — Buffer + Loro (the one hard from-scratch cost, 4–6 wk)** | One human edits one local file, backed by Loro | Loro crate integrated; `LoroText` per file; each actor = a Loro replica keyed to PD identity; cursor + **per-PeerID authorship gutter**; undo-map; tree-sitter incremental reparse on CRDT deltas. **No networking.** Flagged honestly as the cost center | GPUI text primitives; tree-sitter |
| **P2 — LAN multiplayer over the bus (3–4 wk)** | Two humans co-edit one file, self-hosted | Loro Protocol multiplexed over the daemon's tube SSE (`Subscription::Editor`, `on_stream` folds remote ops); cursors/selections via `EphemeralStore`; snapshots → `/blob`, op-log deltas → immutable notes; follow-mode. **Reaches Zed's LAN baseline — but self-hosted, no vendor cloud** | tube pub/sub, `/blob`, immutable notes, `AgentTranscript` SSE plumbing |
| **P3 — Agents-as-peers + claims (the wedge, 4–5 wk)** | Two agents + a human reach for adjacent regions; PD surfaces and resolves the overlap | Region/symbol claims rendered as Loro awareness ranges; `Conflicted` guard band + `pd nudge` on overlap; `claim_region`/`release_region`/`coordination_preflight` exposed as MCP tools; `agent.rs` drives a dispatched agent editing a claimed region inline; guard rejects out-of-claim edits + re-checks staged ranges on commit. **The demo that beats Zed** | `POST /symbols/parse`, `POST /conflicts/predict` (symbols.ts:216), suggestion-broker, agent.rs mux, maritime Tone vocabulary |
| **P3.5 — Salvage + provenance (2 wk, fold into P3 demo)** | Kill an agent mid-edit, recover the edit | Dead-replica op-log persistence; `POST /recovery/request` surfaces dirty buffer+claim; `/recovery/consume` replays + inherits; immutable-note audit of who-wrote-which-span. **The headline demo** | `routes/recovery.ts`, `/blob`, immutable notes, ADR-0028 salvage envelope |
| **P4 — Shared harbor + capability enforcement (4–5 wk)** | Join-by-link, capability-scoped per path/region | `SyncTransport` trait formalized; host daemon authoritative for the claim/governance ledger; `PUT /harbors/:name/envelope` scopes per-region edit cap; signed Ed25519 cards gate join; `POST /harbors/:name/check` as in-editor dry-run; shadow-vs-direct agent-write policy from the card's cap set | harbor-card-rs, routes/harbors.ts, sessions |
| **P5 — Remote harbor + polish (5–6 wk)** | Three-topology parity + bespoke viz | iroh 1.0 P2P/LAN-direct transport (air-gapped story — **net-new, isolated behind the trait**); E2E-encrypted remote-harbor relay over `lib/relay-client.ts`/`routes/relay.ts`; Vello living-harbor presence/causal overlay (workspace-excluded); ACP/MCP bridge so PD coordinates agents inside Zed/JetBrains | ADR-0027/0049 relay (partial), pd-timeline-proto, ACP |

## 6. Risks & honest unknowns

- **The buffer (P1) is the only genuinely-from-scratch cost and it is hard.** GPUI text editing is not a public, documented widget the way Loro is a documented CRDT. Real risk of reimplementing more of an editor (selection, IME, wrapping, large-file virtualization) than scoped. **Mitigate:** spike against the smallest real file first; resist feature-creep toward a full editor; borrow GPUI primitives, build only buffer+coordination.
- **Loro↔GPUI binding at 120fps is unproven for PD.** Wiring the delta stream into GPUI's entity/render model must do viewport-diff rendering, not full re-layout per op. **Do not try to out-edit Zed on latency — win on coordination.**
- **Logical-conflict UX is genuinely unsolved.** Surfacing "these merge cleanly but contradict" without nagging is a design problem; over-warning trains actors to ignore the guard (the bypass-advertising failure mode). Debounce; predict on claim-acquire/region-enter, not per-keystroke (symbol parse per char is too slow).
- **Salvage correctness.** Replaying a dead replica's op-log onto a doc that advanced after its death must converge deterministically — needs **property tests on Loro op-replay ordering**, not a happy-path demo.
- **Loro-replica↔PD-identity binding** must survive reconnect/salvage; a mismatch corrupts authorship/audit. Needs a clean identity↔replica contract.
- **iroh / relay maturity (P5).** iroh is absent from the codebase; the relay (`lib/relay-client.ts`, ADR-0027/0049) is partial, not the full NAT-traversal stack. iroh NAT traversal is not 100% — symmetric-NAT remote harbors fall back to a (self-hostable) relay hop; the "pure P2P everywhere" story must be honest, not hidden. Gated behind the topology phase precisely so it never blocks the wedge.
- **Daemon must stay lean.** Zed's loudest complaint is AI/collab surfaces bloating the core and tanking perf. **Isolate the edit-sync channel from the coordination control plane** so editor load never regresses claim latency.
- **Competitive convergence.** If Zed ships claim/lock/supervisor-merge on ACP, it encroaches directly. **Mitigate:** move fast on salvage + capability (hardest to bolt onto a cloud-only relay); ship the ACP bridge so PD wins even if our editor lags.
- **Scope honesty.** This is a multi-quarter build. The wedge IS the coordination — a buffer without claims/salvage is a Potemkin editor, not the product. Refuse it.

## 7. The first two weeks (what to build Monday)

> **HISTORICAL — P0 through P3 described below are SHIPPED, not next-up.** This
> section was written before the build started; read it as a record of intent,
> not a to-do list. Confirmed merged on `origin/main`: P0 read-only editor
> surface (#563), the editor perf rescue / virtualized `CodeBuffer` (#896), P2
> LAN substrate — editor_sync/edit+coord channels/presence/blob (#727), P3
> agents-as-peers + region claims + wedge + commit gate (#728), the wedge wired
> into the live app stages 1+2 (#729), and the P3.5 salvage proptest
> foundation (#1539). What is genuinely still open: P1 *interactive* human
> keystroke editing (live text input/undo/tree-sitter reparse — unbuilt), the
> P3.5 end-to-end salvage demo (unbuilt), the claim-validator 409 write-block
> (#983, open), and P4 capability enforcement / P5 remote-harbor (both
> unbuilt). #2237 (file navigator), #3140 (pane snap-drag), and #1960 (editor
> reskin) are also open, unmerged follow-on work, not part of the plan below.

**Worktree, branch, coordinate first** (`git worktree add ~/coding/tmp/harbor-editor-p0 -b harbor-editor-p0`; `pd begin --identity port-daddy:editor:p0`; claim `core/pd-console/src/mux.rs` + a new `editor.rs`).

**Week 1 — P0 walking skeleton (reuse-only, zero buffer work):**
1. Add `SurfaceKind::Editor { path: String, region: Option<(u32,u32)> }` to `mux.rs:33`; extend the `title()` match (mux.rs:65) and `bind_entity` (mux.rs:266) to repoint the path.
2. New `core/pd-console/src/editor.rs` <!-- cite-exempt: historical filename — shipped as core/pd-console/src/editor_pane.rs -->: a read-only `Pane` impl — `view()` renders file lines as `Block::Row`s with a gutter column; `refresh()` reads the file (later: daemon `/blob`). Renders in **both** GPUI (`app.rs`) and ratatui (`term.rs`) — prove one-pane-two-faces before any CRDT.
3. Wire `FileTree` selection → `Workspace::split(Dir, SurfaceKind::Editor{..})`. Unit-test the new mux path alongside the existing `split_creates_two_panes` test (mux.rs:417).
4. **Exit criterion:** open a file from the tree into a real editor pane in the GPUI window; same file shows in the TUI. No buffer yet — this de-risks the surface with zero from-scratch cost.

**Week 2 — P1 spike: Loro behind the surface (the hard part, started honestly):**
5. Add `loro` (v1.13.x) to the editor crate. Build a `Buffer` wrapping one `LoroDoc`/`LoroText`; mint a PeerID from `pd whoami` identity.
6. Replace the read-only viewer's backing store with the Loro buffer; wire GPUI text-input → Loro local ops → re-render the changed viewport only (diff render, not full re-layout).
7. **Authorship gutter:** color each span by its PeerID — this is the visible proof that "agent vs human" is a first-class buffer concept from day one.
8. Property-test harness scaffold for Loro op-replay convergence (the salvage-correctness foundation, even though salvage lands in P3.5).
9. **Exit criterion:** a single human edits one local file backed by Loro, undo works, the gutter shows authorship. This is the editor core; everything after P1 is assembly of shipped PD parts.

**Do NOT build in the first two weeks:** networking, iroh, the relay, multiplayer, claims enforcement, Vello viz. Topology and the wedge come *after* the buffer exists. The single highest risk is the buffer; spend the two weeks proving the surface (week 1, cheap) and cracking the buffer (week 2, hard), in that order.

---

**Files that matter (all absolute):** `/Users/erichowens/coding/port-daddy/core/pd-console/src/mux.rs` (SurfaceKind enum:33, Workspace:129), `/Users/erichowens/coding/port-daddy/core/pd-console/src/pane.rs` (Surface contract:56-114), `/Users/erichowens/coding/port-daddy/core/pd-console/src/agent.rs` (8-backend mux), `/Users/erichowens/coding/port-daddy/routes/symbols.ts` (conflicts/predict:216), `/Users/erichowens/coding/port-daddy/routes/recovery.ts` (salvage), `/Users/erichowens/coding/port-daddy/routes/harbors.ts`, `/Users/erichowens/coding/port-daddy/core/harbor-card-rs/src/lib.rs` (Ed25519, 218 LOC), `/Users/erichowens/coding/tmp/cut-run/core/pd-timeline-proto/src/scene.rs` (Vello viz). New: `/Users/erichowens/coding/port-daddy/core/pd-console/src/editor.rs`.