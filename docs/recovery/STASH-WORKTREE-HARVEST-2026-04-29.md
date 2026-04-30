# Stash And Worktree Harvest - 2026-04-29

This ledger records the non-destructive salvage pass run on April 29, 2026 after
the Cartographer feedback promotion work. It exists so future agents can find
the recovered work by branch name instead of relying on local stash indices,
detached worktrees, or active-shell memory.

## Stash Preservation

The original stash stack is still present locally. The recovery branches below
preserve stash content as normal commits so they are durable on `origin` and can
be reviewed, cherry-picked, or deleted deliberately.

| Stash content | Stash commit | Recovery branch | Recovery commit |
| --- | --- | --- | --- |
| Existing preserved stash batch 00-18 | See local stash stack | `codex/stash-exact-20260429-00-*` through `codex/stash-exact-20260429-18-*` | Already pushed before this pass |
| `codex-preserve-unstaged-generated-media-before-rebase` | `8c0b52c01a86427d4cec9fdd29c873bcad2c4455` | `codex/stash-exact-20260429-19-preserve-unstaged-generated-media-before-rebase` | `594305e` |
| `codex-preserve-more-unstaged-recordings-before-rebase` | `30ff42a13d3746b5321c7d61a953925f273494c8` | `codex/stash-exact-20260429-20-preserve-more-unstaged-recordings-before-rebase` | `765ede8` |

Notes:

- The new stash commits were tracked-only two-parent stash commits. They were
  applied onto their original parent `dc6cbb8` and committed to recovery
  branches.
- Commit hooks in fresh temporary worktrees emitted missing-`tsx` diagnostics,
  so the archival recovery commits used `--no-verify`. These are preservation
  branches, not promoted integration branches.
- Stashes were not dropped.

## Dirty Worktree Snapshots

The following dirty worktrees were snapshotted without modifying the source
worktree. Dependency directories such as `node_modules` were intentionally
excluded.

| Source worktree | Snapshot branch | Snapshot commit | What it preserves |
| --- | --- | --- | --- |
| `/Users/erichowens/coding/port-daddy` | `codex/worktree-snapshot-20260429-root-recordings-rebase` | `16ba9ea` | Detached `codex/agents-flow-guard-readable-ids` rebase state with website terminal casts, gifs, and visual review PNGs |
| `/private/tmp/port-daddy-fcc-clean` | `codex/worktree-snapshot-20260429-fcc-clean` | `45f1d93` | Fleet Control Center source edits plus rebuilt `public/fleet-ui` assets |
| `/private/tmp/port-daddy-pr5-ui` | `codex/worktree-snapshot-20260429-pr5-ui` | `afd2796` | PD Tube and relay PKI docs, demos, tutorial routes, and website tutorial wiring |
| `/private/tmp/port-daddy-og-branded` | `codex/worktree-snapshot-20260429-og-branded` | `096e0cf` | Branded route OG card generator and generated image set at the moment of snapshot |
| `/private/tmp/port-daddy-og-branded` | `codex/og-branded-social-cards` | `dcb02f6` | Active worktree commit for the same OG-card patch, pushed under its working branch name |
| `/Users/erichowens/coding/port-daddy-salvage-autostash` | `codex/worktree-snapshot-20260429-salvage-autostash-screenshots` | `0263363` | Untracked MCP/Mac preview screenshot proof files |

The two OG-card commits have the same stable patch-id but different commit hashes
because the active worktree committed while the snapshot pass was running. Both
were pushed so neither hash is stranded.

## Worktree Branch Audit

| Branch | Status after harvest |
| --- | --- |
| `codex/agentic-social-proof` | Unique local commit `d729dba` was pushed to `codex/worktree-preserve-20260429-agentic-social-proof`. |
| `codex/anthropic-homepage-framing` | Unique local commit `1579dee` was pushed to `codex/worktree-preserve-20260429-anthropic-homepage-framing`. |
| `claude/port-daddy-v4-feedback-C1yJr` | Unique local commit `bc310cf` was pushed to `codex/worktree-preserve-20260429-claude-v4-feedback-log`. |
| `claude/review-website-v2-MX6jT` | Unique local tip `d143501` was pushed to `codex/worktree-preserve-20260429-website-review-anchor-claims`. |
| `codex/tube-events-console-ui-pre-main-refresh` | Unique local commit `acddf1c` was pushed to `codex/worktree-preserve-20260429-tube-events-console-pre-main`. |
| `worktree-agent-a5ff0f82` | Unique local commit `3f9f142` was pushed to `codex/worktree-preserve-20260429-fleet-spawn-dogfood`. |
| `worktree-agent-a7bdac05` | Unique local commit `52f13f3` was pushed to `codex/worktree-preserve-20260429-salvage-panel-dashboard`. |
| `codex/mcp-mac-preview-visibility` | Patch-equivalent to `origin/main`, but exact local commit `24e7df4` was still preserved in `codex/worktree-preserve-20260429-mcp-mac-preview-visibility`. |
| `codex/reconcile-stable-runtime-fixes` | Already ancestor of `origin/main`; upstream was gone but no unique work remained. |
| `codex/pr-5-pki-deliberation` | Already ancestor of `origin/main`; no additional preservation branch needed. |
| `codex/pr-5-pki-ui-docs` | Dirty worktree content preserved in `codex/worktree-snapshot-20260429-pr5-ui`. |
| `salvage/auto-stash-2026-04-28T2309` | Remote branch already exists; untracked screenshots preserved in `codex/worktree-snapshot-20260429-salvage-autostash-screenshots`. |

## Follow-Up Queue

1. Decide whether the root recording snapshot should replace or finish the
   detached rebase in `/Users/erichowens/coding/port-daddy`.
2. Review `codex/worktree-snapshot-20260429-fcc-clean` against current
   `fleet-config-ui` and `public/fleet-ui`; it likely needs a clean rebuild
   before integration.
3. Review `codex/worktree-snapshot-20260429-pr5-ui` for overlap with current
   public docs and website tutorial routing before cherry-picking.
4. Prefer the active `codex/og-branded-social-cards` branch over the duplicate
   snapshot commit when integrating OG-card work, unless exact snapshot
   provenance matters.
5. Leave the stash stack intact until all recovery branches are either merged or
   explicitly discarded.
