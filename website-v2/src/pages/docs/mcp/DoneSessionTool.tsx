import { CommandPage } from '@/components/docs/CommandPage'

export default function DoneSessionTool() {
  return (
    <CommandPage
      command="end_session_full"
      description="End the current session and unregister the agent. Marks completed by default, or records a self-salvage capsule when telos is unfinished but still doable."
      version="3.11.0"
      syntax="end_session_full(options?)"
      flags={[
        { flag: 'agent_id', description: 'Agent ID returned by begin_session' },
        { flag: 'session_id', description: 'Explicit session ID (skips current lookup)' },
        { flag: 'note', description: 'Final summary or handoff note' },
        { flag: 'status', description: 'completed or abandoned' },
        { flag: 'self_salvage', description: 'Recovery capsule with telos verdict, doable, why stopped, next plan, wisdom, evidence, and risk' },
      ]}
      usagePatterns={[
        'end_session_full()',
        'end_session_full({ note: "Fixed auth bug and added tests" })',
        'end_session_full({ self_salvage: { telos_verdict: "partial", doable: "yes", next_plan: "run deploy smoke" } })',
      ]}
      examples={[
        {
          description: 'End current session',
          code: 'end_session_full()',
          output: `{\n  "session": "abc123",\n  "status": "completed",\n  "duration": "45m",\n  "notes": 5\n}`
        },
        {
          description: 'Leave recoverable unfinished telos',
          code: `end_session_full({
  note: "Stopped before production smoke",
  self_salvage: {
    telos_verdict: "partial",
    doable: "yes",
    why_stopped: "stale daemon blocked live proof",
    next_plan: ["promote daemon", "smoke /agents and /mcp"],
    wisdom: "source truth is not operator truth until promotion succeeds"
  }
})`,
          output: `{
  "session": "abc123",
  "status": "abandoned",
  "selfSalvageQueued": true
}`
        },
      ]}
      seeAlso={[
        { name: 'begin_session', href: '/docs/mcp/begin-session' },
        { name: 'add_note', href: '/docs/mcp/add-note' },
        { name: 'SDK: doneSession()', href: '/docs/sdk/done-session' },
      ]}
    />
  )
}
