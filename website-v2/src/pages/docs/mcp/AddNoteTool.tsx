import { CommandPage } from '@/components/docs/CommandPage'

export default function AddNoteTool() {
  return (
    <CommandPage
      command="add_note"
      description="Add a note to the current session. Notes are immutable — they are never edited or deleted."
      version="3.8.3"
      syntax="add_note(text, options?)"
      flags={[
        { flag: 'text', description: 'Note content' },
        { flag: 'type', description: 'Note type: progress | decision | milestone | warning (default: progress)' },
        { flag: 'session', description: 'Target session ID (default: current session)' },
      ]}
      usagePatterns={[
        'add_note({ text: "Started JWT refactor" })',
        'add_note({ text: "Auth updated", type: "milestone" })',
      ]}
      examples={[
        {
          description: 'Add a progress note',
          code: 'add_note({ text: "Started JWT refactor" })',
          output: `{\n  "note_id": "note-001",\n  "session": "abc123",\n  "added": true\n}`
        },
        {
          description: 'Add a milestone',
          code: 'add_note({ text: "Auth middleware updated", type: "milestone" })',
          output: `{\n  "note_id": "note-002",\n  "type": "milestone",\n  "added": true\n}`
        },
      ]}
      seeAlso={[
        { name: 'list_notes', href: '/docs/mcp/list-notes' },
        { name: 'begin_session', href: '/docs/mcp/begin-session' },
        { name: 'SDK: addNote()', href: '/docs/sdk/add-note' },
      ]}
    />
  )
}
