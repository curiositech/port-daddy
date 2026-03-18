import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function Spawn() {
  return (
    <SdkFunctionPage
      function="spawn"
      description="Launch an AI agent with Port Daddy coordination pre-wired. The agent auto-registers, sends heartbeats, writes notes, and gets salvaged if it crashes."
      module="Agents"
      version="3.7.0"
      signature="spawn(options: SpawnOptions): Promise<AgentProcess>"
      params={[
        { name: 'options.backend', type: 'AIBackend', required: true, description: 'AI backend: ollama | claude | gemini | aider | custom' },
        { name: 'options.model', type: 'string', required: true, description: 'Model name (e.g., llama3, claude-haiku-4-5)' },
        { name: 'options.identity', type: 'string', required: true, description: 'Semantic identity for this agent' },
        { name: 'options.purpose', type: 'string', required: true, description: 'What this agent should do' },
        { name: 'options.harbor', type: 'string', description: 'Harbor name for scoped permissions' },
        { name: 'options.prompt', type: 'string', required: true, description: 'Prompt to send to the agent' },
      ]}
      returns={{
        type: 'Promise<AgentProcess>',
        description: 'Agent process handle with pid and session info'
      }}
      examples={[
        {
          description: 'Spawn a Claude agent for code review',
          code: `const agent = await pd.agents.spawn({
  backend: 'claude',
  model: 'claude-haiku-4-5',
  identity: 'myapp:reviewer',
  purpose: 'Review auth code for security',
  prompt: 'Review src/auth/ for security vulnerabilities'
})
console.log(agent)`,
          output: `{
  "pid": 12345,
  "session": "def456",
  "identity": "myapp:reviewer",
  "status": "running"
}`
        },
        {
          description: 'Spawn with harbor permissions',
          code: `await pd.agents.spawn({
  backend: 'ollama',
  model: 'llama3',
  identity: 'myapp:security',
  purpose: 'Security audit',
  harbor: 'myapp:security-review',
  prompt: 'Audit all API endpoints'
})`
        },
      ]}
      seeAlso={[
        { name: 'listSpawned()', href: '/docs/sdk/list-spawned' },
        { name: 'salvage()', href: '/docs/sdk/salvage' },
        { name: 'createHarbor()', href: '/docs/sdk/harbors' },
      ]}
    />
  )
}
