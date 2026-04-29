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
    title: 'Why These Features Exist',
    body: 'Multi-agent development breaks when work has no shared boundary: agents cannot see each other, handoffs disappear into transcripts, files are edited without ownership, and crashes erase context. Every feature in Port Daddy exists to close one of those gaps. They are not a grab bag of nice-to-haves -- they are the minimum set of primitives required to run multiple AI agents against a single codebase without losing work.',
  },

  blueprints: {
    title: 'Start With a Pattern, Not a Blank Slate',
    body: 'Blueprints are pre-built coordination recipes that wire together Port Daddy primitives into common agent architectures. Instead of figuring out how to connect file claims, pub/sub channels, and session phases yourself, pick a blueprint that matches your workflow -- a LangChain tool swarm, a CrewAI security review, a self-healing CI pipeline -- and customize from there. Each blueprint is a working .portdaddyrc configuration plus a README that explains the design decisions behind it.',
  },

  harbors: {
    title: 'Security Boundaries for Agent Teams',
    body: 'When you give an AI agent access to your codebase, you are trusting it with everything: source files, environment variables, database credentials. Harbors let you draw boundaries. Each harbor is a named permission namespace with an HMAC-signed capability token that controls exactly what an agent can do -- read code, write notes, claim files, create tunnels. Agents outside the harbor cannot access resources inside it, and tokens expire automatically so permissions never linger.',
  },

  tutorials: {
    title: 'Learn the Harbor-First Workflow',
    body: 'The tutorials are ordered intentionally. Start with the project harbor, then install the local daemon and FleetBar, name the work, begin sessions, share notes, publish channel events, and launch agents with visible recovery paths. Ports, DNS, tunnels, fleets, and spawned jobs are taught as resources inside that boundary, not as the whole story.',
  },

  docs: {
    title: 'Three Interfaces, One Daemon',
    body: 'Port Daddy exposes the same capabilities through three interfaces: a CLI for humans and shell scripts, a TypeScript SDK for programmatic access from Node.js, and an MCP server for AI agents that speak the Model Context Protocol. The docs are organized by interface so you can find the right syntax for your context. If you are wiring Port Daddy into an agent framework, start with the SDK. If you are scripting a CI pipeline, start with the CLI. If you are configuring an AI assistant, start with MCP.',
  },
} as const
