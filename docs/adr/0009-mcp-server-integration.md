# 0009. MCP Server Integration for Claude Agent Tooling

## Status

Accepted

## Context

Port Daddy's primary users are AI agents running in Claude Code. These agents need to coordinate with each other: claim ports, start sessions, post notes, acquire locks, check for dead agents to resurrect. Before the MCP server, agents had two options:

1. **Use the CLI**: `pd claim myapp:api`, `pd note "completed auth module"`. This works well but requires spawning a subprocess for every operation.
2. **Use the SDK**: Import `PortDaddy` from `port-daddy/client` and call methods directly. This requires the consuming code to import and initialize the SDK, which adds setup overhead for every agent that needs coordination.

The Model Context Protocol (MCP) is the standard protocol by which Claude and other LLMs expose and consume tools. Claude Code natively supports MCP servers — if an MCP server is registered, the LLM can call its tools as first-class actions without any subprocess spawning or SDK initialization.

The question was: should Port Daddy expose an MCP server that Claude agents can use natively?

## Decision Drivers

- **Native agent integration**: AI agents using Claude Code should be able to call `claim_port`, `add_note`, and `begin_session` as tool calls, with the same ergonomics as any other Claude tool.
- **Zero friction**: Agents should not need to know how to invoke the CLI or initialize the SDK. The MCP server should just work once registered in `~/.claude.json` or `claude_desktop_config.json`.
- **Full API coverage**: The MCP server should expose Port Daddy's complete coordination API, not a limited subset. Agents should not hit a wall where they need to fall back to the CLI.
- **No additional infrastructure**: The MCP server should be startable as a sub-process of the MCP host (Claude Code), using the existing daemon. It should not require running an additional server.
- **Stdio transport**: Claude Code's MCP integration uses stdio (stdin/stdout) as the communication transport between the MCP host and the MCP server. The MCP server must use this transport.

## Considered Options

### Option A: MCP server in `mcp/server.ts` — stdio transport, proxying the daemon via HTTP

A standalone MCP server process that receives tool calls over stdio (from Claude Code) and translates them into HTTP requests to the Port Daddy daemon (`http://localhost:9876`).

**Pros:**
- Follows the standard MCP pattern: a lightweight proxy that speaks stdio to the host and HTTP to the backend
- The daemon remains the single source of truth — the MCP server is stateless
- No additional ports or sockets needed for the MCP server itself
- Claude Code's MCP host manages the MCP server lifecycle (starts it on demand, restarts it if it crashes)
- Works with Claude Desktop and Claude Code using the same code

**Cons:**
- Two-hop latency: Claude agent call → MCP server (stdio) → daemon (HTTP) → response
- The MCP server must be explicitly registered in the Claude configuration file
- If the daemon is not running, the MCP server returns errors — agents must know to start the daemon first

### Option B: Embed the MCP server in the daemon

Add MCP server functionality directly to `server.ts`, listening on an additional port or socket.

**Pros:**
- No separate process — reduces the number of processes to manage

**Cons:**
- The MCP transport for Claude Code is stdio, not HTTP. A daemon process cannot easily speak stdio to multiple clients simultaneously.
- Conflates two concerns: the HTTP daemon and the MCP protocol adapter
- Makes the daemon significantly more complex

### Option C: CLI as the MCP tool surface (no separate MCP server)

Register CLI commands as MCP tools using shell execution.

**Pros:**
- No additional code — the CLI already exposes all functionality

**Cons:**
- Subprocess spawning for every tool call is slower than a persistent MCP server process
- Shell escaping and argument parsing are fragile
- Claude Code's MCP integration does not natively support "run this shell command as a tool" — it requires a proper MCP server

### Option D: SDK-only (no MCP server)

Document the JavaScript SDK and expect agents to import it.

**Pros:**
- No additional protocol to maintain

**Cons:**
- AI agents (running as Claude in Claude Code) cannot easily import and initialize an npm module in the middle of a task. They would need to spawn a Node.js subprocess anyway.
- Reduces Port Daddy's usability as a first-class agent coordination tool

## Decision

Implement a **dedicated MCP server in `mcp/server.ts`** using the `@modelcontextprotocol/sdk` package with a stdio transport. The MCP server is a thin proxy: it receives tool calls from the Claude MCP host, translates them into HTTP requests to the Port Daddy daemon, and returns the results.

The MCP server is registered globally in the user's Claude configuration:

```json
{
  "mcpServers": {
    "port-daddy": {
      "command": "npx",
      "args": ["port-daddy", "mcp"]
    }
  }
}
```

This registration means Claude Code automatically starts the MCP server when needed and makes its tools available to all Claude agents.

**Tool surface (from `mcp/server.ts`):**

The MCP server exposes the full Port Daddy API as named tools organized by category:
- Port management: `claim_port`, `release_port`, `list_services`
- Session management: `start_session`, `end_session`, `add_session_note`, `list_sessions`, `quick_note`
- Agent lifecycle: `register_agent`, `agent_heartbeat`, `unregister_agent`, `list_agents`
- Sugar (compound operations): `begin_session` (register + start atomically), `end_session_full` (end + unregister), `whoami`
- Locks: `acquire_lock`, `release_lock`, `list_locks`
- Messaging: `publish_message`, `get_messages`
- Resurrection: `list_resurrection_queue`, `claim_resurrection`
- DNS: `register_dns`, `lookup_dns`
- Briefing: `get_briefing`
- Diagnostics: `daemon_health`, `daemon_metrics`

**Resources:** The MCP server also exposes MCP resources for passive inspection — `port-daddy://services`, `port-daddy://agents`, `port-daddy://sessions` — which Claude can read without calling tools.

**HTTP transport layer:** The MCP server uses Node.js's built-in `http` module (no external dependencies) to communicate with the daemon. The daemon URL defaults to `http://localhost:9876` and is overridable with `PORT_DADDY_URL`.

## Rationale

The stdio proxy pattern is the correct architecture for this use case. The alternative — embedding MCP directly in the daemon — would require the daemon to manage stdio connections, which conflicts with being an HTTP server that multiple clients connect to simultaneously.

The choice to expose the HTTP TCP endpoint (rather than the Unix socket) for the MCP server is deliberate: the MCP server process may be started in a different working directory than the user's project, and the socket path must be universally accessible. The TCP endpoint at `localhost:9876` is always reachable.

The `begin_session` and `end_session_full` MCP tools (corresponding to `pd begin` and `pd done`) were added specifically because they are the most common multi-step operations an agent performs. Rather than requiring the agent to call `register_agent` followed by `start_session` (two tool calls, with error handling between them), `begin_session` does both atomically with rollback on failure.

## Consequences

### Positive

- Claude agents can coordinate via Port Daddy with tool calls like `claim_port`, `begin_session`, and `add_session_note` — no subprocess spawning, no SDK initialization
- The MCP server is globally registered and automatically started by Claude Code — agents do not need to think about Port Daddy's infrastructure
- The `begin` / `done` / `whoami` MCP tools give agents a clean session lifecycle in three calls
- The MCP server is versioned with Port Daddy — `npm install -g port-daddy` updates the MCP server automatically
- The MCP server's statelessness means crashes are harmless — Claude Code restarts it on the next tool call

### Negative

- The MCP server requires the daemon to be running. If the daemon is not running (e.g., fresh machine install), MCP tool calls return errors. The recommended solution is to add `pd dev` to the user's shell startup.
- Two-hop latency (stdio → HTTP → SQLite → response) adds a small overhead per tool call. In practice this is under 10ms for local operations.
- The `@modelcontextprotocol/sdk` dependency (`^1.27.1`) is a production dependency — it adds to the package size. This is unavoidable.

### Neutral

- The MCP server is distributed as part of the main `port-daddy` package (in the `mcp/` directory, included in the `files` array). It is not a separate package.
- The `pd mcp` CLI command starts the MCP server, enabling the `npx port-daddy mcp` invocation pattern used by Claude Code's MCP configuration.
- Parity between the MCP tools and the CLI commands is enforced by `tests/unit/mcp-parity.test.js`, which parses the tool definitions from `mcp/server.ts` and verifies that each tool has a corresponding CLI command.
