/**
 * Hero section copy for the Port Daddy marketing website.
 *
 * Historical hero copy kept for older experiments. The current public homepage
 * leads with Port Daddy as the local coordination layer for coding agents.
 */

export const HERO_COPY = {
  headline: 'The Local Communication Layer\nFor Coding Agents.',

  subheadline:
    'Port Daddy is a local app and daemon where coding agents share notes, claims, messages, readiness, budgets, and recoverable handoffs.',

  description:
    'One local daemon, discovered from the running install. Install it once, and Claude Code, Codex, Cursor, Gemini CLI, Aider, and Ollama can coordinate through shared state backed by a single SQLite database.',

  featureHighlights: [
    {
      label: 'Shared State',
      text: 'Notes, file claims, actor messages, tuple cells, and scoped channels give every agent the same operating picture.',
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
