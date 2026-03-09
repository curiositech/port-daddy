---
title: Session Phases & Integration
description: Track progress and coordinate between agents with phases and signals
duration: 12 min
level: Advanced
---

# Session Phases & Integration

## The 6 Phases

Sessions progress through structured phases:

| Phase | Purpose |
|-------|---------|
| `setup` | Claiming files, reading context |
| `planning` | Deciding approach |
| `implementing` | Writing code |
| `testing` | Running tests |
| `reviewing` | Code review |
| `cleanup` | Releasing resources |

```bash
pd session phase my-session implementing
pd session phase my-session testing
```

Phases only move forward -- no going back to previous phases.

## Integration Signals

Agents can declare what they've completed and what they need:

```bash
# Agent A finishes the API
pd integration ready my-session api

# Agent B declares it needs the API
pd integration needs my-session api
# → Already ready! Agent B can proceed immediately.
```

## Agent Liveness

The daemon monitors agent health:
- **Heartbeat**: Agents ping every 5 minutes
- **Stale**: No heartbeat for 10 minutes
- **Dead**: No heartbeat for 20 minutes → enters salvage queue
- **Adaptive reaper**: Adjusts thresholds based on system load

## Project Briefings

Get a summary of everything happening in a project:

```bash
pd briefing myproject
```

Shows: active agents, sessions with phases, integration signals, recent notes, and any dead agents needing salvage.
