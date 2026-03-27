# Idea: `pd pheromone` CLI — Surface the Stigmergic Engine

**Date:** 2026-03-27
**Author:** Spark
**Estimated session effort:** 1 session
**Roadmap reference:** Appendix A2 (Pheromone Evaporation)

---

## The Idea

`lib/pheromone.ts` implements the full evaporation engine — it runs in the daemon, decays values every 60s, and reads/writes from `services`/`sessions`/`projects` metadata. But there's **no CLI and no API route**. The engine is running blind. Agents can't spray pheromones, can't sniff them, and the stigmergic coordination model is completely inaccessible.

Add:

```bash
pd pheromone spray <token> <key> <strength>    # e.g. pd pheromone spray myapp:auth confidence 0.85
pd pheromone sniff <token> [--key <key>]       # read current pheromone levels for a token
pd pheromone list                              # show all active pheromones (non-zero)
```

Plus an HTTP API: `POST /pheromone/spray`, `GET /pheromone/:token`.

## Why It Matters

Pheromones are the foundation for stigmergic merging (A3) and the adaptive Arbiter (A1). Right now both of those are blocked on having a usable pheromone interface. Exposing the engine takes ~2 hours and immediately unlocks the highest-leverage coordination primitive in the V4 plan.

## Implementation Sketch

1. **`routes/pheromone.ts`** — `POST /pheromone/spray` (writes to service/session metadata), `GET /pheromone/:token` (reads + returns all keys), `GET /pheromone` (lists all non-zero pheromones across entities).
2. **`cli/commands/pheromone.ts`** — `spray`, `sniff`, `list` subcommands.
3. Wire into `routes/index.ts` and `bin/port-daddy-cli.ts`.
4. Add to completions (bash/zsh/fish).
5. Unit tests: spray → evaporate → check decay.

The pheromone engine itself needs **zero changes** — it just needs to be called.
