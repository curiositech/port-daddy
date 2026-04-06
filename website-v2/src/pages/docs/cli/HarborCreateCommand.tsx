import { CommandPage } from '@/components/docs/CommandPage'

export default function HarborCreateCommand() {
  return (
    <CommandPage
      command="pd harbor create"
      description="Create a permission namespace for a group of agents. Agents inside a harbor receive a signed JWT that proves what they are allowed to do. Harbors provide scoped, time-bound capabilities for secure multi-agent workflows."
      version="3.8.3"
      syntax="pd harbor create <name> [flags]"
      flags={[
        { flag: '--cap <scopes>', description: 'Comma-separated capability scopes' },
        { flag: '--ttl <duration>', description: 'Token TTL (e.g. 2h, 30m). Default 2h' },
      ]}
      usagePatterns={[
        'pd harbor create myapp:security-review --cap "code:read,notes:write"',
        'pd harbor create myapp:deployment --cap "tunnel:create,msg:publish" --ttl 1h',
        'pd harbor create myapp:coding --cap "code:read,code:write,notes:write,lock:acquire,file:claim" --ttl 4h',
      ]}
      examples={[
        {
          description: 'Create a harbor for security audits',
          code: 'pd harbor create myapp:security-review \\\n  --cap "code:read,notes:write,tunnel:create" \\\n  --ttl 2h',
          output: `Harbor created: myapp:security-review
  Capabilities: code:read, notes:write, tunnel:create
  Token TTL: 2h`
        },
        {
          description: 'Create a harbor with minimal permissions',
          code: 'pd harbor create myapp:readonly --cap "code:read" --ttl 30m',
          output: `Harbor created: myapp:readonly
  Capabilities: code:read
  Token TTL: 30m`
        },
        {
          description: 'Create a full-access development harbor',
          code: 'pd harbor create myapp:dev \\\n  --cap "code:read,notes:write,lock:acquire,tunnel:create,msg:publish,msg:subscribe,file:claim,spawn:agents" \\\n  --ttl 8h',
          output: `Harbor created: myapp:dev
  Capabilities: code:read, notes:write, lock:acquire, tunnel:create, msg:publish, msg:subscribe, file:claim, spawn:agents
  Token TTL: 8h`
        },
        {
          description: 'Available capability scopes',
          code: 'pd harbor create --help',
          output: `Capability scopes:
  code:read       - Read source files and session notes within the harbor
  notes:write     - Write session notes inside the harbor
  lock:acquire    - Acquire distributed locks within the harbor
  tunnel:create   - Create tunnels scoped to the harbor
  msg:publish     - Publish to pub/sub channels in the harbor
  msg:subscribe   - Subscribe to pub/sub channels in the harbor
  file:claim      - Claim files in the harbor workspace
  spawn:agents    - Spawn child agents inside the harbor`
        },
      ]}
      seeAlso={[
        { name: 'pd harbor enter', href: '/docs/cli/harbor-enter' },
        { name: 'pd harbor leave', href: '/docs/cli/harbor-leave' },
        { name: 'pd harbors', href: '/docs/cli/harbors' },
        { name: 'pd spawn', href: '/docs/cli/spawn' },
      ]}
    />
  )
}
