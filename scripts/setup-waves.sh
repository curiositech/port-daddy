#!/bin/bash
# Setup script for port-daddy-waves orchestration tree.
# Creates 13 worktrees (Wave 0..3), each with its own _meta/ runbook, _outputs/ drop-zone,
# and repo/ git worktree on a fresh sub-branch off research/empirical-closure.
#
# Idempotent: re-runnable. Skips already-existing branches/worktrees.
# Local-only: branches are NOT pushed to origin. Agents push when they have real commits.
#
# Drafted 2026-05-11 by Claude (Opus 4.7) for Erich Owens / Curiositech LLC.

set -euo pipefail

LAB_REPO="${LAB_REPO:-$HOME/coding/port-daddy}"
LAB_BRANCH="${LAB_BRANCH:-research/empirical-closure}"
WAVES_ROOT="${WAVES_ROOT:-$HOME/coding/port-daddy-waves}"

# Per-item spec: slug | branch | wave | item_n | title | primary_skill | secondary_skill | days | deps
# deps = comma-separated upstream item numbers that must merge before this can start ("" = none)
ITEMS=(
  "h-diagnostic|research/diag/nominal-state|0|H|H1-H7 nominal-state diagnostic|ci-status-checker|build-verification-expert|0.5|"
  "feat-voice-rule-ci|research/feat/voice-rule-ci|0|10|Voice-rule CI + byline drift fix|github-actions-pipeline-builder||0.5|"
  "feat-provenance-schema|research/feat/provenance-schema|1|2|Model provenance on notes/claims/spans|schema-evolution-manager|data-lineage-tracker|2|"
  "feat-tree-of-agents|research/feat/tree-of-agents|1|12|Tree-of-agents observability|observability-apm-expert|database-migration-manager|2|"
  "feat-pd-hitl-ask|research/feat/pd-hitl-ask|1|5|pd hitl ask primitive|human-gate-designer|agentic-zero-trust-security|2|"
  "feat-salvage-triage|research/feat/salvage-triage|1|6|Salvage triage UX|dimensional-modeler|data-quality-guardian|1|"
  "feat-frozen-substrate|research/feat/frozen-substrate|1|11|Frozen substrate mode|state-machine-designer|runtime-verification-for-agents|1.5|"
  "feat-pd-conservation|research/feat/pd-conservation|2|1|pd conservation runtime check|tlaplus-practitioner|runtime-verification-for-agents|1|H"
  "feat-claim-collision-handler|research/feat/claim-collision-handler|2|3|Mid-claim collision handler|semantic-conflict-prediction|event-driven-architecture-expert|3|11"
  "feat-decision-cost|research/feat/decision-cost|2|7|Decision-level cost attribution|cost-accrual-tracker|cost-verification-auditor|2|2"
  "feat-expressive-act|research/feat/expressive-act|2|9|Expressive-act classification|fipa-00037-communicative-act-library|prompt-engineer|2|2"
  "feat-pd-experiment|research/feat/pd-experiment|3|4|pd experiment primitive|feature-manifest|dag-replay-debugger|3|1,2,7"
  "feat-pd-route|research/feat/pd-route|3|8|pd route cheap-tier ensemble|llm-router|llm-cost-optimizer|3|2,5,11"
)

echo "=== port-daddy-waves setup ==="
echo "Lab repo:    $LAB_REPO"
echo "Lab branch:  $LAB_BRANCH"
echo "Waves root:  $WAVES_ROOT"
echo ""

cd "$LAB_REPO"
git fetch origin --quiet

# Make root + wave folders + shared _meta
mkdir -p "$WAVES_ROOT/_meta"
for w in 0 1 2 3; do mkdir -p "$WAVES_ROOT/wave${w}"; done

# ------------------------------------------------------------
# Root _meta files
# ------------------------------------------------------------

cat > "$WAVES_ROOT/_meta/AGENT-CONTRACT.md" <<'CONTRACT_EOF'
# Agent Contract — port-daddy-waves orchestration

Universal input/output contract for every agent assigned to a worktree under
`~/coding/port-daddy-waves/`. Per-item specifics live in each `_meta/RUNBOOK.md`.

## Universal inputs (every agent gets these)

- **Worktree** at `~/coding/port-daddy-waves/waveN/<slug>/repo` checked out on a
  sub-branch off `research/empirical-closure`.
- **RUNBOOK** at `../_meta/RUNBOOK.md` describing the specific item, scope, and
  deliverables.
- **Source-of-truth docs:**
  - `~/coding/port-daddy/docs/research/feature-requests-2026-05-07.md`
  - `~/coding/port-daddy/docs/research/hyperplan-2026-05-11.md`
- **Coordination Guard in enforce mode.** No bypass allowed.
- **Cost cap of $20** before HITL is required.

## Universal outputs (every agent must produce all of these)

| Artifact          | Path                         | Format                                 |
|-------------------|------------------------------|----------------------------------------|
| Pull Request      | github (curiositech/port-daddy) | Title `feat(#N): TITLE`, body links source-of-truth docs |
| Status updates    | `../_meta/STATUS.md`          | One of: NOT_STARTED, IN_PROGRESS, BLOCKED, READY_FOR_REVIEW, DONE |
| Final results     | `../_meta/RESULTS.md`         | Structured: pr url, tests, files changed, deviations |
| Artifacts         | `../_outputs/`                | Logs, screenshots, paper figure stubs  |
| Tests             | `repo/tests/unit/<file>.test.ts` | Cover every Measurable bullet from item |
| Feature manifest  | `repo/features.manifest.json` | New entry for any route/CLI/MCP tool   |
| CHANGELOG entry   | per CLAUDE.md protocol        | Category + version                     |
| pd note checkpoints | port-daddy db                | At start, mid-impl, tests-pass, PR-ready |
| pd done entry     | port-daddy db                 | Final outcome + PR url + remaining risks |

## Status state machine

```
NOT_STARTED → IN_PROGRESS → READY_FOR_REVIEW → DONE
                 ↓     ↑
              BLOCKED ──┘
```

## Wave gate protocol

- An agent CANNOT start until its wave is **OPEN** in `_meta/INDEX.md`.
- An agent CANNOT merge to `research/empirical-closure` until **auditor approves**.
- A wave CANNOT be declared complete until every agent in it is `DONE` AND
  post-wave gates pass (see `hyperplan-2026-05-11.md`).

## Forbidden behaviors

- Bypassing Coordination Guard (`PD_SHIM_OFF=1`, `--no-verify`, `--no-gpg-sign`).
- Editing files outside the declared scope.
- Committing to `research/empirical-closure` directly (always via PR).
- Writing to `/tmp` (CLAUDE.md user-level ban — use `git stash` or `~/.port-daddy/recovered/`).
- Spawning child agents without HITL approval.
- Using keyword-based NLP for any classification (CLAUDE.md global rule — use embeddings, BM25, or a Haiku call).
- Using emojis as UI icons in any new code (CLAUDE.md global rule — use SF Symbols / Lucide / SVG).

## How to harvest outputs across all worktrees

```bash
# Status board
for s in ~/coding/port-daddy-waves/wave*/*/_meta/STATUS.md; do
  echo "=== $s ==="; head -3 "$s"
done

# All open PRs by item
grep -l 'pr_url' ~/coding/port-daddy-waves/wave*/*/_meta/RESULTS.md

# All artifacts
find ~/coding/port-daddy-waves/wave*/*/_outputs -type f
```
CONTRACT_EOF

# ------------------------------------------------------------
# Loop over items
# ------------------------------------------------------------

INDEX_ROWS=""

for spec in "${ITEMS[@]}"; do
  IFS='|' read -r slug branch wave item_n title primary_skill secondary_skill days deps <<< "$spec"

  item_root="$WAVES_ROOT/wave${wave}/${slug}"
  meta="$item_root/_meta"
  outputs="$item_root/_outputs"
  repo="$item_root/repo"

  mkdir -p "$meta" "$outputs"

  # Create branch from origin/lab-branch (force-update to ensure parity)
  if ! git rev-parse --verify "$branch" >/dev/null 2>&1; then
    git branch "$branch" "origin/$LAB_BRANCH"
    echo "  + branch created: $branch"
  else
    echo "  = branch exists:  $branch (left as-is)"
  fi

  # Create worktree if absent
  if [ ! -d "$repo/.git" ] && [ ! -e "$repo/.git" ]; then
    if git worktree add "$repo" "$branch" >/dev/null 2>&1; then
      echo "  + worktree:       $repo"
    else
      echo "  ! worktree FAILED: $repo (already linked elsewhere?)"
    fi
  else
    echo "  = worktree exists: $repo"
  fi

  # ----- RUNBOOK.md (item-specific) -----
  secondary_block=""
  if [ -n "$secondary_skill" ]; then
    secondary_block="**Secondary skill:** \`${secondary_skill}\` · "
  fi

  deps_block=""
  if [ -n "$deps" ]; then
    deps_block="**Upstream dependencies (must merge to lab branch first):** items ${deps}"
  else
    deps_block="**Upstream dependencies:** none — safe to start once wave opens"
  fi

  cat > "$meta/RUNBOOK.md" <<RUNBOOK_EOF
# RUNBOOK — feat #${item_n}: ${title}

**Wave:** ${wave} · **Branch:** \`${branch}\` · **Slug:** \`${slug}\` · **Estimate:** ${days} working days
**Primary skill:** \`${primary_skill}\` · ${secondary_block}**Worktree:** \`${repo}\`

${deps_block}

---

## ROLE

You are the \`${primary_skill}\` agent for feature request #${item_n}: **${title}**.

## SOURCE OF TRUTH (read in order before acting)

1. \`~/coding/port-daddy/docs/research/feature-requests-2026-05-07.md\` — find item **#${item_n}** and read its full SMART block (Specific / Measurable / Achievable / Relevant / Time-bound / Risks). That is the canonical spec.
2. \`~/coding/port-daddy/docs/research/hyperplan-2026-05-11.md\` — read the **Wave ${wave}** section to understand what depends on you and what you depend on.
3. \`~/coding/port-daddy-waves/_meta/AGENT-CONTRACT.md\` — universal I/O contract.

## YOUR INPUTS

- **Working directory:** \`${repo}\`
- **Branch:** \`${branch}\` (already created off \`origin/${LAB_BRANCH}\`)
- **Auth available:** claude-cli, ollama. Codex / Cloudflare Workers / Gemini auth — check \`../_outputs/AUTH-STATE.md\` if present; otherwise assume not wired and ask via HITL.
- **Cost cap before HITL:** \$20 of LLM spend.
- **Allowed scope:** see \"SCOPE\" below; refer to feature-requests doc item #${item_n} for the deliverable list.
- **Forbidden surface:** \`lib/db.ts\` core schema (shared, additive-only via migration files); other agents' branches; the .tex whitepapers (handled by item #10's voice-rule CI).

## SCOPE

- Read the feature-requests doc item #${item_n} for the explicit deliverable list.
- Migrations are **additive-only**. They must run cleanly on a copy of the production DB (250 corpses present).
- Touch only files declared in your deliverables. If you need to touch something else, stop and HITL-ask.

## QUALITY GATES (must all pass before declaring DONE)

- \`npm test -- --runInBand\` — full suite green.
- \`tsc --noEmit\` AND \`npx vite build\` — both green (esbuild catches JSX errors tsc misses; per CLAUDE.md feedback memory).
- \`pd guard check --staged\` — pass before every commit.
- voice-rule CI green (after item #10 lands; until then, manually verify no forbidden phrases in your output).
- New tests cover every Measurable bullet from the source doc.
- No new telemetry-loss spans introduced.
- Auditor PR review approved.

## COORDINATION CONTRACT (CLAUDE.md mandates this in port-daddy repo)

Always inside the worktree:

\`\`\`bash
cd ${repo}
pd begin --identity port-daddy:research:feat-${slug} --purpose "#${item_n} ${title}"
\`\`\`

Then for every edit:

\`\`\`bash
pd session files add <path>
# edit
git -c commit.gpgsign=false commit -m "..."
\`\`\`

Note at every checkpoint (start, mid-impl, tests-pass, PR-ready):

\`\`\`bash
pd note "<status>"
\`\`\`

When done:

\`\`\`bash
pd done "#${item_n} ${title} shipped. PR: <url>. Validation: <evidence>. Remaining: <risk>."
\`\`\`

**NEVER** bypass with \`PD_SHIM_OFF=1\`, \`--no-verify\`, or \`--no-gpg-sign\`.

## HITL TRIGGERS (use \`pd hitl ask\` once item #5 lands; until then, halt and write to \`../_meta/STATUS.md\` with status BLOCKED + reason)

Stop and ask the human if:

- Scope must grow beyond declared deliverables.
- Cost projection exceeds \$20.
- Test failures you can't resolve in one cycle.
- Coordination collision with another active sub-branch.
- Auth needed that isn't documented.

## YOUR OUTPUTS (you must produce ALL of these)

1. **PR** opened against \`research/empirical-closure\`:
   - Title: \`feat(#${item_n}): ${title}\`
   - Body: links to feature-requests doc + hyperplan; summary; test results; screenshots if UI.
2. **New files** at the paths declared in deliverables.
3. **Modified files** — list in the PR body.
4. **Tests** in \`tests/unit/<file>.test.ts\` (and integration if needed).
5. **Feature-manifest entry** — for any new route / CLI / MCP tool.
6. **CHANGELOG entry** per CLAUDE.md changelog protocol (category + version).
7. **Doc updates** — README.md and any relevant docs/ entry.
8. **Update \`../_meta/STATUS.md\`** at every checkpoint.
9. **Fill \`../_meta/RESULTS.md\`** when complete with: PR url, test summary, files changed, deviations from plan, new memory entries needed.
10. **Drop noteworthy artifacts in \`../_outputs/\`** — logs, screenshots, paper figure stubs.

## STATUS TEMPLATE

Update \`../_meta/STATUS.md\` to one of:

- \`NOT_STARTED\` (initial)
- \`IN_PROGRESS — phase: <prompt-read|impl|tests|pr|review>\`
- \`BLOCKED — reason: <explanation>; needs: <human|other-agent|auth>\`
- \`READY_FOR_REVIEW — pr: <url>\`
- \`DONE — pr: <url>; merged_at: <iso>\`

## RESULTS TEMPLATE (fill when DONE)

\`\`\`yaml
item: ${item_n}
title: "${title}"
branch: ${branch}
pr_url: ""
merged_at: ""
test_summary:
  total: 0
  passed: 0
  new: 0
files_changed: []
deviations: []
memory_entries_needed: []
followups: []
\`\`\`
RUNBOOK_EOF

  # ----- STATUS.md (initial state) -----
  cat > "$meta/STATUS.md" <<STATUS_EOF
# STATUS — #${item_n} ${title}

**Status:** NOT_STARTED
**Wave:** ${wave}
**Owner:** unassigned
**Last update:** $(date -u +%Y-%m-%dT%H:%M:%SZ)

---

(Agent: keep this file updated at every checkpoint. See ../_meta/AGENT-CONTRACT.md for the state machine.)
STATUS_EOF

  # ----- RESULTS.md (skeleton, agent fills at DONE) -----
  cat > "$meta/RESULTS.md" <<RESULTS_EOF
# RESULTS — #${item_n} ${title}

(Agent: fill this when status reaches DONE. Use the YAML block from RUNBOOK.md "RESULTS TEMPLATE".)

\`\`\`yaml
item: ${item_n}
title: "${title}"
branch: ${branch}
pr_url: ""
merged_at: ""
test_summary:
  total: 0
  passed: 0
  new: 0
files_changed: []
deviations: []
memory_entries_needed: []
followups: []
\`\`\`
RESULTS_EOF

  # ----- _outputs/.gitkeep (so dir is preserved before agent drops anything) -----
  : > "$outputs/.gitkeep"

  # Index row for the master tracker
  INDEX_ROWS+=$'\n'"| ${wave} | #${item_n} | ${title} | \`${slug}\` | \`${primary_skill}\` | ${days} | NOT_STARTED |"

done

# ------------------------------------------------------------
# INDEX.md (master tracker, last so all per-item dirs exist)
# ------------------------------------------------------------

cat > "$WAVES_ROOT/_meta/INDEX.md" <<INDEX_EOF
# INDEX — port-daddy-waves orchestration tree

**Generated:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
**Lab branch:** \`${LAB_BRANCH}\`
**Source docs:**
- \`~/coding/port-daddy/docs/research/feature-requests-2026-05-07.md\`
- \`~/coding/port-daddy/docs/research/hyperplan-2026-05-11.md\`

## Wave gate state

| Wave | State  | Open after                                    |
|------|--------|-----------------------------------------------|
| 0    | OPEN   | (initial)                                     |
| 1    | CLOSED | Wave 0 gates pass                             |
| 2    | CLOSED | All Wave 1 PRs merged + post-wave gates pass  |
| 3    | CLOSED | All Wave 2 PRs merged + post-wave gates pass  |

(Update the State column to \`OPEN\` as gates pass. Agents check this before starting.)

## Items (13 total)

| Wave | # | Title | Slug | Primary Skill | Days | Status |
|------|---|-------|------|---------------|------|--------|${INDEX_ROWS}

## How to spawn an agent for an item

1. Confirm the wave is OPEN in the table above.
2. \`cd ~/coding/port-daddy-waves/wave<N>/<slug>/repo\`
3. Read \`../_meta/RUNBOOK.md\` (item-specific spine).
4. Read \`~/coding/port-daddy-waves/_meta/AGENT-CONTRACT.md\` (universal contract).
5. Begin per the RUNBOOK's COORDINATION CONTRACT section.

## How to harvest outputs across all 13 items

\`\`\`bash
# Status board
for s in ~/coding/port-daddy-waves/wave*/*/_meta/STATUS.md; do
  echo "--- \$s ---"; head -5 "\$s"; echo
done

# Final results once items hit DONE
find ~/coding/port-daddy-waves -name RESULTS.md | xargs -I{} sh -c 'echo "=== {} ==="; cat {}'

# Artifacts dropped by agents
find ~/coding/port-daddy-waves/wave*/*/_outputs -type f -not -name .gitkeep
\`\`\`
INDEX_EOF

echo ""
echo "=== Setup complete ==="
echo "Tree at: $WAVES_ROOT"
echo "Index:   $WAVES_ROOT/_meta/INDEX.md"
echo ""
echo "Quick verify:"
echo "  ls $WAVES_ROOT"
echo "  cat $WAVES_ROOT/_meta/INDEX.md"
echo "  cat $WAVES_ROOT/wave0/h-diagnostic/_meta/RUNBOOK.md"
