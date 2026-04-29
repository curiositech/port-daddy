import { CommandPage } from '@/components/docs/CommandPage'

export default function PubCommand() {
  return (
    <CommandPage
      command="pd pub / pd sub"
      description="Publish to and subscribe from Port Daddy pub/sub channels. Use channels for role, workflow, and event signals that may have more than one consumer."
      version="3.8.3"
      syntax={`pd pub <channel> <message> [--signal <type>]\npd sub <channel> [-j]`}
      usagePatterns={[
        'pd pub build:done \'{"sha":"abc123","status":"success"}\'',
        'pd pub deploy:request "deploy staging"',
        'pd sub build:done -j',
      ]}
      examples={[
        {
          description: 'Publish a build completion message',
          code: 'pd pub build:done \'{"sha":"abc123","status":"success"}\'',
          output: '[ok] Published to build:done (id: 421)'
        },
        {
          description: 'Subscribe to a channel as JSON',
          code: 'pd sub build:done -j',
          output: '{"sender":"CLI","signal":"report","payload":{"sha":"abc123","status":"success"}}'
        },
        {
          description: 'Trigger a deployment from CI',
          code: `pd pub build:done '\
{
  "sha": "$(git rev-parse HEAD)",
  "branch": "main",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "artifacts": ["dist/api.tar.gz", "dist/web.tar.gz"]
}'`,
          output: `[ok] Published to build:done (id: 422)`
        },
        {
          description: 'Publish from a spawned agent',
          code: 'pd spawn --backend claude --identity myapp:builder -- "Build the project and notify"',
          output: `[pd] Spawned agent myapp:builder (session build-001)
...
> Build complete!
> pd pub build:done '{"sha":"def789","status":"success"}'
[ok] Published to build:done (id: 423)`
        },
      ]}
      seeAlso={[
        { name: 'pd watch', href: '/docs/cli/watch' },
        { name: 'pd inbox', href: '/tutorials/inbox' },
        { name: 'pd channels', href: '/docs/cli/channels' },
      ]}
    />
  )
}
