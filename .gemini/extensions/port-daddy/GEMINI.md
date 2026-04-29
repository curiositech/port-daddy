# Port Daddy Gemini Extension

This extension integrates Port Daddy into Gemini CLI, providing direct access to the Port Daddy daemon for atomic port assignment, pub/sub messaging, agent synchronization, and time-travel debugging.

## Features
- **MCP Integration:** Automatically registers the `port-daddy` MCP server to interact with the local daemon.
- **Agent Skill:** Provides the `port-daddy-agent-skill` skill so agents know exactly how to use the daemon's primitives.

## Included Skills
- `port-daddy-agent-skill`: Expert guidance on using Port Daddy for coordinating multi-agent workflows.

## Configuration
Ensure your Port Daddy daemon is running locally (`pd start`) to use the MCP tools.
