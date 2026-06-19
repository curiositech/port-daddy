import { CommandPage } from '@/components/docs/CommandPage'

export default function BeginSessionTool() {
  return (
    <CommandPage
      command="begin_session"
      description="Start a new agent session and register as a coordinated agent. Sessions track work context, enable communication between agents, and provide visibility into ongoing work. Returns session and agent IDs."
      version="3.13.0"
      syntax="begin_session(options?)"
      flags={[
        { flag: 'identity', description: 'Semantic identity (project:stack:context format)' },
        { flag: 'purpose', description: 'Description of what this agent is working on' },
        { flag: 'project', description: 'Project name (inferred from identity if not provided)' },
      ]}
      usagePatterns={[
        'begin_session()',
        'begin_session({ identity: "myapp:api" })',
        'begin_session({ identity: "myapp:frontend", purpose: "Build login page" })',
      ]}
      examples={[
        {
          description: 'Basic session with identity',
          code: 'begin_session({ identity: "myapp:api", purpose: "Fix auth bug" })',
          output: `{
  "session_id": "abc123-def456",
  "agent_id": "agent-001",
  "identity": "myapp:api",
  "purpose": "Fix auth bug",
  "started_at": "2026-03-16T12:00:00Z",
  "status": "active",
  "dead_agents": 0
}`
        },
        {
          description: 'Anonymous session',
          code: 'begin_session()',
          output: `{
  "session_id": "xyz789-ghi012",
  "agent_id": "agent-002",
  "identity": "anonymous",
  "purpose": null,
  "started_at": "2026-03-16T12:00:00Z",
  "status": "active"
}`
        },
        {
          description: 'Session with dead agent warning',
          code: 'begin_session({ identity: "myapp:coder", purpose: "Continue work" })',
          output: `{
  "session_id": "xyz789-ghi012",
  "agent_id": "agent-003",
  "identity": "myapp:coder",
  "purpose": "Continue work",
  "started_at": "2026-03-16T12:00:00Z",
  "status": "active",
  "dead_agents": 1,
  "salvage_suggestion": "Run: pd salvage --project myapp"
}`
        },
      ]}
      seeAlso={[
        { name: 'publish_message', href: '/docs/mcp/publish-message' },
        { name: 'acquire_lock', href: '/docs/mcp/acquire-lock' },
        { name: 'create_harbor', href: '/docs/mcp/create-harbor' },
        { name: 'SDK: beginSession()', href: '/docs/sdk/sessions' },
      ]}
    />
  )
}
