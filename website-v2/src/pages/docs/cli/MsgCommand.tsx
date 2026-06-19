import { CommandPage } from '@/components/docs/CommandPage'

export default function MsgCommand() {
  return (
    <CommandPage
      command="msg"
      description="Pub/sub messaging via Swarm Radio."
      version="3.13.0"
      syntax="pd msg <channel> <subcommand>"
      subcommands={[
        { name: 'publish <payload>', description: 'Publish a message to a channel', href: '/docs/cli/msg-publish' },
        { name: 'get', description: 'Get all messages in a channel', href: '/docs/cli/msg-get' },
      ]}
      usagePatterns={[
        'pd msg build:done publish \'{"sha": "abc123"}\'',
        'pd msg build:done get',
      ]}
      examples={[
        {
          description: 'Publish a message',
          code: `pd msg build:done publish '{"sha": "abc123"}'`,
          output: `Published to build:done`
        },
        {
          description: 'Get messages',
          code: 'pd msg build:done get',
          output: `[{"sha":"abc123","timestamp":"2026-03-10T..."}]`
        },
      ]}
      seeAlso={[
        { name: 'watch', href: '/docs/cli/watch' },
        { name: 'msg publish', href: '/docs/cli/msg-publish' },
      ]}
    />
  )
}
