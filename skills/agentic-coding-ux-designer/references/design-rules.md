# Design Rules For AI Coding Apps

Use this when critiquing or specifying a screen.

## Required States

- empty state with real work entrypoints
- context captured / context missing
- planning
- running command
- editing files
- waiting for approval
- blocked
- canceled
- failed with recovery
- succeeded with receipt
- stale or orphaned background task

## Controls Users Expect

- pause / cancel / resume
- queue next message
- inspect command
- reject tool call
- accept/reject hunk
- revert checkpoint
- open changed file
- open PR or issue
- copy/share receipt
- change model or budget before launch

## Anti-Trust Signals

Flag the design if it:

- hides model, budget, or permissions
- hides what files are writable
- treats "agent says tests pass" as proof
- has no transcript or command log
- cannot explain what context was used
- lacks a durable handoff when the app closes
- launches multiple agents without showing ownership

## Flow Critique Template

For every proposed flow, answer:

1. What is the user's first gesture?
2. What context is captured automatically?
3. What does the agent declare before acting?
4. Where can the user interrupt?
5. Where is review cheapest?
6. What is the rollback primitive?
7. What receipt survives after the session?
