/**
 * Introductory paragraphs for each major section of the Port Daddy website.
 *
 * Every section on the landing page and in the navigation currently jumps
 * straight into feature cards or tutorial grids without explaining *why* the
 * section exists. These intros provide the connective tissue that helps a
 * first-time visitor build a mental model of the product before they dive
 * into specifics.
 */

export const SECTION_INTROS = {
  features: {
    title: 'Why These Primitives Exist',
    body: 'Multi-agent development breaks when work has no shared state: agents cannot see each other, handoffs disappear into transcripts, files are edited without ownership, launch costs stay opaque, and crashes erase context. Every feature in Port Daddy closes one of those gaps. This is the minimum substrate for running multiple AI agents against one codebase without losing work.',
  },

  blueprints: {
    title: 'Start With a Control-Plane Pattern',
    body: 'Blueprints are pre-built coordination recipes that wire Port Daddy primitives into common agent architectures. Instead of inventing file claims, channels, session phases, and launch boundaries from scratch, pick a blueprint that matches the workflow -- a LangChain tool swarm, a CrewAI security review, or a self-healing CI pipeline -- and customize from there.',
  },

  harbors: {
    title: 'Security Boundaries for Agent Work',
    body: 'When an AI agent can touch a repo, the boundary matters. Harbors define named permission namespaces for code, notes, claims, tunnels, and other shared resources. The goal is not theatrical isolation; it is a concrete capability boundary the daemon and UI can show before agents run.',
  },

  tutorials: {
    title: 'Learn the Operator Workflow',
    body: 'The tutorials are ordered intentionally. Start with the project boundary, then install the local daemon and FleetBar, name the work, begin sessions, share notes, publish channel events, and launch agents with visible recovery paths. Ports, DNS, tunnels, fleets, and spawned jobs are taught as resources inside that control plane.',
  },

  docs: {
    title: 'Three Interfaces, One Daemon',
    body: 'Port Daddy exposes the same capabilities through three interfaces: a CLI for humans and shell scripts, a TypeScript SDK for programmatic access from Node.js, and an MCP server for agents that speak the Model Context Protocol. The docs are organized by interface so an engineer can evaluate the same substrate from app, automation, and agent-runtime angles.',
  },
} as const
