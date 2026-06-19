import { CommandPage } from '@/components/docs/CommandPage'

export default function AddNoteTool() {
  return (
    <CommandPage
      command="add_note"
      description="Add a note to the current session. Notes are immutable — they are never edited or deleted."
      version="3.13.0"
      syntax="add_note({ content, type?, session_id? })"
      flags={[
        { flag: 'content', description: 'Note content' },
        { flag: 'type', description: 'Note type: progress | decision | milestone | warning (default: progress)' },
        { flag: 'session_id', description: 'Target session ID (default: current session or quick note)' },
      ]}
      usagePatterns={[
        'add_note({ content: "Started JWT refactor" })',
        'add_note({ content: "Auth updated", type: "milestone" })',
      ]}
      examples={[
        {
          description: 'Add a progress note',
          code: 'add_note({ content: "Started JWT refactor" })',
          output: `{\n  "note_id": "note-001",\n  "session": "abc123",\n  "added": true\n}`
        },
        {
          description: 'Add a milestone',
          code: 'add_note({ content: "Auth middleware updated", type: "milestone" })',
          output: `{\n  "note_id": "note-002",\n  "type": "milestone",\n  "added": true\n}`
        },
      ]}
      seeAlso={[
        { name: 'list_notes', href: '/docs/mcp/list-notes' },
        { name: 'begin_session', href: '/docs/mcp/begin-session' },
        { name: 'SDK: note()', href: '/docs/sdk/add-note' },
      ]}
    />
  )
}
