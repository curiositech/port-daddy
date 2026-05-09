# Agent Topology Event Trace

This example turns three common swarm topologies into concrete Port Daddy
messages:

- star topology: one coordinator delegates to workers
- ring topology: each phase publishes the next phase trigger
- arbiter topology: a worker asks a quality gate to accept or reject work

The code does not spawn real agents. It publishes the event trace a real
orchestrator, workflow runner, or fleet template would use.

## Run It

```bash
npx tsx examples/agent-topologies/topology-pubsub.ts
```

Inspect the channels afterwards:

```bash
pd channels
pd sub topology:star
pd sub topology:ring
pd sub topology:arbiter
```

## What It Demonstrates

- use plain message channels for topology edges
- keep topology events inspectable after the process exits
- model leader-worker, phase relay, and quality-gate workflows without custom infrastructure

Use this when designing a fleet template, a local workflow runner, or a teaching
tool that needs to show how agents coordinate without hiding every transition in
one terminal.
