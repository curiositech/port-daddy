# Example Output: Destructive Action Policy Matrix

Scenario: a first pass at Agent Harbor's C5 governance gate. `git reset --hard` is nominally "blocked," but the fixture proving zero side effects was never run, no denial receipt or transcript event is wired up, and there's no safe alternative documented. A second row for the same action got miscategorized and mistiered while someone was mid-refactor. A `network` row is held for approval but has no pre-tool gate — meaning "approval" currently happens after the request already went out. And the report claims a same-UID debug shell is "contained." This is the "weak matrix" `policy_matrix_audit.mjs` is designed to catch.

## Weak matrix — input

```json
{
  "actions": [
    {
      "name": "git reset --hard",
      "category": "git",
      "tier": "block",
      "hasPreToolGate": true,
      "hasDenialReceipt": false,
      "emitsTranscriptEvent": false,
      "sideEffectFreeOnBlockFixture": false
    },
    {
      "name": "git reset --hard",
      "category": "vcs",
      "tier": "deny",
      "hasPreToolGate": true,
      "hasDenialReceipt": true,
      "emitsTranscriptEvent": true,
      "sideEffectFreeOnBlockFixture": true
    },
    {
      "name": "curl to internal metadata endpoint",
      "category": "network",
      "tier": "approve",
      "hasPreToolGate": false,
      "hasDenialReceipt": true,
      "emitsTranscriptEvent": true,
      "sideEffectFreeOnBlockFixture": true
    }
  ],
  "containmentClaim": {
    "sameUidBodyMarkedContained": true
  }
}
```

## Weak matrix — audit result

```json
{
  "pass": false,
  "score": 12,
  "findings": [
    { "severity": "medium", "id": "duplicate-action-name", "message": "Action name \"git reset --hard\" appears 2 times in the matrix — only one policy can actually govern it." },
    { "severity": "critical", "id": "blocked-action-has-side-effects", "message": "Block-tier action \"git reset --hard\" does not prove sideEffectFreeOnBlockFixture — a denial fixture has not shown the action produces zero side effects when blocked." },
    { "severity": "critical", "id": "denial-without-receipt", "message": "Gated action \"git reset --hard\" (tier: block) has no denial receipt — a denial leaves no durable, machine-readable evidence." },
    { "severity": "critical", "id": "denial-without-transcript-event", "message": "Gated action \"git reset --hard\" (tier: block) does not emit a transcript event on denial — the operator/reviewer has no visible record." },
    { "severity": "critical", "id": "gated-action-no-safe-alternative", "message": "Block-tier action \"git reset --hard\" has no safeAlternative — denial offers no path forward." },
    { "severity": "high", "id": "unrecognized-category", "message": "Action \"git reset --hard\" has category \"vcs\", not one of: git, filesystem, network, shell, github." },
    { "severity": "high", "id": "unrecognized-tier", "message": "Action \"git reset --hard\" has tier \"deny\", not one of: block, approve, allow." },
    { "severity": "high", "id": "missing-pre-tool-gate", "message": "Gated action \"curl to internal metadata endpoint\" (tier: approve) has no pre-tool gate — enforcement can only happen after the action has already run." },
    { "severity": "critical", "id": "same-uid-marked-contained", "message": "containmentClaim.sameUidBodyMarkedContained is true. An unmanaged or same-UID body has no enforced isolation boundary and can never be truthfully marked contained." }
  ],
  "recommendations": [
    "Give each distinct action a unique name, or merge the duplicate entries into a single policy for \"git reset --hard\".",
    "Run the negative fixture for \"git reset --hard\" (e.g. destructive git in a dirty worktree) and prove the command is stopped before any side effect, then set sideEffectFreeOnBlockFixture: true.",
    "Emit a denial receipt for \"git reset --hard\" on every deny/hold decision (see references/denial-receipt-and-transcript-envelope.md).",
    "Record a transcript event for every denial of \"git reset --hard\" so it is visible in the live and historical session view.",
    "Document a safe alternative for \"git reset --hard\" (e.g. \"git reset --hard\" blocked -> offer \"git stash\" or a scoped \"git checkout -- <path>\") and set safeAlternative.",
    "Reclassify \"git reset --hard\" into one of the known categories, or extend the taxonomy deliberately in references/destructive-action-taxonomy.md.",
    "Reclassify \"git reset --hard\" into block, approve, or allow — there is no fourth tier.",
    "Wire \"curl to internal metadata endpoint\" into pre-tool enforcement so the gate fires before the side effect, not after.",
    "Remove the containment claim for this body, or move it behind a real isolation boundary (see sandboxed-adversarial-test-harness) before claiming containment."
  ]
}
```

## What fixing it actually looked like

1. **Removed the duplicate/mistiered row.** The second `git reset --hard` entry was a stale copy from a mid-refactor edit; deleted it and kept one row: `category: git`, `tier: block`.
2. **Ran the negative fixture.** Attempted `git reset --hard` in a dirty worktree through the real pre-tool gate, confirmed the working tree was untouched afterward, and set `sideEffectFreeOnBlockFixture: true`.
3. **Wired the denial receipt and transcript event** for the `git` block tier (see `references/denial-receipt-and-transcript-envelope.md` for the shape), then set both booleans to `true`.
4. **Documented a safe alternative**: `git stash push -m "<reason>"` or a scoped `git checkout -- <path>`.
5. **Moved the pre-tool gate earlier** for `curl to internal metadata endpoint` so the `approve` decision happens before the request leaves the process, not after — confirmed no request goes out while `held`.
6. **Removed the containment claim.** The debug shell is a same-UID, unmanaged process; the report now says so plainly instead of marking it `contained`.

## Fixed matrix — input

This is `examples/sample-input.json`, unmodified:

```json
{
  "actions": [
    {
      "name": "git reset --hard",
      "category": "git",
      "tier": "block",
      "hasPreToolGate": true,
      "hasDenialReceipt": true,
      "safeAlternative": "git stash push -m \"<reason>\" (or git checkout -- <path> for a scoped revert)",
      "emitsTranscriptEvent": true,
      "sideEffectFreeOnBlockFixture": true
    },
    {
      "name": "git clean -fd",
      "category": "git",
      "tier": "block",
      "hasPreToolGate": true,
      "hasDenialReceipt": true,
      "safeAlternative": "git clean -n (dry run) then remove specific untracked files by name",
      "emitsTranscriptEvent": true,
      "sideEffectFreeOnBlockFixture": true
    },
    {
      "name": "rm -rf outside worktree root",
      "category": "filesystem",
      "tier": "approve",
      "hasPreToolGate": true,
      "hasDenialReceipt": true,
      "emitsTranscriptEvent": true,
      "sideEffectFreeOnBlockFixture": true
    },
    {
      "name": "outbound fetch to a new host",
      "category": "network",
      "tier": "approve",
      "hasPreToolGate": true,
      "hasDenialReceipt": true,
      "emitsTranscriptEvent": true,
      "sideEffectFreeOnBlockFixture": true
    },
    {
      "name": "arbitrary shell exec from agent-authored string",
      "category": "shell",
      "tier": "block",
      "hasPreToolGate": true,
      "hasDenialReceipt": true,
      "safeAlternative": "Route through the allowlisted command runner with a fixed argv, no shell interpolation",
      "emitsTranscriptEvent": true,
      "sideEffectFreeOnBlockFixture": true
    },
    {
      "name": "gh pr comment",
      "category": "github",
      "tier": "allow",
      "hasPreToolGate": false,
      "hasDenialReceipt": false,
      "emitsTranscriptEvent": true,
      "sideEffectFreeOnBlockFixture": true
    }
  ],
  "containmentClaim": {
    "sameUidBodyMarkedContained": false
  }
}
```

## Fixed matrix — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Policy matrix meets the C5 bar: every action classified, every block proves zero side effects, every denial carries a receipt, transcript event, and (for blocks) a safe alternative."
  ]
}
```

Note that the `allow`-tier `gh pr comment` row has `hasPreToolGate: false` and `hasDenialReceipt: false` and still passes — those checks only apply to `block`/`approve` tiers. An `allow`-tier action is, by definition, not gated.
