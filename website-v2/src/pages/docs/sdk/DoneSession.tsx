import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function DoneSession() {
  return (
    <SdkFunctionPage
      function="doneSession"
      description="End the current session and unregister agent. Reads session ID from current session file. Marks session as completed."
      module="Sessions"
      version="3.13.0"
      signature="doneSession(options?: DoneOptions): Promise<SessionResult>"
      params={[
        { name: 'options.session', type: 'string', description: 'Explicit session ID (skips current.json lookup)' },
        { name: 'options.summary', type: 'string', description: 'Final summary of work completed' },
      ]}
      returns={{
        type: 'Promise<SessionResult>',
        description: 'Session completion info'
      }}
      examples={[
        {
          description: 'End current session',
          code: `const result = await pd.sessions.done()
console.log(result)`,
          output: `{
  "session": "abc123",
  "status": "completed",
  "duration": "45m",
  "notes": 5
}`
        },
        {
          description: 'End with summary',
          code: `await pd.sessions.done({
  summary: 'Fixed auth bug and added tests'
})`
        },
      ]}
      seeAlso={[
        { name: 'beginSession()', href: '/docs/sdk/sessions' },
        { name: 'whoami()', href: '/docs/sdk/whoami' },
      ]}
    />
  )
}
