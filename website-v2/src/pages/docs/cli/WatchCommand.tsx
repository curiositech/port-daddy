import { CommandPage } from '@/components/docs/CommandPage'

export default function WatchCommand() {
  return (
    <CommandPage
      command="pd watch"
      description="Subscribe to a channel and run a script on every message. Uses SSE for real-time delivery. Auto-reconnects on disconnect. This is the 'always-on agent' primitive for event-driven automation."
      version="3.11.0"
      syntax="pd watch <channel> [flags]"
      flags={[
        { flag: '--exec <script>', description: 'Script to run on each message' },
        { flag: '--once', description: 'Stop after the first message' },
      ]}
      usagePatterns={[
        'pd watch build:done --exec ./scripts/deploy.sh',
        'pd watch deploy:request --once',
        'pd watch logs:error --exec ./scripts/alert.sh',
      ]}
      examples={[
        {
          description: 'Watch for build completions and auto-deploy',
          code: 'pd watch build:done --exec ./scripts/deploy.sh',
          output: `Watching build:done...
  → Message received: {"sha":"abc123","status":"success"}
  → Running ./scripts/deploy.sh
  → Deploying abc123 to staging...
  → Exit 0
  → Waiting for next message...`
        },
        {
          description: 'One-shot watch - stop after first message',
          code: 'pd watch deploy:request --once --exec ./scripts/deploy.sh',
          output: `Watching deploy:done (one-shot)...
  → Message received: {"service":"api","version":"1.2.3"}
  → Running ./scripts/deploy.sh
  → Exit 0
  → One-shot complete, exiting.`
        },
        {
          description: 'Watch with inline script',
          code: `pd watch logs:error --exec 'jq .message | mail -s "Error detected" ops@example.com'`,
          output: `Watching logs:error...
  → Message received: {"level":"error","message":"Database connection failed"}
  → Running jq .message | mail -s "Error detected" ops@example.com
  → Exit 0`
        },
        {
          description: 'Message passed to script via environment',
          code: 'pd watch build:done --exec ./scripts/handle-build.sh',
          output: `Watching build:done...
  → Message received: {"sha":"def789","branch":"main"}
  → Running ./scripts/handle-build.sh
  → Script sees: PD_MESSAGE={"sha":"def789","branch":"main"}
  → Script sees: PD_CHANNEL=build:done
  → Exit 0`
        },
        {
          description: 'Auto-reconnect on network issues',
          code: 'pd watch build:done --exec ./scripts/deploy.sh',
          output: `Watching build:done...
  → Connection lost, reconnecting in 5s...
  → Reconnected!
  → Message received: {"sha":"xyz999","status":"success"}
  → Running ./scripts/deploy.sh
  → Exit 0`
        },
      ]}
      seeAlso={[
        { name: 'pd pub', href: '/docs/cli/pub' },
        { name: 'pd msg <channel> get', href: '/docs/cli/msg-get' },
        { name: 'pd channels', href: '/docs/cli/channels' },
        { name: 'pd spawn', href: '/docs/cli/spawn' },
      ]}
    />
  )
}
