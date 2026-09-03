# Machine instruction parity: source is not installation

The repository's delivery instructions were corrected, but the inspected machine still had older guides, five older Pilot definitions, and four public-skill links resolving to one development worktree. Merging a prompt does not update those installations. The next repair needs explicit source selection and preservation of user-authored content, not another broad setup run.

This is a **dated evidence reference**, not an installer, a live inventory, or roadmap authority. Machine observations were recorded on **2026-09-02 America/Los_Angeles** in local session note **24115**; the repair proposal is note **24157**. Source inspection was refreshed at `4c5a7a06f73711468d9cd7142e04ada1de4c51a3`. Home paths below use `~` for the inspected operator's home, not a command to execute or a claim about every user's machine.

## What was delivered, and what was not

[PR #10025](https://github.com/curiositech/port-daddy/pull/10025) delivered source head `4083549f21cc4d717d612305b4a0e09a28f655da`, tree `1cf111ab474e8b11acc2429fdea73437570cb133`. GitHub reported its protected merge at **2026-09-03 01:57:30 UTC**, merge `f440532a43243f0ac980a57115dec2c0ee74c03e`. Independent review passed 125 focused tests. This is source/review evidence, not proof of installed guides or live harness activation. The known neutral hosted Fleet skip was paired with independently recorded Admiral review; it was not a Cloud Fleet run.

The **public agent skill** ([PR Finish Line](../../skills/port-daddy-agent-skill/SKILL.md#pr-finish-line)) defines delivery through attributable commits, permitted App publication, gracious review responses, checks, protected queue and actual merge before session completion. The **internal contributor skill** ([source](../../skills/port-daddy-internal-dev/SKILL.md)) applies the repository-specific policy. The **Pilot** ([canonical prompt](../../agents/port-daddy-pilot/AGENT.md)) carries that operating contract into generated agent definitions.

Read-only GitHub inspection remains subject to repository/operator policy, including policies routing *all* access through a broker. It is distinct from publication; the correction does not permit personal-token writes. Existing identity conflicts must not be bypassed by clearing selectors. Third-party skill provenance is distinct from an obsolete runtime dependency.

The proof chain has separate stages:

`reviewed source → selected package/source → installed bytes → configured entrypoint → witnessed invocation`

This audit establishes selected observations at the first, third and declared-entrypoint stages. It does not establish a complete end-to-end chain. No machine guide, installed Pilot, skill link, hook configuration or runtime was changed by the inventory or this publication.

## Machine entrypoints observed

These are bounded findings, not copies of private user instructions. The original line references identify the observed versions; they are not stable anchors after repair.

| Entrypoint | Observed discrepancy | Preservation boundary / next action |
| --- | --- | --- |
| `~/AGENTS.md` | Lines 3–83 designate the retired WinDAGs runtime and a versioned Cellar source; 102–105 recommend its old installer. The current publication/review/merge loop is absent. | The footer identifies a historical generator, not present overwrite authority. Reconcile the runtime/installer passages while preserving the operator's work-directory rule and third-party provenance. |
| `~/.codex/AGENTS.md` | A symlink to `~/AGENTS.md`, inheriting the same discrepancy. | Preserve the link and repair its shared target once; do not create a competing copy. |
| `~/.claude/CLAUDE.md` | The loop at 119–126 ends at note/completion; 138 promotes the retired runtime; 397 contains an ambient add-all/commit/direct-main push example. | Mixed, user-curated content. Review only the implicated passages; preserve unrelated preferences and project guidance. A file mentioning Port Daddy is not thereby managed. |
| `~/.gemini/GEMINI.md` | A marked generated block at 6–19 forwards to the older system and guide, without the current delivery finish line. | Reconcile only that block and its shared-guide relationship. Preserve preceding user memory; unrelated process-control advice requires a separate review and is not reproduced here. |

The historical generator named by the shared guide was `/opt/homebrew/Cellar/windags/2.7.0/libexec/scripts/install.sh`. That path explains the observation; it is **not a recommended installer or runtime authority**. The audit did not execute it.

### Five installed Pilot targets

All five files were observed to exist with older instructions. These are five render targets, **not five independently tested running backends**. No personal GitHub publication command was found in these particular Pilot copies; the demonstrated issues were missing merge duties, retired runtime guidance, and selector-reset advice in three copies.

| Source-declared target | Installed path | Observed older behavior |
| --- | --- | --- |
| Claude Code | `~/.claude/agents/port-daddy-pilot.md` | Selector clearing at 39; completion before delivery at 73–76; retired runtime at 99–102. |
| Codex CLI | `~/.codex/agents/port-daddy-pilot.toml` | Selector clearing at 34; early completion at 71; retired runtime at 94–97. |
| Gemini CLI | `~/.gemini/commands/pd-pilot.toml` | Early completion at 68–71; retired runtime at 89–92. This copy lacked the particular selector-reset paragraph. |
| Gemini extension / Antigravity import source | `~/.gemini/extensions/port-daddy/commands/pd-pilot.toml` | Same older command text as Gemini. The extension path is declared import plumbing, not proof that Antigravity loaded it. |
| Generic agents | `~/.agents/agents/port-daddy-pilot.md` | Selector clearing at 37; early completion at 74; retired runtime at 97–100. Not evidence of Cursor-specific delivery. |

The **Pilot renderer** ([`pilotRenderTargets`, `installPilotAgents`](../../lib/pilot-agent-render.ts)) defines these exact paths and native formats. Its setup caller is [`installPilotAgentDefinitions`](../../cli/commands/setup.ts); the standalone entrypoint is [`scripts/install-pilot-agents.ts`](../../scripts/install-pilot-agents.ts). Their behavior, not an inferred package install, establishes the source-to-target map.

### Four skill links, one older source

These four installed **directories** were symlinks:

- `~/.claude/skills/port-daddy-agent-skill`
- `~/.codex/skills/port-daddy-agent-skill`
- `~/.agents/skills/port-daddy-agent-skill`
- `~/.gemini/extensions/port-daddy/skills/port-daddy-agent-skill`

Every link resolved to `~/coding/tmp/port-daddy-claimtree-suggestibility/skills/port-daddy-agent-skill`. The resolved `SKILL.md` SHA-256 was `5b23962eb1d17d517ce10d915f16bfbc1bea58ec03f808917b141d7730de48c1` for all four. Its default/operating loops (153–184 and 495–516) and finish line (369–393) lacked the newly explicit actual-merge completion boundary.

This is one shared older source, not four independent copies. The historical invocation that selected that worktree was **not proved**. Do not edit, delete or assume ownership of the target worktree. A repair should retarget only the exact reviewed links to an approved stable source, preserving prior targets for recovery.

[`resolveSkillSource` and `installSkillSymlinksAt`](../../cli/commands/setup.ts) are relevant installer candidates. Current setup also calls the **skill union synchronizer** ([`syncAgentSkills`](../../lib/skill-sync.ts)), which has explicit `sourceRoots` and `targets` options. Candidate producer code does not establish which historical invocation wrote a link.

### Hook configuration: declared paths, not content approval

[`cli/commands/hooks-install.ts`](../../cli/commands/hooks-install.ts) declares the user-level Claude settings, Codex config, Gemini settings and Antigravity hook files: `~/.claude/settings.json`, `~/.codex/config.toml`, `~/.gemini/settings.json`, and `~/.gemini/hooks.json`. Codex and Antigravity files received existence/metadata checks only. Config values were not read or published. Project-local settings are separate targets; this function does not establish a fifth generic-agent hook engine.

A subsequent scoped audit should inspect only managed command keys, redact values and compare packaged asset fingerprints against the **Squid asset resolver** ([source](../../lib/squid/assets.ts)) and [Pilot hook](../../hooks/sessionstart-pilot.mjs). Configuration presence is not execution. This report grants no hook trust, requests no restart and asserts no installed hook correctness.

## Source-level causes and smallest proposed repairs

The following are inspection findings at `4c5a7a06`, with proposed changes clearly separated. No installer implementation is included in this publication.

| Existing code / observed mechanism | Smallest proposed correction | Required regression proof |
| --- | --- | --- |
| `resolvePilotSourceDir` prefers the Homebrew share candidate over the checkout. The standalone installer accepts a target base and dry run, but chooses its source through that resolver. | Expose explicit reviewed-source selection and source/config fingerprints. Preserve intentional packaged defaults; an explicit source must not silently become an older package. | Old-package/new-checkout fixture, explicit source pin, missing or changed source, and zero-write dry run across all five real formats. |
| `installPilotAgents` and `removeGeneratedPilotFile` recognize replacement/cleanup eligibility through presence of the Pilot ID in existing text. | Replace this weak ownership signal with exact reviewed prior output, or a verified installation receipt. A one-time legacy repair needs exact prior-target fingerprints and customization review. No verified local installation manifest was established by this audit. | User-authored text containing the ID must survive; unknown source, modified target and stale cleanup candidates must not be overwritten or removed. |
| Installation writes targets separately, performs cleanup before each target write, and reports per-target errors. No transactional backup/read-back proof was found in this inspected path. | Preserve exact prior bytes/link targets in a private task-owned backup; bind preview to apply, verify each result and record partial failures truthfully. Do not claim all-target success from a partial result. | Changed parent/link, broken or redirected symlink, source/target drift after preview, partial I/O failure, recoverability and idempotent second apply. |
| Setup can perform broad skill-union synchronization; the library already accepts bounded roots/targets. | First determine whether an exact caller for the one public skill is sufficient. Keep existing tracked/sparse/nested-repository boundaries in [`skill-sync-git.ts`](../../lib/skill-sync-git.ts); do not sweep unrelated third-party skills. | Exact four-link repair, unchanged old target, unrelated targets untouched, tracked/sparse/repository positive and refusal controls. |

Existing test seams are [`pilot-agent-render.test.ts`](../../tests/unit/pilot-agent-render.test.ts), [`agent-skill-sync.test.js`](../../tests/unit/agent-skill-sync.test.js), and [`skill-sync-git.test.js`](../../tests/unit/skill-sync-git.test.js). The current Pilot cleanup fixtures do not cover user-authored content that merely contains the Pilot ID. The cases above are acceptance work for the next implementation, not tests claimed to pass in this audit. Use isolated fixtures under the operator-approved work directory; do not substitute real home/config/daemon state.

## Ordered delivery and ownership

1. **Publish this audit and its discoverability links.** Preserve the private originals and the historical [delivery census](2026-09-02-delivery-census.md). Do not silently update its older status observations.
2. **Repair bounded source selection and managed-file provenance.** Obtain current regional coordination for installer functions before editing. The earlier prompt-only acknowledgment does not cover installer code.
3. **Apply reviewed managed changes and curated patches separately.** Preview exact paths/content deltas, preserve backups and link identities, then read back each result. User-curated guides receive narrow reconciliations, not generated-file replacement.
4. **Witness each supported harness invocation.** Record which exact installed definition and hook asset ran, with source and installation fingerprints. Report untested backends explicitly.

At the proposal's ownership readback, `lib/pilot-agent-render.ts` remained claimed by the held egress session `session-finish-and-publish-canonical-app-only-agent-egre-2d1d9501c276`; `lib/skill-sync.ts` remained claimed by `session-update-pr-9965-from-review-comments-and-current-378aef4f0161`. Exact session reads reported active status. Those observations are routing evidence, not lease transfer or consent. The absent owner result for a script is not universal edit authority. Later work must refresh claims and consider concrete objections while preserving held worktrees.

This is partial work under existing programme `agent-delivery-merge-lifecycle-and-recovery`, ID `b7e446ea-7dcb-42fa-8b07-d8e2f8178718`. Its owner, status, prior notes and PR relationships remain unchanged except this publication's attributable evidence/link. Selected-daemon notes are local receipts, **not canonical Relay D1 authority**. Installer repair, curated-guide reconciliation, exact installation and runtime verification remain outstanding.

## Publication provenance and privacy

Inventory recorder: actor `01M1J8NHCZ4YXH0RAZCN3V42DQ`, session `session-align-repository-agent-delivery-instructions-acr-408f372820fd` (subsequently completed after #10025). Audit publisher: actor `01M1JGCDHB0H3M7JC974Y431H6`, session `session-publish-machine-instruction-provenance-audit-dc6e9ed74374`. These identify accountable agents, not hidden reasoning or authentication material.

The preserved private inventory fingerprint is `c6e910600051a3a5e7475b561ef817d0e7c11d889c4ab7bf698aa7915dce695f`; the next-wave proposal fingerprint is `0c3b8f0a2543eeeaeb221bb4b49cacbcea037fa326d959fa0b46df1ce4f81ad2`. Fingerprints identify original file bytes, not this sanitized derivative. The derivative omits raw guide bodies, user-memory text, hook values, credential contents and machine-specific absolute home paths. It preserves only the paths, bounded findings, source relationships, attribution and repair obligations needed to act safely.
