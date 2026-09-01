# Role-Expansion Playbook: Promoting Existing Agents to Sole Owners

How to take an agent that "does a task" and make it *the* owner of a
concern. Worked against port-daddy's fleet, but the moves generalize.

## The promotion test

An agent is a sole owner when you can answer all five without hedging:

1. **Question**: what single question does it own? (telos as a question)
2. **Exclusivity**: which other agents' prompts mention this concern?
   (Answer must become: none — delete the overlaps.)
3. **Ledger**: where is its append-only, per-cycle record — and does
   an empty cycle still write an entry?
4. **State home**: where does run N+1 read what run N was monitoring?
5. **Escalation**: what wakes the human, and what merely logs?

## Port-daddy fleet, agent by agent

### test-hunter → Test Warden
- **Today**: fires on commits, opens `coverage-gap` issues. Stateless —
  re-derives the world every run; "gap" defined per-run.
- **Promotion**: owns "is the test suite getting stronger or weaker?"
  Ledger: per-cycle coverage snapshot note (`test-ledger:` prefix)
  with suite count, coverage %, delta vs last entry. State: trend
  memory means it can escalate *erosion* ("coverage fell 4 weeks
  straight") — invisible to the stateless version. Exclusivity: qa
  and tautology-sniffer keep *per-PR* test review; the Warden owns
  the *longitudinal* question. Delete suite-health language from
  their prompts.

### spark → sole owner of the idea ledger
- **Today**: paused; writes proposals to `.spark/ideas/` files.
- **Promotion**: owns "which proposed ideas have never been judged?"
  Its `.spark/ideas/` directory is already a private namespace —
  formalize: no other agent writes there. Ledger: each idea carries
  status (proposed → seen-by-cartographer → harvested/rejected), and
  spark's cycle entry counts unjudged ideas; >N unjudged for >7 days
  is an escalation (the idea pipeline is silting up — today nobody
  would notice).

### spider → sole owner of connection freshness
- **Today**: scheduled; writes syllogisms to `.spider/connections/`.
- **Promotion**: owns "are past syllogisms still true?" Add a re-audit
  pass: each cycle re-checks K oldest connections against current
  repo reality, marks stale ones. Ledger entry: new connections +
  re-audited + invalidated counts. A connection engine that never
  retracts is a rumor mill.

### gardener → already close; add the ledger
- **Today**: audits worktree cleanliness post-commit, opens/closes
  issues. Has exclusivity and escalation; lacks the mandatory ledger
  (CLEAN runs leave no durable trace) and trend state.
- **Promotion**: `garden-log:` note per run, CLEAN included. Trend:
  "untracked-file count rising for 5 runs" is a finding even when no
  single run crosses a threshold.

### cartographer → the strongest existing precedent
- Already singleton, scheduled, with a private output surface
  (`cartographer/INDEX.md` on its own branch) and exclusive scope
  (the roadmap map). Missing only the explicit per-cycle ledger
  discipline and an enforcement hook. When ADR-0041's monitor lands,
  register its obligation first — it's the most critical ship.

### officer-of-the-watch → the reference implementation
- Born as a sole owner. See `fleet/ships/officer-of-the-watch.md`.

## New roles this pattern unlocks (pick by gap, not by whimsy)

| Role | Owned question | Ledger surface |
|---|---|---|
| Quartermaster | "is spend on pace, and who's burning it?" | `cost-log:` notes per day |
| Purser | "do secrets/keys/tokens rotate on schedule?" | rotation ledger + Tier-3 page on expiry |
| Bosun | "are the daemon, supervisors, and tunnels healthy?" | attest results per cycle |
| Harbor pilot | "did every external webhook/bridge deliver?" | delivery-vs-received reconciliation |

## Anti-checklist (signs a promotion went wrong)

- Two ships' prompts both say "watch for X" → exclusivity failed.
- The ledger only records *interesting* cycles → silent ≠ healthy.
- The ship fixes what it finds → watcher and repairer fused; scope
  creep follows. Report; let repair be dispatched.
- Its memory is the prompt's context window → state home failed.
- Its obligation lives only in the prompt → enforcement failed; at
  minimum make the *next* cycle detect a missing entry.
