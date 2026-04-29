import { CommandPage } from '@/components/docs/CommandPage'

export default function TubeCommand() {
  return (
    <CommandPage
      command="pd tube"
      description="Open a scriptable conversation pipe over a Port Daddy channel. Listen mode emits one message per line; send and reply modes read the body from stdin."
      version="3.11.0"
      syntax="pd tube <channel> [--send | --reply=<id> | --since=<id> | --once | --json | --no-history]"
      usagePatterns={[
        'pd tube project:handoff --once --json',
        'printf "ready" | pd tube project:handoff --send --sender qa',
        'printf "fixed" | pd tube project:handoff --reply=42 --sender codex',
      ]}
      flags={[
        { flag: '--send', description: 'Read stdin to EOF and publish a top-level tube message.' },
        { flag: '--reply=<id>', description: 'Read stdin to EOF and publish a threaded reply to an existing message id.' },
        { flag: '--once', description: 'Perform one read pass and exit instead of polling continuously.' },
        { flag: '--since=<id>', description: 'Only emit messages with ids greater than the given cursor.' },
        { flag: '--json', description: 'Emit clean JSON lines for scripts and agents.' },
        { flag: '--no-history', description: 'Bypass the per-channel cursor file for fixtures, tests, and demos.' },
      ]}
      examples={[
        {
          description: 'Read recent messages as JSON lines',
          code: 'pd tube port-daddy:story:coordination --once --json --no-history --limit=5',
          output: '{"id":30083,"sender":"codex-pr5","createdAt":1777422337428,"body":"Port Daddy coordination story: agents do not just promise to be careful..."}',
        },
        {
          description: 'Send a handoff from stdin',
          code: 'printf "Docs patch is ready." | pd tube port-daddy:story:coordination --send --sender codex',
          output: 'tube: posted id=30084 to port-daddy:story:coordination',
        },
        {
          description: 'Reply to an existing message',
          code: 'printf "GIF and cast are attached in demos/pd-tube." | pd tube port-daddy:story:coordination --reply=30083 --sender codex',
          output: 'tube: posted id=30085 to port-daddy:story:coordination',
        },
        {
          description: 'Resume from an explicit cursor',
          code: 'pd tube port-daddy:story:coordination --since=30083 --json --once',
          output: '{"id":30084,"sender":"codex","createdAt":1777422400123,"body":"Docs patch is ready."}',
        },
      ]}
      seeAlso={[
        { name: 'pd pub', href: '/docs/cli/pub' },
        { name: 'pd watch', href: '/docs/cli/watch' },
        { name: 'PD Tube tutorial', href: '/tutorials/pd-tube' },
      ]}
    />
  )
}
