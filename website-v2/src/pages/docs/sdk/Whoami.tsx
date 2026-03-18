import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function Whoami() {
  return (
    <SdkFunctionPage
      function="whoami"
      description="Show the current agent identity and session from the active session file."
      module="Sessions"
      version="3.7.0"
      signature="whoami(): Promise<SessionInfo | null>"
      returns={{
        type: 'Promise<SessionInfo | null>',
        description: 'Current session info, or null if no active session'
      }}
      examples={[
        {
          description: 'Get current session info',
          code: `const info = await pd.sessions.whoami()
console.log(info)`,
          output: `{
  "agent": "myapp:api",
  "session": "abc123",
  "purpose": "Fix auth bug",
  "startedAt": "2026-03-16T11:00:00Z",
  "duration": "23m"
}`
        },
        {
          description: 'Check if session exists',
          code: `const info = await pd.sessions.whoami()
if (!info) {
  console.log('No active session — run beginSession() first')
}`
        },
      ]}
      seeAlso={[
        { name: 'beginSession()', href: '/docs/sdk/sessions' },
        { name: 'doneSession()', href: '/docs/sdk/sessions' },
      ]}
    />
  )
}
