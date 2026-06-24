# ADR-0090: Database Distribution & Sync Architecture for Port Daddy

**Status:** Proposed
**Supersedes/extends:** builds on ADR-0044 (shadow-db-path), ADR-0024 (daemon-profiles), ADR-0029 (user-accounts), ADR-0027/0049 (relay), ADR-0001 (sqlite-as-primary).
**Date:** 2026-06-23
**Author:** DB-distribution research agent (read-only investigation of the live repo)

---

## 1. Problem Statement & The Four Distribution Contexts

### The surfacing bug (ground truth)

"Data lived on the brew daemon (`:9876`) while a board route lived on a dev daemon (`:9886`); CI can reach neither" is **structurally explained by the code**, not a one-off:

- `lib/db.ts:43 resolveDbPath()` resolves the *default* DB to `<distribution-root>/port-registry.db` (or `PORT_DADDY_DB`) — the path ADR-0044 wants to canonicalize.
- **But** `lib/daemon-profiles.ts:63 resolveDaemonProfile()` gives *each named daemon profile its own file*: `instances/<profile>/port-daddy.db` (ADR-0024). brew vs dev checkout run under different profiles → **different `.db` files by design**.

Port Daddy already has **two DB-path resolvers that disagree**, and ADR-0044 (Accepted, UNBUILT) only addresses the first. Same-machine daemons are already a tiny distributed system with no reconciliation — the head-start and the trap simultaneously.

### The four contexts

| Context | What it is | Hard constraint | Consistency need |
|---|---|---|---|
| (a) Multi-daemon, one host | brew + dev, each `resolveDaemonProfile()` → own `.db` | Keep ADR-0024 profile isolation for runtime (ports/sockets) while sharing board data | Strong-ish; single-writer feasible |
| (b) Ephemeral CI / unit runners | jest `:memory:`, bun:sqlite smoke | Fail-closed guard forbids touching prod registry; no network identity | None internally; needs deterministic seed |
| (c) User's other computers | second laptop/PC | NAT/outbound-only, untrusted transport, intermittent | Eventual; offline-first — the only true WAN-sync case |
| (d) The Relay itself | shipped `apps/relay/` (D1 + Durable Objects + KV) | Never sees plaintext (I1) | N/A — routes ciphertext, owns no state |

Core tension honored: ADR-0001 ("SQLite is not distributed — that's a feature") and ADR-0049 deliberately rejected the Raft/multi-writer mesh in favor of **event federation, not state replication**. This ADR distributes the DB by **federating change-events over the existing relay + reconciling per-table**, NOT by running a consensus log.

## 2. THE CORE DECISION — Per-Table Hybrid

Tables have genuinely different semantics:
- `roadmap_items` — durable DB-of-record, human-authored, sibling append-only `roadmap_item_status_events`. Real merge conflicts possible.
- `session_notes` — immutable/append-only (ADR-0007). Conflict-free.
- `session_files` (claims) — advisory; LWW acceptable (a lost claim is at worst a redundant nudge).
- `sessions` — ephemeral, single-writer-per-origin, fan-out read replica.
- `feedback → roadmap` — already event-sourced.
- services/endpoints/locks (ports) — machine-local; must NOT sync.

**Three replication classes:**

| Class | Mechanism | Tables | Rationale |
|---|---|---|---|
| LOCAL-ONLY (never sync) | per-host/per-profile | services, endpoints, locks, ports, tube TTL | a port binding is physically local; syncing it is meaningless and dangerous |
| APPEND-ONLY G-Set | event federation; union by `(daemonFingerprint, seq)` | session_notes, feedback events, roadmap_item_status_events, fleet events, audit leaves | add-only sets have trivial CRDT merge; the easy 80% |
| MUTABLE LWW register (per-field, HLC) | "field X = V at hlc T by writer W"; keep max-HLC | roadmap_items (status/summary/deps), claims, session phase | claims advisory → LWW correct; roadmap current-value LWW + G-Set status-events = "current is last-writer, history always auditable" |

Reject full multi-writer-CRDT-everywhere (over-engineered, re-litigates rejected mesh; CRDTs hide *logical* conflict). Reject single-writer-replication-everywhere (breaks offline edits on two devices). **Adopt hybrid** — minimum-conflict design matching the data.

**On Loro:** reuse the *infrastructure* (PeerID-from-PD-identity, tube/relay transport, awareness-as-claim bridge) but NOT `LoroText` for table rows. Loro's strength is collaborative text (keep it scoped to the Harbor editor buffer); table state is structured registers + append-only logs where hand-rolled HLC-LWW + G-Set is simpler and auditable.

## 3. Relay as Sync Hub & Cloudflare Primitives

The relay is **already built** (`apps/relay/src/index.ts`) and is a pure ciphertext event bus. Compose on top; don't modify its trust model.

| Primitive | Already used for | Sync use |
|---|---|---|
| Durable Object per `(harbor,channel)` (`harbor-channel.ts`) | per-harbor fan-out, monotonic `seq`, `from_seq` replay | per-account total order of change-events on reserved `_sync:<class>` channels; `from_seq` = sync cursor. No new ordering code. |
| D1 (`events`,`chain_heads`,`identities`) | identity registry, durable ciphertext store, Merkle heads | cloud system-of-record for the replayable change-event journal (7-day hot). NOT table-state SoR — daemon SQLite stays authoritative. |
| R2 | event archive after 7-day expiry | **encrypted snapshot blobs** via `VACUUM INTO`, keyed `account/<id>/snapshot/<hlc>.db.enc`; new device bootstraps from latest snapshot + replays since its HLC. Needs new `lib/backup-backends/r2.ts` (only `file.ts` exists). |
| KV | JWKS cache, pinned relay key | unchanged |

Critical: I1 preserved — relay never sees plaintext; all sync events AES-256-GCM under the account key (HPKE). Merge/conflict-resolution happens **only inside each daemon** after decryption. The consensus question is moot: there's an ordered ciphertext log and each replica deterministically folds it (G-Set union + HLC-LWW are order-insensitive for *correctness*; the DO seq gives liveness/cursor convenience, not safety).

## 4. User-Accounts / Identity / Auth

~80% designed in ADR-0029, ~70% built in the relay + `lib/harbor-tokens.ts`. Wiring, not inventing.

- **Device registration:** `pd account login` → GitHub OIDC device flow → relay `/v1/exchange` (exists) → account-owned Ed25519 key in OS keychain (distinct from daemon key). `pd account bind` → `PairingReceipt` co-signed by account + daemon keys (neither alone authoritative).
- **Capability tokens:** reuse `lib/harbor-tokens.ts` Ed25519 harbor cards (1h TTL, JTI audit, revocation). Sync scoping: attenuate a device card to `{op:"sub", channel:"_sync:*"}` for read-replicas, `{op:"pub", channel:"_sync:<class>"}` for write devices. viewer-role → sub-only (can never inject events). Macaroon attenuation invariant (child ⊆ parent) = device-scoping.
- **Envelope signing:** reuse `lib/event-envelope.ts` + `lib/merkle-chain.ts` — each change-event is a signed envelope chained per-publisher; receiver verifies chain continuity before folding. Compromise containment: 1h card TTL + `/v1/revoke` (≤5s broadcast) + receiver rule "reject events from revoked fingerprint with iat > revoked_at."

## 5. CI/CD + Unit-Test DB

CI/test runners are class (b): deterministic **seed**, never live state. The fail-closed guard (`lib/db.ts:117 assertNotProdInTest`, `:memory:`/`PORT_DADDY_TEST_DB`/tmpdir only) stays. A synced read-replica in CI would be a security hole and non-deterministic — rejected.

1. Unit → ephemeral `:memory:` (unchanged).
2. Route/integration smoke → scratch DB **seeded from a committed fixture**.
3. The roadmap-link gate → **`docs/roadmap/roadmap.snapshot.json`** is that fixture: a deterministic git-committed export of `roadmap_items` (+ status events). It is simultaneously the CI seed, the gate's source of truth for `Roadmap-Spawns:` validation, and a human-merged conflict backstop. SoR = live daemon SQLite; portable/CI form = committed snapshot; relay syncs deltas. CI never needs the relay or an account.

> Note: this matches the snapshot the roadmap-link gate (PR #520) already ships — the agent independently re-derived the same design.

## 6. Phased Rollout (each = a roadmap item → `Roadmap-Spawns:`)

```
adr-0044-phase-0-dark-launch-resolver        — resolveDbPathV2 observe-only on boot, log {v1,v2,identical}
adr-0044-phase-1-boot-divergence-report      — persist per-boot comparisons; pd db resolver-report
adr-0044-phase-2-shadow-replica-and-comparator — seed shadow via VACUUM INTO; best-effort mirror writes; comparator
adr-0044-phase-3-divergence-gated-promotion  — flip default to v2 after K clean boots; one-env-var rollback
adr-0090-phase-4-shared-board-db-across-profiles — split runtime-local tables (ports/locks) from shared board tables; fixes the bug at the local tier
adr-0090-phase-5-change-event-journal        — per-row HLC-stamped, class-tagged change-events into a local outbox (no transport yet)
adr-0090-phase-6-roadmap-snapshot-and-ci-seed — pd roadmap snapshot → docs/roadmap/roadmap.snapshot.json; seed smoke + gate from it
adr-0090-phase-7-r2-snapshot-backend         — lib/backup-backends/r2.ts: encrypted VACUUM-INTO snapshot up/download
adr-0029-v0-account-login-and-local-forest   — pd account login + account Ed25519 key + local pairing receipts + Merkle audit
adr-0090-phase-8-sync-channels-over-relay     — publish change-event envelopes to _sync:<class>; subscribe with from_seq; fold G-Set/LWW per card scope
adr-0090-phase-9-multi-machine-replica-and-bootstrap — second device pair, R2 snapshot pull, replay since HLC, revocation ≤5s
adr-0029-v3-cross-device-quotas-and-rbac     — owner/member/viewer sync scoping; cross-device fleet quota pool
```

Phases 0–3 are verbatim ADR-0044's own implementation matrix (unblock, not redesign). 4–9 are the new distribution work. Account phases reuse ADR-0029's v0/v3 plan.

## 7. Failure Modes (honest)

- **Logical conflict:** HLC-LWW silently picks a winner for `roadmap_items.status`. Mitigation: sibling append-only status-events (G-Set) preserves both transitions; committed snapshot forces human review. Claims LWW is *correct* by definition — no residual.
- **Partition / offline:** offline-first by design; daemon buffers outbox, replays from `from_seq` on reconnect. Failure: 7-day D1 retention — a device offline >7d misses aged-out events. Mitigation: R2 snapshot bootstrap (phase 7/9).
- **Auth compromise:** stolen card → scoped poison until revoke. Mitigation: 1h TTL + ≤5s revoke + Merkle attribution + "reject events from fingerprint with iat > revoked_at." Residual: pre-revocation poison already folded → needs `pd sync repair --exclude-fingerprint` (flagged, unspecced).
- **Snapshot staleness:** snapshot cadence ≤ retention/2 (≤3d vs 7d) guarantees overlap; snapshot HLC = explicit join point.
- **Split-brain:** because merge classes are commutative (G-Set union, HLC-LWW max), there is **no true split-brain for safety** — histories converge deterministically once partition heals. The dangerous split-brain (two daemons writing the same port/lock) is prevented by classifying ports/locks as LOCAL-ONLY. The original bug was split-brain on board data across same-host profiles → Phase 4 fixes locally, Phases 8–9 across machines.

## Critical Files
- `lib/db.ts` — resolveDbPath / fail-closed test guard (Phase 0–4)
- `lib/daemon-profiles.ts` — resolveDaemonProfile per-profile DB; the second resolver causing the split (Phase 4)
- `lib/relay-client.ts` — daemon handshake/subscribe/publish + TOFU pin (Phase 8)
- `apps/relay/src/harbor-channel.ts` — DO per (harbor,channel), monotonic seq + from_seq replay
- `lib/roadmap-items.ts` — table + status-events; snapshot source (Phase 6)
- `lib/backup.ts` + `lib/backup-backends/` — VACUUM INTO; needs r2.ts (Phase 7)
