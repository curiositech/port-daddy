# Agent Coordination Sandbox — Research Cluster

**Date.** 2026-06-03
**Author identity.** `port-daddy:research:evolutionary-agent-coordination-sandbox` (Port Daddy session)
**Audience.** The operator (Erich) and any future agent who picks up the coordination-surface, transcript-ingestion, or visualization threads. A working software engineer with no prior multi-agent-systems coursework — terms of art are defined on first use within each note.
**Status.** Raw research notes. No code changes, no roadmap commitments. Inputs to design decisions, not decisions themselves.
**Document type.** Diátaxis *explanation* / *exploration*.
**Provenance.** Promoted verbatim from the `research/evolutionary-agent-coordination-sandbox` branch (commit `d954f6f0`). That branch had drifted 157 commits behind `main` and its raw diff would have reverted large tracts of landed work, so only these six genuine research notes were lifted out (the rest was ambient noise). The branch is closed; this directory is the durable home.

These six notes were written in one research arc exploring how the Port Daddy swarm coordinates, what it can show the operator, and how it can ingest external agent work. They stand alone; read whichever thread you need.

## The notes

- **[agent-coordination-research.md](./agent-coordination-research.md)** — Directory services, working groups, group chats, and shared data for a multi-agent swarm. Prior art (FIPA, contract-net, blackboard systems) and how PD's primitives map onto them.
- **[multiplayer-input-research.md](./multiplayer-input-research.md)** — Spatial / multiplayer input models for steering the swarm; what a shared operator surface could borrow from multiplayer game input.
- **[note-abstraction-audit.md](./note-abstraction-audit.md)** — Audit of PD's coordination surfaces (notes, claims, sessions) and where the note abstraction leaks or overlaps.
- **[pheromone-visualization-research.md](./pheromone-visualization-research.md)** — Prior art and a design proposal for visualizing the 18-kind pheromone semantics (the ambient-context substrate).
- **[transcript-ingestion-design.md](./transcript-ingestion-design.md)** — PD-side design for ingesting external agent transcripts (the data model and the seams).
- **[transcript-recon.md](./transcript-recon.md)** — Reconnaissance of how Claude Code and Codex CLI persist their transcripts on disk — the input side of ingestion.

## Why this exists as a cluster

Each note is an *input* to a future decision, not a built feature. Several threads here have since informed shipped work (the pheromone substrate, transcript export ladders); keeping the raw exploration durable means the next agent can see the reasoning, not just the outcome. Cross-reference [`whitepaper/research/program/archive/accountability/raw-2026-05-31/`](../agent-accountability-2026-05-31/00-overview-and-lineages.md) for the adjacent accountability-mechanisms research arc.
