/**
 * Hero section copy for the Port Daddy marketing website.
 *
 * The previous headline ("Infrastructure for the Agent Economy") was vague
 * corporate-speak that told newcomers nothing about what Port Daddy actually
 * does. This copy leads with the concrete pain point (port conflicts, file
 * overwrites, agent chaos) and only then introduces Port Daddy as the fix.
 */

export const HERO_COPY = {
  headline: 'Stop Your AI Agents\nFrom Fighting Each Other.',

  subheadline:
    'Port Daddy is a local daemon that gives every AI coding agent its own port, its own workspace, and a shared radio channel -- so they coordinate instead of collide.',

  description:
    'One local daemon, usually on localhost:9876. Install it once, and Claude Code, Codex, Cursor, Gemini CLI, Aider, and Ollama can all run in the same monorepo without stepping on each other. Deterministic ports, file-level claims, real-time messaging, and automatic crash recovery -- all backed by a single SQLite database.',

  featureHighlights: [
    {
      label: 'Zero Port Conflicts',
      text: 'Semantic identities like myapp:api always resolve to the same port. No more EADDRINUSE at 2 AM.',
    },
    {
      label: 'Agent Coordination',
      text: 'File claims, distributed locks, and pub/sub messaging let agents work in parallel without overwriting each other.',
    },
    {
      label: 'Crash Recovery',
      text: 'When an agent dies mid-task, Port Daddy preserves its session notes and file claims so another agent can pick up where it left off.',
    },
  ],
} as const
