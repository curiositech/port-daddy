# Agentic Coding UX Flow Spec

## Intent

[The operator intent this flow should satisfy.]

## Audience And Context

- Audience: [who is using it]
- Starting surface: [editor / terminal / FleetBar / dashboard / PR / mobile]
- Existing context: [repo, branch, selected files, issue, PR, tests, session]

## Flow Steps

| Step | Operator Action | System Action | Visible Progress | Rollback | Receipt |
| --- | --- | --- | --- | --- | --- |
| 1 | [action] | [agent/system work] | [what changes on screen] | [undo path] | [durable artifact] |

## Controls

- Invoke: [icon/menu/command]
- Scope: [segmented control or menu]
- Human gate: [where approval is required]
- Stop/rollback: [how the operator halts or reverts]

## Magic Progression Score

Run:

```bash
node skills/agentic-coding-ux-designer/scripts/magic_progression_score.mjs --input flow.json
```

Paste the JSON report and address recommendations before shipping.

## Visual Proof

- [screenshot]
- [GIF or recording]
- [test/harness output]
