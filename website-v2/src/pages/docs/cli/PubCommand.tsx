import { CommandPage } from '@/components/docs/CommandPage'

export default function PubCommand() {
  return (
    <CommandPage
      command="pd pub"
      shortFlag="pd msg <channel> publish"
      description="Publish a message to a pub/sub channel. All subscribers receive it in real-time. This is the core messaging primitive for agent coordination, enabling event-driven workflows between agents."
      version="3.8.3"
      syntax="pd msg <channel> publish <payload>"
      usagePatterns={[
        'pd msg build:done publish \'{...}\'',
        'pd msg deploy:request publish \'{...}\'',
        'pd msg test:complete publish \'{"status": "passed"}\'',
      ]}
      examples={[
        {
          description: 'Publish a build completion message',
          code: 'pd msg build:done publish \'{"sha": "abc123", "status": "success"}\'',
          output: 'Published to build:done'
        },
        {
          description: 'Publish with full metadata',
          code: 'pd msg deploy:request publish \'{"service": "api", "version": "1.2.3", "environment": "staging"}\'',
          output: 'Published to deploy:request'
        },
        {
          description: 'Trigger a deployment from CI',
          code: `pd msg build:done publish '\
{
  "sha": "$(git rev-parse HEAD)",
  "branch": "main",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "artifacts": ["dist/api.tar.gz", "dist/web.tar.gz"]
}'`,
          output: `Published to build:done`
        },
        {
          description: 'Publish from a spawned agent',
          code: 'pd spawn --backend claude --identity myapp:builder -- "Build the project and notify"',
          output: `[pd] Spawned agent myapp:builder (session build-001)
...
> Build complete!
> pd msg build:done publish '{"sha": "def789", "status": "success"}'
Published to build:done`
        },
        {
          description: 'Messages persist and can be retrieved',
          code: 'pd msg build:done get --limit 3',
          output: `[
  {"sha":"def789","status":"success","timestamp":"2026-03-16T12:05:00Z"},
  {"sha":"abc456","status":"success","timestamp":"2026-03-16T11:45:00Z"},
  {"sha":"abc123","status":"failed","timestamp":"2026-03-16T11:30:00Z"}
]`
        },
      ]}
      seeAlso={[
        { name: 'pd watch', href: '/docs/cli/watch' },
        { name: 'pd msg <channel> get', href: '/docs/cli/msg-get' },
        { name: 'pd channels', href: '/docs/cli/channels' },
      ]}
    />
  )
}
