import { CommandPage } from '@/components/docs/CommandPage'

export default function SpawnCommand() {
  return (
    <CommandPage
      command="pd spawn"
      description="Launch an AI agent with Port Daddy coordination pre-wired. The agent auto-registers, sends heartbeats, writes notes, and gets salvaged if it crashes. This is the primary way to run AI agents that participate in the coordination system."
      version="3.7.0"
      syntax="pd spawn [flags] -- <prompt>"
      flags={[
        { flag: '--backend <type>', description: 'AI backend: ollama | claude | gemini | aider | custom' },
        { flag: '--model <name>', description: 'Model to use (e.g. llama3, claude-haiku-4-5)' },
        { flag: '--identity <id>', description: 'Semantic identity for this agent' },
        { flag: '--purpose <text>', description: 'What this agent should do' },
        { flag: '--harbor <name>', description: 'Run agent inside a harbor (scoped permissions)' },
        { flag: '-- <prompt>', description: 'Prompt to send (last argument)' },
      ]}
      usagePatterns={[
        'pd spawn --backend claude --identity myapp:reviewer -- "Review code"',
        'pd spawn --backend ollama --model llama3 --identity myapp:coder --purpose "Fix bugs"',
        'pd spawn --backend claude --model claude-haiku-4-5 --harbor myapp:security --identity myapp:auditor -- "Audit auth"',
      ]}
      examples={[
        {
          description: 'Spawn a Claude agent for code review',
          code: 'pd spawn --backend claude --model claude-haiku-4-5 \\\n  --identity myapp:reviewer \\\n  -- "Review src/auth/ for security vulnerabilities"',
          output: `[pd] Spawned agent myapp:reviewer (session def456)
[pd] Backend: claude · Model: claude-haiku-4-5
[pd] Running...`
        },
        {
          description: 'Spawn an Ollama agent with local LLM',
          code: 'pd spawn --backend ollama --model llama3 \\\n  --identity myapp:coder \\\n  --purpose "Refactor utils" \\\n  -- "Refactor src/utils/helpers.ts to use modern syntax"',
          output: `[pd] Spawned agent myapp:coder (session xyz789)
[pd] Backend: ollama · Model: llama3
[pd] Connected to http://localhost:11434
[pd] Running...`
        },
        {
          description: 'Spawn agent inside a harbor for restricted permissions',
          code: 'pd spawn --backend claude \\\n  --harbor myapp:security-review \\\n  --identity myapp:auditor \\\n  -- "Audit all database queries for SQL injection"',
          output: `[pd] Entered harbor: myapp:security-review
[pd] Spawned agent myapp:auditor (session harbor-001)
[pd] Capabilities: code:read, notes:write
[pd] Running...`
        },
        {
          description: 'Using with Aider for pair programming',
          code: 'pd spawn --backend aider \\\n  --identity myapp:pair \\\n  --purpose "Implement feature" \\\n  -- "Add pagination to the user list API"',
          output: `[pd] Spawned agent myapp:pair (session aider-001)
[pd] Backend: aider
[pd] Started aider session in /workspace/myapp
[pd] Use 'pd spawned' to see active agents`
        },
      ]}
      seeAlso={[
        { name: 'pd spawned', href: '/docs/cli/spawned' },
        { name: 'pd begin', href: '/docs/cli/begin' },
        { name: 'pd done', href: '/docs/cli/done' },
        { name: 'pd harbor enter', href: '/docs/cli/harbor-enter' },
        { name: 'pd salvage', href: '/docs/cli/salvage' },
      ]}
    />
  )
}
