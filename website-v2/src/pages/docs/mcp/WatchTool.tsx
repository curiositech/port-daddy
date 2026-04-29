import { CommandPage } from '@/components/docs/CommandPage'

export default function WatchTool() {
  return (
    <CommandPage
      command="watch"
      description="Subscribe to a channel and run a script on every message. Uses SSE for real-time delivery. Auto-reconnects on disconnect. This is the always-on agent primitive."
      version="3.11.0"
      syntax="watch(channel, options?)"
      flags={[
        { flag: 'channel', description: 'Channel to watch' },
        { flag: 'exec', description: 'Script to run on each message' },
        { flag: 'once', description: 'Stop after first message (default: false)' },
      ]}
      usagePatterns={[
        'watch({ channel: "build:done", exec: "./scripts/deploy.sh" })',
        'watch({ channel: "approval", once: true })',
      ]}
      examples={[
        {
          description: 'Watch and deploy on build completion',
          code: 'watch({\n  channel: "build:done",\n  exec: "./scripts/deploy.sh"\n})',
          output: `Watching build:done...\n  → Message received: { "sha": "abc123" }\n  → Running ./scripts/deploy.sh\n  → Exit 0`
        },
        {
          description: 'Wait for approval',
          code: 'watch({ channel: "approval", once: true })',
        },
      ]}
      seeAlso={[
        { name: 'subscribe', href: '/docs/mcp/subscribe' },
        { name: 'publish_message', href: '/docs/mcp/publish-message' },
        { name: 'SDK: watch()', href: '/docs/sdk/watch' },
      ]}
    />
  )
}
