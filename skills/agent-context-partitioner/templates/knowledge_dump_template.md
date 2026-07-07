# Knowledge Dump — {{agent_id}}

> Trigger: {{trigger}}  
> Session: {{session_id}}  
> Tokens: {{tokens_used}} / {{token_window}} ({{pressure_fraction_pct}}%)  
> Velocity: ~{{velocity_tok_per_min}} tok/min  
> Time: {{timestamp}}

---

## Current Task

{{current_task_one_sentence}}

---

## Task State

### Completed (do not redo)
{{#each completed}}
- {{this}}
{{/each}}

### In Progress (pick these up first)
{{#each in_progress}}
- {{this}}
{{/each}}

### Blocked
{{#each blocked}}
- **{{task}}**: {{reason}}
{{/each}}

### Remaining (after in-progress)
{{#each remaining}}
- {{this}}
{{/each}}

---

## Open Questions

*Things I could not resolve. Investigate before proceeding.*

{{#each open_questions}}
{{@index_plus_1}}. {{this}}
{{/each}}

---

## Key Decisions Made This Session

*These are NOT in the code yet. You must not relitigate them.*

{{#each key_decisions}}
**{{decision}}**  
Rationale: {{rationale}}  
{{#if alternatives_rejected}}Rejected: {{join alternatives_rejected ", "}}{{/if}}

{{/each}}

---

## Files

**Modified/created:**
{{#each files_touched}}
- `{{this}}`
{{/each}}

**Read for background context (re-read before proceeding):**
{{#each files_read_for_context}}
- `{{this}}`
{{/each}}

---

## Semantic Context

*What I know that isn't in the files or git log. Write this like you're briefing a peer engineer joining mid-task.*

{{semantic_context}}

---

## Constraints Discovered

*Surprises. The next agent MUST respect these or will break things.*

{{#each constraints_discovered}}
- {{this}}
{{/each}}

---

## Handoff Instructions

**Do this first:**
{{handoff_first_action}}

**Do NOT:**
{{handoff_do_not}}

**Will trip you up:**
{{handoff_gotchas}}

---

## Successor Context Seeds

*Load these into your context before starting work.*

{{#each successor_context_seeds}}
- **{{type}}**: `{{value}}` — {{reason}}
{{/each}}

---

*Written by `{{agent_id}}` under {{trigger}} trigger. Posted to Port Daddy note {{note_id}}.*
