# Skill Governance Audit

Date: 2026-04-26
Session: `session-a7366433-5e18-4deb-b78a-561b77163e23`

## Findings

- The installed `port-daddy-agent-skill` skill and the workgroup `port-daddy` skill were older than the repo skill and did not teach the live Navigator/Cartographer actor workflow.
- The repo and installed user `port-daddy-agent-skill` skills are now identical. The workgroup `port-daddy` skill was materially different before merge: 409 lines versus the repo/user 729-line runbook, with a 546-line body diff, a 755-line API-reference diff, and a 49-line SDK-reference diff.
- The repo has 109 visible `SKILL.md` surfaces under `skills/` and `.codex/skills/`.
- The deterministic audit found 70 skill surfaces missing at least one of `license`, `allowed-tools`, or `metadata`.
- Many nonconforming entries are imported paper/research skills or generated skill-library material. They should not be blindly rewritten as if they were first-party Port Daddy runtime skills.
- The immediate operator bug is the Port Daddy skill itself: roadmap/what-next answers could read stale `.cartographer/status.md` prose without consulting `pd actor cartographer`, `pd actor navigator --inbox*`, or Lookout.

## Changes Made In This Slice

- `skills/port-daddy-agent-skill/SKILL.md` now has first-party metadata and a concrete actor-truth workflow.
- `skills/port-daddy-agent-skill/SKILL.md` now distinguishes ambient peer coordination from forced agent chatter.
- `skills/port-daddy-agent-skill/SKILL.md`, `AGENTS.md`, and `pd-fleet.yml` now require goal/invariant-level inconsistency detection, not only bug detection.
- `skills/port-daddy-agent-skill/CHANGELOG.md` now records skill-surface mutations.
- `tests/unit/port-daddy-skill-authority.test.js` now prevents the Port Daddy skill from dropping metadata or the actor consultation path.
- `AGENTS.md` now records the same ambient collaboration rule for all repo agents.
- A worktree-scoped `coordination:inconsistency` channel and tuple `6213` record the operator-worthy callout policy for live coordination tooling.
- `scripts/audit-skills.mjs` now scans every visible repo skill and emits JSON or Markdown governance findings.
- `tests/unit/skill-governance-audit.test.js` verifies the audit sees the Port Daddy skill as first-party/governance-complete and keeps imported literature out of first-party mutation targets.
- `/Users/erichowens/coding/workgroup-ai/skills/port-daddy/` now carries an adapted merge of the validated Port Daddy skill: the workgroup package name is preserved, the runbook body is current, the changelog records the merge, and references are mirrored from the repo skill.
- Fleet Control Center now has a first-class project callout for `coordination:inconsistency` channel messages. Before this slice, the UI used actors/channels/tuples/graph/memory generically but did not visually elevate the new coordination policy.

## Governance Rules Going Forward

- Treat first-party skill edits as release-surface edits: update the skill, references, tests, changelog, and mirrors in the same slice.
- Ask Navigator for roadmap/recovery truth and Lookout for docs/API/skill drift through `pd actor`, but do not treat queued actor mail as an immediate answer.
- Do not force constant peer chat. Agents should publish structured facts; durable actors/watchers should escalate material inconsistencies.
- Material inconsistencies include implied-goal drift: security/auth/privacy/trust-boundary/API-shape mismatches, public product-language contradictions, and work that violates a strong inferred operator goal even when locally bug-free.
- Stage bulk skill cleanup by classifying each skill as first-party, imported/read-only, generated, or installed mirror before mutation.
- Add or refresh `agents/openai.yaml` only for skills intended to be browsed, chipped, synced, or distributed beyond a local draft.

## Next Skill Slices

1. Normalize first-party Port Daddy skills first: `port-daddy-agent-skill`, `skill-architect`, `next-move`, `jury_rig-*`, and any Fleet/actor lifecycle skills.
2. Keep imported literature skills read-only until explicitly opted into structural mutation.
3. Add a native FleetBar popover alert for `coordination:inconsistency` if operator-worthy warnings should be visible before opening the embedded web control plane.
4. Add `agents/openai.yaml` or mirror metadata only after deciding which skills are distribution surfaces.
