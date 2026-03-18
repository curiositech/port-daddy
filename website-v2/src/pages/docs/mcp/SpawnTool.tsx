import { CommandPage } from '@/components/docs/CommandPage'

export default function SpawnTool() {
  return (
    <CommandPage
      command="spawn_agent"
      description="Launch an AI agent with Port Daddy coordination pre-wired. The agent auto-registers, sends heartbeats, writes notes, and gets salvaged if it crashes."
      version="3.7.0"
      syntax="spawn_agent(options)"
      flags={[
        { flag: 'backend', description: 'AI backend: ollama | claude | gemini | aider | custom' },
        { flag: 'model', description: 'Model name (e.g., llama3, claude-haiku-4-5)' },
        { flag: 'identity', description: 'Semantic identity for this agent' },
        { flag: 'purpose', description: 'What this agent should do' },
        { flag: 'harbor', description: 'Harbor name for scoped permissions (optional)' },
        { flag: 'prompt', description: 'Prompt to send to the agent' },
      ]}
      usagePatterns={[
        'spawn_agent({ backend: "claude", model: "claude-haiku-4-5", identity: "myapp:reviewer", purpose: "Code review", prompt: "Review src/auth/" })',
      ]}
      examples={[
        {
          description: 'Spawn a Claude agent',
          code: 'spawn_agent({\n  backend: "claude",\n  model: "claude-haiku-4-5",\n  identity: "myapp:reviewer",\n  purpose: "Security review",\n  prompt: "Review src/auth/ for vulnerabilities"\n})',
          output: `{\n  "agent_id": "agent-789",\n  "session": "def456",\n  "identity": "myapp:reviewer",\n  "status": "running"\n}`
        },
        {
          description: 'Spawn with harbor permissions',
          code: 'spawn_agent({\n  backend: "ollama",\n  model: "llama3",\n  identity: "myapp:security",\n  purpose: "Security audit",\n  harbor: "myapp:security-review",\n  prompt: "Audit all API endpoints"\n})',
        },
      ]}
      seeAlso={[
        { name: 'list_spawned', href: '/docs/mcp/list-spawned' },
        { name: 'salvage', href: '/docs/mcp/salvage' },
        { name: 'create_harbor', href: '/docs/mcp/create-harbor' },
        { name: 'SDK: spawn()', href: '/docs/sdk/spawn' },
      ]}
    />
  )
}
