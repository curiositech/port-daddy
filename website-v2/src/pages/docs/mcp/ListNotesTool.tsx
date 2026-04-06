import { CommandPage } from '@/components/docs/CommandPage'

export default function ListNotesTool() {
  return (
    <CommandPage
      command="list_notes"
      description="Show recent notes. Without filters, returns the last 10 notes across all sessions."
      version="3.8.3"
      syntax="list_notes(options?)"
      flags={[
        { flag: 'session', description: 'Filter by specific session ID' },
        { flag: 'limit', description: 'Number of notes to return (default: 10)' },
        { flag: 'type', description: 'Filter by note type' },
      ]}
      usagePatterns={[
        'list_notes()',
        'list_notes({ limit: 5 })',
        'list_notes({ session: "abc123" })',
      ]}
      examples={[
        {
          description: 'Get recent notes',
          code: 'list_notes({ limit: 5 })',
          output: `[\n  { "type": "milestone", "text": "Auth updated...", "time": "1m ago" },\n  { "type": "progress", "text": "Started refactor", "time": "5m ago" }\n]`
        },
      ]}
      seeAlso={[
        { name: 'add_note', href: '/docs/mcp/add-note' },
        { name: 'begin_session', href: '/docs/mcp/begin-session' },
        { name: 'SDK: listNotes()', href: '/docs/sdk/list-notes' },
      ]}
    />
  )
}
