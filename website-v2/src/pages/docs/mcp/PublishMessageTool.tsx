import { CommandPage } from '@/components/docs/CommandPage'

export default function PublishMessageTool() {
  return (
    <CommandPage
      command="publish_message"
      description="Publish a message to a Swarm Radio channel for agent coordination. Other agents subscribed to the channel will receive the message. Supports structured data and priority levels."
      version="3.8.3"
      syntax="publish_message(channel, message, options?)"
      flags={[
        { flag: 'channel', description: 'Channel name to publish to (required)' },
        { flag: 'message', description: 'Message content or structured data (required)' },
        { flag: 'priority', description: "Message priority: 'low', 'normal', 'high', 'urgent' (default: 'normal')" },
        { flag: 'ttl', description: 'Message time-to-live in seconds (optional)' },
      ]}
      usagePatterns={[
        'publish_message({ channel: "builds", message: "Build started" })',
        'publish_message({ channel: "deploys", message: "Deploy complete", priority: "high" })',
        'publish_message({ channel: "alerts", message: { error: "Disk full" }, priority: "urgent" })',
      ]}
      examples={[
        {
          description: 'Simple message to build channel',
          code: 'publish_message({ channel: "builds", message: "TypeScript compilation started" })',
          output: `{
  "success": true,
  "message_id": "msg-abc123",
  "channel": "builds",
  "published_at": "2026-03-16T12:00:00Z"
}`
        },
        {
          description: 'High priority deployment notification',
          code: 'publish_message({ channel: "deploys", message: "Production deployment complete", priority: "high" })',
          output: `{
  "success": true,
  "message_id": "msg-def456",
  "channel": "deploys",
  "priority": "high",
  "published_at": "2026-03-16T12:00:00Z"
}`
        },
        {
          description: 'Structured data message',
          code: `publish_message({
  channel: "metrics",
  message: {
    service: "api",
    cpu_percent: 45.2,
    memory_mb: 512,
    timestamp: "2026-03-16T12:00:00Z"
  }
})`,
          output: `{
  "success": true,
  "message_id": "msg-ghi789",
  "channel": "metrics",
  "published_at": "2026-03-16T12:00:00Z"
}`
        },
        {
          description: 'Urgent alert with TTL',
          code: `publish_message({
  channel: "alerts",
  message: "Database connection pool exhausted",
  priority: "urgent",
  ttl: 300
})`,
          output: `{
  "success": true,
  "message_id": "msg-urgent-001",
  "channel": "alerts",
  "priority": "urgent",
  "expires_at": "2026-03-16T12:05:00Z"
}`
        },
      ]}
      seeAlso={[
        { name: 'begin_session', href: '/docs/mcp/begin-session' },
        { name: 'acquire_lock', href: '/docs/mcp/acquire-lock' },
        { name: 'create_harbor', href: '/docs/mcp/create-harbor' },
        { name: 'CLI: pd pub', href: '/docs/cli/pub' },
      ]}
    />
  )
}
