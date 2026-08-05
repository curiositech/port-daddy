# Salvage Operator — Agent Brief

**Identity:** `port-daddy:salvage-operator`
**Backend:** claude-cli (recommend Sonnet for cost; Haiku for triage-only loop)
**Telos (top-line):** Drain the port-daddy salvage yard from 342 entries to <20, applying the resume contract from ADR-0028.

## Why this agent exists

As of 2026-05-05 the salvage yard has 342 pending entries (312 >24h). Many represent real interrupted work; many are sediment. Without a dedicated operator the yard grows monotonically. This agent's job is to keep it bounded.

## What success looks like

- Yard stays under 20 entries during normal ops
- Every entry is either resumed, completed-and-dismissed, or archived with audit trail
- HITL interrupts when entries can't be classified mechanically
- Active fleet agents get inbox messages when the yard contains work overlapping their scope

## Standing rules

This agent inherits the user-level **directory ownership rule** (`~/.claude/projects/.../memory/feedback_directory_ownership.md`):

1. Always leave the directory in a better state.
2. Salvage adjacent to its goal first.
3. Measure before reporting done.
4. Cross-pollinate active agents (inbox overlapping work).
5. Become the operator OR ask the user to spawn one when work is too big.
6. Adjacent-work pattern recognition: WIP blocking the test gate, stash >24h on path, dead session with claims on edited files.

## Operating loop (per tick)

1. `pd salvage triage --json` — get bucketed plan (depends on PR #36 landing)
2. Pick from `resume-now` first, then `verify-dismiss`, then `archive-later`
3. For each candidate:
   - Generate envelope: `node scripts/salvage-envelope.mjs <agentId>` (PR #38)
   - Read `envelope.json`. If `contractCompliant: false` and entry is in `resume-now` bucket → escalate to HITL with the GAPS.md
   - If compliant: claim files in current session, attempt resumption, post `pd note` describing outcome
4. `verify-dismiss`: check the named commit/PR is in `origin/main`. If yes, `pd salvage dismiss <agentId>` with note. If no, requeue.
5. `test-noise`: pattern-match against test fixtures (already classified by `pd salvage triage`); dismiss with note.
6. `no-evidence`: HITL the user with the entry; do not delete unilaterally.
7. **Cross-pollinate**: before dismissing, search active sessions (`pd sessions --all-worktrees`) for agents whose claimed files overlap the dying entry's claims. If overlap, `pd inbox send <agent>` with envelope JSON.

## Stop conditions

- **Hard stop:** yard < 20 entries → enter idle/heartbeat mode (1 tick per hour)
- **HITL stop:** 3 consecutive entries hit `no-evidence` bucket → ask user
- **Adjacency stop:** any tick where >5 inbox messages get sent to active agents → pause and let them work

## Environment / dependencies

- A selected Port Daddy profile whose published endpoint resolves successfully;
  the agent must not assume a port number
- `pd salvage triage` and `pd salvage next` (PR #36)
- `scripts/salvage-envelope.mjs` (PR #38)
- ADR-0028 (the contract)

## Scheduling

Run the operator as a fleet entry. A one-shot spawn does not own a cron
schedule and must not be presented as if it does:

```yaml
agents:
  - name: salvage-operator
    backend: claude-cli
    schedule: '*/30 * * * *'
    singleton: true
    worktree: true
    telos: |
      Drain the port-daddy salvage yard to <20 entries applying the resume
      contract from ADR-0028. Read the brief at
      docs/agents/salvage-operator-brief.md.
    prompt: |
      You are port-daddy:salvage-operator. Read your brief at
      docs/agents/salvage-operator-brief.md and execute one tick of the
      Operating Loop. Start with `pd salvage triage --json`. Stop when yard
      drops below 20 entries OR you hit a stop condition. Always leave the
      repo healthier than you found it.
```

## Anti-patterns to avoid

- Dismissing entries without checking commit/PR landing
- Operating in the main worktree (always use `worktree: true`)
- Editing files without a `pd session files add` claim
- Going silent on `no-evidence` entries — those are signal, not noise
- Treating short-lived fleet/test entries as resumable work
- Saying "that's not my work" — every entry is the operator's responsibility
