import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function AddNote() {
  return (
    <SdkFunctionPage
      function="note"
      description="Add a note to the current session. Notes are immutable — they are never edited or deleted."
      module="Sessions"
      version="3.11.0"
      signature="note(content: string, options?: NoteOptions): Promise<Note>"
      params={[
        { name: 'content', type: 'string', required: true, description: 'Note content' },
        { name: 'options.type', type: 'NoteType', description: 'Type: progress | decision | milestone | warning (default: progress)' },
        { name: 'options.sessionId', type: 'string', description: 'Target session ID (default: current session)' },
        { name: 'options.agentId', type: 'string', description: 'Target agent ID when resolving an active session' },
      ]}
      returns={{
        type: 'Promise<Note>',
        description: 'The created note with timestamp'
      }}
      examples={[
        {
          description: 'Add a progress note',
          code: `await pd.note('Started JWT refactor')`
        },
        {
          description: 'Add a milestone note',
          code: `await pd.note(
  'Auth middleware updated — JWT shape changed',
  { type: 'milestone' }
)`
        },
        {
          description: 'Add note to specific session',
          code: `await pd.note('Review complete', {
  sessionId: 'session-abc123'
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
