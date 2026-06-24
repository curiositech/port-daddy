# Coordination Substrate Status

Mode: reference.

This file tracks which coordination ideas are only named, which are designed,
which are visible, which are written at runtime, which are read at runtime, and
which are live in a released daemon.

## Status Meanings

| Status | Meaning |
|---|---|
| Idea | Named direction, no stable contract yet. |
| Designed | ADR or concept doc exists. |
| Visualized | UI/docs can render or explain it. |
| Runtime write | Code writes durable rows for it. |
| Runtime read | Product behavior reads those rows as authority. |
| Live daemon | Shipped binary/Homebrew daemon can serve it. |

## Coordination Substrate Ledger

| Substrate | Source of truth | Current status | What is true today | Next honest step |
|---|---|---|---|---|
| **claim tree** (`docs/adr/0038-claim-tree.md`) | ADR and concept docs | Designed, visualized | The hierarchy and conflict rules are specified. The concept page and visualization gallery are committed under `website-v2/src/pages/docs/concepts/ClaimTree.tsx` and `website-v2/src/pages/docs/concepts/claim-tree/`. | Keep docs honest as runtime behavior moves from file claims into the forest. |
| **claim forest** (`lib/claim-forest.ts`) | Local database tables `claim_forest_nodes`, `claim_forest_edges`, `claim_forest_claims` | Runtime write, runtime read on this branch | Session file and region claims dual-write into the forest. Active-claim listing, owner lookup, conflict checks, session detail reads, release, and terminal session cleanup read or update the forest. | Add repo/ref/commit/harbor projections and expose the forest directly through CLI/API routes. |
| **session files** (`lib/sessions.ts`) | Compatibility table `session_files` | Runtime write, compatibility read | Existing callers still get the same session claim shapes. New writes keep `session_files` in sync while forest reads become authoritative for active ownership. | Retire direct ownership reads from `session_files` after API/CLI surfaces grow explicit forest endpoints. |
| **Coordination Guard** (`cli/commands/guard.ts`) | Guard checks plus session/claim state | Live daemon/CLI behavior | The guard enforces coordination ceremony before commit/push. It still consumes the session/claim surface rather than a dedicated forest projection. | Teach guard diagnostics to name forest node ids, repo worlds, and stale legacy/forest divergence. |
| **daemon** (`server.ts`) | Installed process and database | Not live for this branch until release | Source now knows how to create and use forest tables. The live Homebrew daemon will not gain this behavior until a rebuilt binary is promoted and cut. | Rebuild/relaunch for local dogfood, then cut a user-visible version when this ships. |
| **harbor** (`lib/harbors.ts`) | Harbor membership and routing tables | Idea/design adjacency | The forest type has a `harbor` world kind, but no harbor projection writes into it yet. | Map remote/federated claims into forest worlds without conflating local worktree truth with remote truth. |

## Read-From-It Rule

No new coordination store should ship as write-only. A substrate is not real
until at least one product path reads it as authority and a focused test proves
that read survives if the old compatibility table is removed.

For the claim forest slice, that means:

| Product path | Forest-backed behavior |
|---|---|
| `sessions.listAllActiveClaims()` | Reads `claim_forest_claims` joined through nodes and sessions. |
| `sessions.getClaimOwner()` | Reads forest active claims for the file/range/symbol query. |
| `sessions.get()` | Lists claims from the forest, including released history. |
| `sessions.claimFiles()` | Detects conflicts from forest active claims before writing. |
| `sessions.releaseFiles()` | Releases both compatibility rows and forest claims. |
| `sessions.end()` / phase terminal states | Release all forest claims for the session. |

## Database Release Note

Adding these tables does not require a destructive migration. The schema is
created with `CREATE TABLE IF NOT EXISTS`, and the forest backfills existing
`session_files` rows on module initialization.

It does require a user-visible release before operators can rely on it through
Homebrew. If behavior changes after `brew upgrade port-daddy`, the binary
version needs to move with the schema and read-path change.
