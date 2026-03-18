import { CommandPage } from '@/components/docs/CommandPage'

export default function DoneSessionTool() {
  return (
    <CommandPage
      command="done_session"
      description="End the current session and unregister agent. Marks session as completed."
      version="3.7.0"
      syntax="done_session(options?)"
      flags={[
        { flag: 'session', description: 'Explicit session ID (skips current lookup)' },
        { flag: 'summary', description: 'Final summary of work completed' },
      ]}
      usagePatterns={[
        'done_session()',
        'done_session({ summary: "Fixed auth bug and added tests" })',
      ]}
      examples={[
        {
          description: 'End current session',
          code: 'done_session()',
          output: `{\n  "session": "abc123",\n  "status": "completed",\n  "duration": "45m",\n  "notes": 5\n}`
        },
        {
          description: 'End with summary',
          code: 'done_session({ summary: "Fixed auth bug" })',
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
