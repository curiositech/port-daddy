# Gardener triage — 2026-05-31

**Operator:** Erich Owens. **Gardener:** release-engineer (this session). **Source:** all worktrees + branches + PRs touching `curiositech/port-daddy` as of 2026-05-31.

## Counts

| Cluster | Count |
|---|---|
| [ALIGNED_WIP](./cluster-ALIGNED_WIP.md) | 169 |
| [DESIGN_OR_RESEARCH_OR_PLANNING](./cluster-DESIGN_OR_RESEARCH_OR_PLANNING.md) | 11 |
| [DUPLICATIVE_CAN_HARVEST](./cluster-DUPLICATIVE_CAN_HARVEST.md) | 10 |
| [UNALIGNED_DONE](./cluster-UNALIGNED_DONE.md) | 5 |
| [STALE](./cluster-STALE.md) | 253 |
| [MERGED_BRANCH_LIVES](./cluster-MERGED_BRANCH_LIVES.md) | 68 |
| [ORPHAN_WORKTREE](./cluster-ORPHAN_WORKTREE.md) | 12 |
| **Total** | **528** |

## Adversarial bar

Operator-set: a PR clears DONE only if **all required CI checks pass AND an `/ultrareview` or `redteam-review` pass exists on the branch.** This pass requires HITL or fleet-agent verification. Items in DONE here have **CI-green only** — promote them with HITL confirmation.

## HITL queue (top priority)

Items flagged for human attention before mechanical action:

| Cluster | Branch / Path | PR | Age | Why |
|---|---|---|---|---|
| ALIGNED_WIP | `codex/tui-fleetbar-design-wip-20260518` | - | 13d | No PR, fresh (13d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `feat/roadmap-unify-claims-items` | - | 13d | No PR, fresh (13d), worktree active |
| ALIGNED_WIP | `origin/codex/tui-fleetbar-design-wip-20260518` | - | 13d | No PR, fresh (13d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/feat/roadmap-claim-session-link` | - | 13d | No PR, fresh (13d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/feat/roadmap-pop-atomic` | - | 13d | No PR, fresh (13d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `cockpit/slice-c-markdown-ingester` | - | 12d | No PR, fresh (12d), worktree active |
| ALIGNED_WIP | `feat/coord-counter-coverage` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `feat/pd-whois-phonebook` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `pr-114-fixup-foreground` | - | 12d | No PR, fresh (12d), worktree active |
| ALIGNED_WIP | `pr-116-redteam` | - | 12d | No PR, fresh (12d), worktree active |
| ALIGNED_WIP | `pr-117-checkout` | - | 12d | No PR, fresh (12d), worktree active |
| ALIGNED_WIP | `tmp/branch3-ci-metadata` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `tmp/branch4-pricing` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `worktree-agent-a00b8533ad0920f09` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `worktree-agent-a0b3d6f1c6e2fdf9f` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `worktree-agent-a37a5d046b0a22838` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `worktree-agent-a48a736d234b1da43` | - | 12d | No PR, fresh (12d), worktree active |
| ALIGNED_WIP | `worktree-agent-a4cb866ec7fccca80` | - | 12d | No PR, fresh (12d), worktree active |
| ALIGNED_WIP | `worktree-agent-a51513d7d83f26fa5` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `worktree-agent-a61c12bc74d1bdfa9` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `worktree-agent-a72395fb31e511fd0` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `worktree-agent-a7572be08e1ebc1c6` | - | 12d | No PR, fresh (12d), worktree active |
| ALIGNED_WIP | `worktree-agent-a7dd3050003e0fc8d` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `worktree-agent-aa026090660f09f4b` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `worktree-agent-ad1edceb5a0c9f40b` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `worktree-agent-aefc5ddea1893359a` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `worktree-agent-af820f0d803e148da` | - | 12d | No PR, fresh (12d), worktree active |
| ALIGNED_WIP | `worktree-agent-afd153d2c875098c9` | - | 12d | No PR, fresh (12d), worktree active |
| ALIGNED_WIP | `origin/chore/release-3.15.0` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/chore/ssr-safety-prep` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/cockpit/phase-2-dismiss-snooze-tuples` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/design/pheromone-vocabulary-v1` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/docs/claim-tree-explainer` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/feat/pd-whois-phonebook-salvage` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/feat/roadmap-schema-jira-forward` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/feat/three-tier-memory-vocab` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/figure/bonded-three-layer-canonical` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/fix/fleet-cron-to-event-driven` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/fix/whitepaper-fig-overflow-and-pacing` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/paper/wave3-bundle` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/pr-116-redteam` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/pr-117-checkout` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/refactor/whitepaper-correlating-device` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/refactor/whitepaper-inline-appendices` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/refactor/whitepaper-present-tense` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/swarm/econ-v2` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/tmp/branch3-ci-metadata` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/tmp/branch4-pricing` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/worktree-agent-a36925a8e6fde11c8` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |
| ALIGNED_WIP | `origin/worktree-agent-a48a736d234b1da43` | - | 12d | No PR, fresh (12d), no worktree — needs to be PRed or archived |

*(showing first 50 of 161 HITL items)*

## Methodology

1. Inventory: enumerated all branches (local+remote), worktrees, open/closed/merged PRs. Cross-linked.
2. Auto-classify: signal-based rules (PR state, merge state, age, worktree presence, draft flag, title prefix).
3. Duplicate detection: pairwise Jaccard on file-touched sets across live (non-archived) branches; pairs ≥0.8 promoted to DUPLICATIVE_CAN_HARVEST.
4. Cluster reports: per-cluster `.md` with tabular rows.
5. HTML A/B comparisons: rendered for DUPLICATIVE pairs (see `compare/`).

## Raw data

- `raw/inventory.json` — full cross-linked inventory
- `raw/classified.json` — per-item cluster + confidence + reasons
- `raw/duplicates.json` — file-overlap pair candidates

## Open items

- [ ] **Architecture fork output** at `docs/architecture/2026-05-31-agent-abstraction-strategy.md` — proposes the release-engineer should ship as `agents/release-engineer.yaml` with Shipwright emitting to 4 runtimes. **Operator review needed.**
- [ ] **Sortie fix PR #187** (`fix/sortie-unblock`) — root cause = `--budget` per-call cap forwarded to project-daily ceiling check. Mid-CI. Adds runbook at `docs/operations/sortie-runbook.md`.
- [ ] **PD DB elevation** (task #151) — promote triage taxonomy from this markdown into PD's SQLite. Blocked on `pd backup` (PR #157).
- [ ] **130 worktrees** — many are likely safe to archive. Cleanup candidates listed in cluster-MERGED_BRANCH_LIVES.md, cluster-ORPHAN_WORKTREE.md, cluster-STALE.md (where `WT` column is `✓`).

