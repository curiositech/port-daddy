import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function ListNotes() {
  return (
    <SdkFunctionPage
      function="listNotes"
      description="Show recent notes. Without filters, returns the last 10 notes across all sessions."
      module="Sessions"
      version="3.8.3"
      signature="listNotes(options?: ListNotesOptions): Promise<Note[]>"
      params={[
        { name: 'options.session', type: 'string', description: 'Filter by specific session ID' },
        { name: 'options.limit', type: 'number', description: 'Number of notes to return (default: 10)' },
        { name: 'options.type', type: 'NoteType', description: 'Filter by note type' },
      ]}
      returns={{
        type: 'Promise<Note[]>',
        description: 'Array of notes sorted by timestamp (newest first)'
      }}
      examples={[
        {
          description: 'Get recent notes',
          code: `const notes = await pd.sessions.listNotes({ limit: 5 })
console.log(notes)`,
          output: `[
  { type: 'milestone', text: 'Auth middleware updated...', time: '1m ago' },
  { type: 'progress', text: 'Started JWT refactor', time: '5m ago' }
]`
        },
        {
          description: 'Get all milestone notes',
          code: `const milestones = await pd.sessions.listNotes({
  type: 'milestone',
  limit: 100
})`
        },
      ]}
      seeAlso={[
        { name: 'addNote()', href: '/docs/sdk/add-note' },
        { name: 'beginSession()', href: '/docs/sdk/sessions' },
      ]}
    />
  )
}
