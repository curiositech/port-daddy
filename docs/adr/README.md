# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for Port Daddy. Each ADR documents a significant architectural choice: what was decided, why, and what the consequences are.

ADRs follow the [MADR format](https://adr.github.io/madr/) (Markdown Architectural Decision Records).

## Index

| Number | Title | Status | Date |
|--------|-------|--------|------|
| [0001](0001-sqlite-as-primary-database.md) | SQLite as Primary Database | Accepted | 2025-01 |
| [0002](0002-module-factory-pattern.md) | Module Factory Pattern for Dependency Injection | Accepted | 2025-01 |
| [0003](0003-semantic-identity-system.md) | Semantic Identity System (`project:stack:context`) | Accepted | 2025-01 |
| [0004](0004-unix-socket-primary-transport.md) | Unix Socket as Primary CLI-to-Daemon Transport | Accepted | 2025-03 |
| [0005](0005-single-file-dashboard.md) | Single-File HTML Dashboard | Accepted | 2025-02 |
| [0006](0006-synchronous-sqlite-queries.md) | Synchronous SQLite Queries via `better-sqlite3` | Accepted | 2025-01 |
| [0007](0007-immutable-session-notes.md) | Immutable Session Notes (Append-Only) | Accepted | 2025-02 |
| [0008](0008-agent-resurrection-pattern.md) | Agent Resurrection Pattern for Dead-Agent Recovery | Accepted | 2025-03 |
| [0009](0009-mcp-server-integration.md) | MCP Server Integration for Claude Agent Tooling | Accepted | 2025-03 |
| [0010](0010-maritime-design-language.md) | Maritime Design Language Throughout CLI and Dashboard | Accepted | 2025-02 |
| [0011](0011-reactive-coordination-kernel.md) | Reactive Coordination Kernel (Bun, Fastify, WAL) | Accepted | 2025-03 |
| [0012](0012-semantic-token-graph-and-trie.md) | Semantic Token Graph and Radix Trie | Accepted | 2025-03 |
| [0013](0013-unified-harbor-model.md) | Unified Harbor Model and Cryptographic Security | Accepted | 2025-03 |
| [0014](0014-the-anchor-protocol.md) | Anchor Protocol and Verifiable Economy | Accepted | 2025-03 |
| [0015](0015-layered-resurrection.md) | Layered Resurrection and Bosun Watchdog | Accepted | 2025-03 |
| [0016](0016-hardened-cross-platform-ipc.md) | Hardened Cross-Platform IPC | Accepted | 2025-03 |
| [0017](0017-db-file-protection-threat-model.md) | DB File Protection and Insider Threat Model | Accepted | 2025-03 |
| [0018](0018-adversarial-security-analysis.md) | Adversarial Security Analysis of the Anchor Protocol | Accepted | 2025-03 |
| [0019](0019-declarative-fleet-yaml.md) | Declarative Fleet Configuration | Accepted | 2025-03 |
| [0020](0020-ipc-failure-modes.md) | IPC Binary Protocol Failure Modes and Mitigations | Accepted | 2025-03 |
| [0021](0021-bosun-consolidation.md) | Bosun Consolidation | Accepted | 2026-04 |
| [0022](0022-durable-actor-souls-and-body-leases.md) | Durable Actor Souls and Body Leases | Accepted | 2026-04 |
| [0023](0023-cartographer-roadmap-actor.md) | Cartographer as Navigator Roadmap Actor | Accepted | 2026-04 |
| [0024](0024-daemon-profiles.md) | Named Daemon Profiles | Accepted | 2026-04 |
| … | _(0025–0035, 0037–0042 — index backfill tracked as `adr-0043-phase-5-retrofit-existing-adrs`)_ | | |
| [0036](0036-bosun-supervisor.md) | pd-bosun — Minimalist Daemon Supervisor (Rust binary) | Accepted | 2026-06 |
| [0043](0043-adr-implementation-matrix.md) | ADRs Carry a Roadmap-Linked Implementation Matrix | Accepted | 2026-06 |
| [0044](0044-shadow-db-path-consolidation.md) | Shadow-Mode DB Path Consolidation | Accepted | 2026-06 |
| [0045](0045-loud-fail-invariants-and-honest-attestation.md) | Loud-Fail Invariants and Honest Attestation | Accepted | 2026-06 |
| [0046](0046-operator-tui.md) | The Operator TUI — Conversation Multiplexer | Accepted | 2026-06 |
| [0047](0047-harbor-envelope-enforcement.md) | Harbor Envelope Enforcement — advisory scope to a fail-closed boundary | Accepted | 2026-06 |
| [0048](0048-what-port-daddy-is.md) | What Port Daddy Is — the North Star | Accepted | 2026-06 |
| [0049](0049-relay-architecture.md) | Relay v0 Architecture | Accepted | 2026-06 |
| [0050](0050-coast-guard.md) | The Coast Guard — Agentic Safety on the Operator's Machine | Accepted | 2026-06 |
| [0051](0051-marketplace-protocol.md) | The Marketplace Protocol — Encrypted-Capability Trade Across Operators | Proposed | 2026-06 |
| [0052](0052-trajectory-export-and-rl-loop.md) | Trajectory Export and the Coordination RL Loop | Proposed | 2026-06 |
| [0053](0053-out-of-band-enforcement.md) | Out-of-Band Enforcement — Making Port Daddy Compulsory, Not Bypassable | Proposed | 2026-06 |
| [0060](0060-daemon-fleet-conductor.md) | The Daemon Fleet Conductor — one daemon that conducts the whole autonomous fleet | Proposed | 2026-06 |
| [0084](0084-daemon-berths.md) | Daemon Berths — tiered, colour-coded, side-by-side daemons | Accepted | 2026-06 |
| [0089](0089-durable-security-forensics-journal.md) | Durable security-forensics journal — security events survive the 7-day prune | Accepted | 2026-06 |
| [0090](0090-the-harbor.md) | The Harbor — one helm for human+agent fleets (North Star; extends ADR-0048) | Proposed | 2026-06 |

> **Numbering authority.** The machine-authoritative number → file map is
> [`adr-numbering-registry.json`](adr-numbering-registry.json), a pure projection
> of this directory regenerated by
> `scripts/adr-number-collision-guard.mjs --write-registry` and enforced
> fail-closed at commit/CI time (no two live ADRs may share a number).

### Renumbered — 2026-07-15 collision resolution

Twelve ADR numbers had collided (two or three ADRs sharing one `NNNN`). Each
collision was disambiguated by keeping the number on the most-cited /
earliest-accepted ADR and renumbering the other(s) into the next free block
(`0102`+). A one-line forwarding stub remains at every old path so existing
links do not 404. See the registry for the full keep-vs-renumber record.

| Number | Title | Status | Renumbered from |
|--------|-------|--------|-----------------|
| [0102](0102-salvage-envelope.md) | Salvage Envelope and Resume Contract | Proposed | 0028 |
| [0103](0103-signed-binary-distribution.md) | Signed Binary Distribution and Open Content Releases | Proposed | 0028 |
| [0104](0104-pd-backup-durable-snapshots.md) | pd backup / pd restore — durable snapshots | Proposed | 0037 |
| [0105](0105-portdaddy-dev-account-surface.md) | portdaddy.dev — Account Surface, Receipts, Steering | Proposed | 0039 |
| [0106](0106-pd-encompassing-shell.md) | PD-Encompassing Shell — harness-agnostic tool observation | Draft | 0040 |
| [0107](0107-conversation-protocol.md) | The Port Daddy Conversation Protocol | Accepted | 0047 |
| [0108](0108-port-daddy-harness.md) | The Port Daddy Harness — a harnessed agent as a fleet citizen | Proposed | 0051 |
| [0109](0109-the-steward-single-approver.md) | The Steward — one agent for review, landing, improvement | Accepted | 0056 |
| [0110](0110-unified-distribution.md) | Unified Distribution — Port Daddy as one beautiful whole | Proposed | 0057 |
| [0111](0111-parley-protocol.md) | The Parley Protocol — bounded, typed convening (RCP-3) | Proposed | 0086 |
| [0112](0112-operator-console-rendering-stack.md) | Operator Console Rendering Stack — gpui + Vello | Proposed | 0086 |
| [0113](0113-phase-2-3-build-spec.md) | TCB Enforcement — phases 2 + 3 build spec | Proposed | 0087 |
| [0114](0114-build-stage-spec.md) | Host-Safety Layer — Phase A build spec (`pd safe scan`) | Proposed | 0088 |
| [0115](0115-database-distribution-and-sync.md) | Database Distribution & Sync Architecture | Proposed | 0090 |

## How to Read These

Each ADR is self-contained. They are ordered roughly chronologically and by foundational importance — earlier ADRs establish the ground rules that later ADRs build on.

**Suggested reading order for new contributors:**

1. Start with ADR-0001 (SQLite) and ADR-0002 (factory pattern) — these two decisions shape every module in the codebase.
2. Read ADR-0003 (identities) to understand the naming convention used everywhere.
3. Read ADR-0006 (sync queries) alongside ADR-0001 — together they explain why the entire system is synchronous-first.
4. Read the remaining ADRs in any order.

## Adding a New ADR

Copy the template below and save it as `NNNN-short-title.md` (next available number, kebab-case title).

```markdown
# NNNN. Title

## Status

Proposed | Accepted | Deprecated | Superseded by [NNNN](link)

## Context

What problem or situation prompted this decision?

## Decision Drivers

- Driver 1
- Driver 2

## Considered Options

- Option A
- Option B
- Option C

## Decision

What was chosen and a one-sentence rationale.

## Rationale

Detailed explanation of why this option was preferred.

## Implementation Matrix

<!-- ADR-0043: REQUIRED for any ADR implying buildable work. One row per phase.
     The `Roadmap slug` is the stable join key into roadmap_items (ADR-0033);
     `pd adr sync NNNN` upserts each phase at status `now` (high priority) and
     `pd adr matrix NNNN` renders LIVE status from the table. Omit only for
     pure-documentation ADRs with no work to track. -->

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-NNNN-phase-0-short-name | now | — | What phase 0 delivers |

## Consequences

### Positive
- ...

### Negative
- ...

### Neutral
- ...
```
