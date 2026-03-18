import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function AddNote() {
  return (
    <SdkFunctionPage
      function="addNote"
      description="Add a note to the current session. Notes are immutable — they are never edited or deleted."
      module="Sessions"
      version="3.7.0"
      signature="addNote(text: string, options?: NoteOptions): Promise<Note>"
      params={[
        { name: 'text', type: 'string', required: true, description: 'Note content' },
        { name: 'options.type', type: 'NoteType', description: 'Type: progress | decision | milestone | warning (default: progress)' },
        { name: 'options.session', type: 'string', description: 'Target session ID (default: current session)' },
      ]}
      returns={{
        type: 'Promise<Note>',
        description: 'The created note with timestamp'
      }}
      examples={[
        {
          description: 'Add a progress note',
          code: `await pd.sessions.addNote('Started JWT refactor')`
        },
        {
          description: 'Add a milestone note',
          code: `await pd.sessions.addNote(
  'Auth middleware updated — JWT shape changed',
  { type: 'milestone' }
)`
        },
        {
          description: 'Add note to specific session',
          code: `await pd.sessions.addNote('Review complete', {
  session: 'abc123'
})`
        },
      ]}
      seeAlso={[
        { name: 'listNotes()', href: '/docs/sdk/list-notes' },
        { name: 'beginSession()', href: '/docs/sdk/sessions' },
      ]}
    />
  )
}
