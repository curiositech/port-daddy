import { CommandPage } from '@/components/docs/CommandPage'

export default function SubscribeTool() {
  return (
    <CommandPage
      command="subscribe"
      description="Subscribe to a Swarm Radio channel. Returns messages as they arrive via SSE."
      version="3.13.0"
      syntax="subscribe(channel, options?)"
      flags={[
        { flag: 'channel', description: 'Channel name to subscribe to' },
        { flag: 'filter', description: 'Optional message filter (JSON path)' },
        { flag: 'once', description: 'Unsubscribe after first message' },
      ]}
      usagePatterns={[
        'subscribe({ channel: "build:done" })',
        'subscribe({ channel: "build:done", once: true })',
      ]}
      examples={[
        {
          description: 'Subscribe to build notifications',
          code: 'subscribe({ channel: "build:done" })',
          output: `Streaming messages from build:done...\n{ "sha": "abc123", "branch": "main", "status": "success" }\n{ "sha": "def456", "branch": "main", "status": "success" }`
        },
        {
          description: 'Wait for single message',
          code: 'subscribe({ channel: "approval", once: true })',
          output: `{ "approved": true, "approver": "security-team" }`
        },
      ]}
      seeAlso={[
        { name: 'publish_message', href: '/docs/mcp/publish-message' },
        { name: 'watch', href: '/docs/mcp/watch' },
        { name: 'SDK: subscribe()', href: '/docs/sdk/subscribe' },
      ]}
    />
  )
}
