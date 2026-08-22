# 0122. Merge authority reconciliation — five paths, one audit

## Status

Proposed (2026-08-22) · Amends ADR-0109

- **Roadmap:** `merge-authority-reconciliation`

## Context

Who approves and merges is answered differently by every surface that speaks:

- **ADR-0109** (the Steward, renumbered from the 0056 tombstone) designs a
  single agent approver owning the PR lifecycle open→merged, enforced by an
  attenuated land-to-main macaroon (ADR-0053) — which never landed. The
  Steward's authority is prose plus a `Bash(gh*)` allowlist.
- **The enforced ruleset** (`docs/operator/branch-protection-ruleset.md`,
  id 17604542) requires **zero approving reviews**. The gates that exist are
  18 required contexts, required review-thread resolution, and the merge
  queue. The adversarial-review verdict is deliberately not required.
- **AGENTS.md** (§ Pull Request Operating Procedure) tells *every* agent to
  drive its own PR to merge with `gh pr merge --auto` — the exact disease
  ADR-0109 diagnosed, and a direct contradiction of the Steward charter's
  no-`--auto`-on-code-PRs rule (learned on #385). The contradiction is
  mirrored into `skills/port-daddy-internal-dev/SKILL.md`.
- **Three autonomous merge paths already run** with no human in the loop:
  `release-train.yml`'s version-bump self-merge, `lib/dispatch/auto-merge.ts`
  under its 4-condition gate + never-list, and `lib/harbormaster.ts` after an
  operator `pd review --accept`.
- The Steward's own charter (`fleet/ships/steward.md`, `pd-fleet.yml`) cites
  the dead ADR-0056 stub as its constitution.
- `qa`'s blocking flag disagrees between `pd-fleet.yml` (`blocking: true`)
  and the fleet-executor default (`blocking: false`).

With Helmsman (ADR-0121) adding a fourth autonomous path (H2 bounded
auto-merge), the ambiguity stops being tolerable.

## Decision

### The five authorized landing paths — exhaustively

1. **The operator**, directly.
2. **The Steward**, per its charter (re-pointed from the ADR-0056 tombstone to
   this ADR + ADR-0109): no `--auto` on code PRs; Copilot pass + green + zero
   unaddressed threads, then `gh pr merge --squash`; docs-only may `--auto`.
3. **`release-train.yml`** merging its own version-bump PR on green.
4. **`lib/dispatch/auto-merge.ts`** under `merge_policy='auto'`: open ∧ all
   required checks green ∧ `MERGEABLE` ∧ zero unresolved threads, plus its
   never-list (no force-push, no draft, no `--admin`, no `--auto`). This gate
   is the **single shared definition of "bounded auto-merge"** — Helmsman H2's
   classes are exactly this gate's, never a parallel definition.
5. **`lib/harbormaster.ts`** after an operator `pd review --accept` (two-key:
   dispatch `accepted` ∧ merge-queue `queued`; never operator-authored PRs).

Nothing else lands to main. **Agents author PRs and get them green; landing
belongs to the authorized paths.** The human admin bypass valve remains, and
remains human-only.

### Doctrine edits (same slice as this ADR's implementation)

- **AGENTS.md** § Pull Request Operating Procedure: replace the
  "every agent drives its own PR to merge with `--auto`" text with the
  authorized-paths rule above. Mirror the same edit in
  `skills/port-daddy-internal-dev/SKILL.md` (both occurrences).
- **Steward charter**: `fleet/ships/steward.md` and `pd-fleet.yml` re-cite
  ADR-0109 + this ADR instead of the 0056 tombstone.
- **`qa` blocking flag**: the fleet-executor default (`blocking: false`) wins;
  `pd-fleet.yml` is corrected to match. Blocking ships remain `code-reviewer`
  and `red-team`.

### The detective control (instead of the macaroon)

A scheduled `merge-audit` workflow lists recently merged PRs and checks
`merged_by` + merge path against the allowlist above; any violation files a
deduped `fleet:broken-ship` finding. Preventive enforcement (the ADR-0053
macaroon) stays an honest, named backlog item — building it now would repeat
the built-tested-unwired pattern the binder audit documented; the audit trail
this control produces is the evidence that will justify (or retire) it.

## Consequences

### Positive

- One written, checkable answer to "who may merge," aligned with what the
  ruleset actually enforces.
- Helmsman H2 and every future autonomous path share one bounded-merge
  definition and one audit.
- The Steward stops being governed by a tombstone.

### Negative

- Enforcement is detective, not preventive: a misbehaving agent can still
  physically merge and be caught after the fact. Accepted and named.
- AGENTS.md edits touch doctrine many agents have memorized; the transition
  window may produce confused sessions until the mirrors sync.

## Rejected alternatives

- **Build the ADR-0053 macaroon now.** Three months un-landed; a preventive
  cryptographic gate with no callers is the pattern this program is escaping.
- **Require ≥1 approving review in the ruleset.** Blocks the three working
  autonomous paths and the merge queue's throughput for a control the Steward
  design never asked for.
- **Let each autonomous path define its own merge gate.** Divergent
  "bounded" definitions are how #385-class incidents recur.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| P0 | merge-authority-reconciliation | now | — | This ADR + AGENTS.md/skill/steward-charter/qa-flag edits |
| P1 | merge-audit-detective-check | backlog | merge-authority-reconciliation | Scheduled merged_by + merge-path allowlist audit filing fleet:broken-ship findings |

## References

- ADR-0109 (amended), ADR-0053 (deferred enforcement), ADR-0121
- `docs/operator/branch-protection-ruleset.md`, `fleet/ships/steward.md`,
  `lib/dispatch/auto-merge.ts`, `lib/harbormaster.ts`,
  `.github/workflows/release-train.yml`
