# Receipt Field Model

Use this when you need the canonical field-by-field meaning of a work receipt, a
filled example to copy from, or the reviewer-first ordering rule.

## The nine sections, in the order a reviewer should read them

Order matters. A receipt is not a database row; it is a document a human skims
under time pressure. Put the parts that let a reviewer say "no" fast near the
top and near the bottom, and put the parts that require deep reading in the
middle — reviewers give the middle the least attention (serial-position effect
applies to code review the same as it does to any list).

1. **identity** — agent, model, backend, sessionId, operator, worktree. Without
   this, nothing else is attributable. `backend` is the field that makes the
   receipt cross-tool: it is how a Codex run and a Claude Code run end up in
   the same table.
2. **intent** — goal, scope, stopCondition, nonGoals. `stopCondition` is the
   single highest-leverage field in the whole schema: "tests pass" is not a
   stop condition, "cargo test -p core bin_resolver:: exits 0" is. A vague
   stop condition is the earliest possible signal that a task will produce a
   weak receipt.
3. **risks** (read early, written last) — ranked worst-first. This is what the
   reviewer actually came for. See "Reviewer-first ordering" below.
4. **validation** — the proof. See `references/backend-normalization.md` for
   how to derive this from heterogeneous tool logs.
5. **actions** — commands with real exit codes, tool-call tallies, and a diff
   summary. This is evidence, not narrative — do not paraphrase a diff, cite
   it (`+142 -38 across 5 files`) and point at the real diff.
6. **contextUsed** — files read, rules applied (CLAUDE.md/AGENTS.md/ADRs),
   attachments, prior receipts this one chains from. This is what lets a
   reviewer catch "the agent used stale context" bugs after the fact.
7. **rollback** — a checkpoint (git sha, stash ref, snapshot id) plus the
   method to get back there, and whether that path was actually exercised.
8. **spend** — tokens, cost, wall clock, budget ceiling, turn count. Low
   ceremony but critical for operators tracking a fleet's burn rate.
9. **provenance** — content hash at minimum; signature and signer identity
   when attributability must survive the chat session closing (see
   `references/backend-normalization.md`, "Signing and attributability").

## Reviewer-first ordering rule

A receipt's job is to **reduce** reviewer labor, not document the agent's
internal monologue. Concretely:

- `risks[]` MUST be sorted `critical > high > medium > low`. The first element
  is the first thing anyone reads after the goal line. If nothing is
  `critical` or `high`, say so explicitly rather than omitting the field.
- Exactly one risk (usually the top one) should carry `checkFirst: true` when
  severity is `high` or above. This is a pointer, not a summary — it tells
  automation and humans alike where to start, instead of making them re-derive
  severity ranking themselves.
- Never bury a `critical` risk under an "additional notes" prose section. If a
  finding is worth writing in prose, it is worth a `risks[]` entry with a
  severity.
- A receipt with zero risks on a nontrivial change (more than a few lines, or
  touching validated/security-relevant surfaces) is more suspicious than
  reassuring. Absence of risk should be a stated conclusion ("scope was small
  enough that no residual risk was found"), not a silent empty array.

## Filled example (abbreviated)

```json
{
  "identity": {
    "agent": "implementer",
    "model": "claude-sonnet-5",
    "backend": "claude-code",
    "sessionId": "sess-9f2a"
  },
  "intent": {
    "goal": "Add launchd PATH discovery fallback so pd install finds claude/codex/aider binaries.",
    "scope": ["core/src/install/bin_resolver.rs"],
    "stopCondition": "cargo test -p port-daddy-core bin_resolver:: exits 0."
  },
  "risks": [
    {
      "description": "Fallback only probes Homebrew paths; asdf/nvm installs untested.",
      "severity": "high",
      "checkFirst": true
    }
  ],
  "validation": {
    "artifactBacked": true,
    "tests": [
      { "name": "bin_resolver::falls_back_when_path_missing", "exitCode": 0,
        "artifactPath": "artifacts/bin_resolver_test.log", "passed": true }
    ]
  },
  "actions": {
    "commands": [{ "cmd": "cargo test -p port-daddy-core bin_resolver::", "exitCode": 0 }],
    "filesChanged": { "added": [], "modified": ["core/src/install/bin_resolver.rs"],
      "deleted": [], "diffSummary": "+142 -18 across 2 files" }
  },
  "rollback": { "checkpoint": "a79dcd81", "method": "git-revert", "verified": true },
  "provenance": { "contentHash": "sha256:3fbb0a9e...", "signedBy": "claude-code:sess-9f2a" }
}
```

See `examples/expected-output.md` for the full, non-abbreviated receipt and
`schemas/work-receipt.schema.json` for the authoritative shape.

## What "reduces reviewer labor" actually means in practice

| Receipt trait | Labor added | Labor removed |
| --- | --- | --- |
| Full chat transcript pasted as the receipt | Reviewer reads N turns to find the 3 that matter | None |
| `risks[]` present, ranked, top one flagged `checkFirst` | None (30 seconds to read) | Reviewer skips re-deriving what to check |
| `validation.tests[].artifactPath` points at real captured output | 10 seconds to open a log | Reviewer does not need to re-run the suite to trust it |
| `actions.filesChanged.diffSummary` present | None | Reviewer decides "small, skim" vs "large, block time" before opening the diff |
| `rollback.checkpoint` present and `verified: true` | None | Reviewer does not have to ask "can we undo this" before approving |

If a field in the schema is not doing one of these two things for a specific
receipt, it is fine to omit it — but never omit a required field to save
writing time; that trades your five minutes for the reviewer's twenty.
