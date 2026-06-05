# Tube router — conversation multiplexer demo

![multiplexed tube router](./tube-router-multiplex.gif)

The `pd tube` → spawner router (`lib/tube-spawner-router.ts`) turns **one control
channel** into a conversation multiplexer (ADR-0046): a single external driver
(Codex) fans work out across **many backends**, fans the results back in, and is
**loop-guarded** at every gate.

This demo drives the **real** router code over an in-process fake tube; the
backends are simulated by an injected `spawn` so it is deterministic and free to
record, but every routing/refusal decision is the genuine router path.

```bash
bun demos/tube-router-multiplex/scenario.ts        # run it
vhs demos/tube-router-multiplex/multiplex.tape      # re-record the GIF
```

## What the GIF shows

| Act | What happens | Result |
|-----|--------------|--------|
| ⓪ Codex ⇄ Claude | a Codex driver pings, then hands a review task to a Claude agent | `router.pong`, then `router.spawned` |
| ① fan-out | Codex multiplexes 3 tasks to `ollama` / `gemini` / `claude-cli` on one channel | 3 agents complete; results fan back in |
| ② legit sub-delegation | a child spawn extends the lineage (depth 0 → 1) with a *new* task | allowed |
| ③ ping-pong blocked | a child re-issues the parent task, **reworded** — same structural shape | `router.refused` (loop guard) |
| ④ upward delegation blocked | a child tries to delegate back **up** to an ancestor | `router.refused` (re-entry) |

The ping-pong refusal is the load-bearing bit: the task is reworded, reordered,
and repunctuated, yet collapses to the **same fingerprint** — detection is
structural, not keyword matching.
