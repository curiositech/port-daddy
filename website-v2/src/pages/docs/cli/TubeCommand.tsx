import { CommandPage } from '@/components/docs/CommandPage'

export default function TubeCommand() {
  return (
    <CommandPage
      command="pd tube"
      description="The single command that turns any local UI, hook, or webhook into an event your running agent can answer in one shell call. Listen mode blocks once and returns; --reply auto-correlates to the most recent foreign event and continues listening."
      version="3.13.0"
      syntax="pd tube <channel> [--reply <body> | --reply-to=<id> | --reply=<id> --send | --send <body> | --raw | --json | --once | --tail | --wait-for=<seconds> | --no-history | --since=<id> | --limit=<N> | --sender <id>]"
      usagePatterns={[
        'pd tube ui:clicks',
        'pd tube ui:clicks --reply "Deployed to staging."',
        'echo "long body" | pd tube ui:clicks --reply -',
        'pd tube ui:clicks --send "shipping it"',
        'pd tube ui:clicks --json --once',
        'pd tube ui:clicks --tail',
      ]}
      flags={[
        {
          flag: '--reply <body>',
          description:
            'Inline reply: auto-correlates to the most recent foreign event on this channel, posts the body, then continues listening. Pass `-` to read body from stdin.',
        },
        {
          flag: '--reply-to=<id>',
          description:
            'Explicit parent id for a threaded reply. Combine with `--reply <body>` or pipe stdin.',
        },
        {
          flag: '--reply=<id> --send',
          description:
            'Legacy post-and-exit shape. Numeric parent id; body comes from stdin. Posts a threaded reply and exits.',
        },
        {
          flag: '--send <body>',
          description:
            'Top-level message (no inReplyTo). Inline body or pipe stdin. Posts and exits.',
        },
        {
          flag: '--raw',
          description:
            'Tab-separated machine output (`id\\tsender[ ↩parent]\\tbody`). Default output is the prose crank-handle block.',
        },
        { flag: '--json', description: 'One JSON line per emitted message.' },
        {
          flag: '--once',
          description: 'Single poll-pass: emit current backlog, exit. No blocking, no waiting.',
        },
        {
          flag: '--tail',
          description: 'Classic infinite loop. For humans watching a terminal.',
        },
        {
          flag: '--wait-for=<seconds>',
          description: 'How long to block waiting for the first event. Default 600.',
        },
        {
          flag: '--since=<id>',
          description: 'Only emit messages with ids greater than the given cursor.',
        },
        {
          flag: '--limit=<N>',
          description: 'Cap on initial backfill when no cursor exists. Default 50.',
        },
        {
          flag: '--no-history',
          description: 'Bypass the per-channel cursor file for fixtures, tests, and demos.',
        },
        {
          flag: '--sender <id>',
          description:
            'Override the synthesized listener identity (default `pd-tube/<cwd-basename>/<channel-slug>`).',
        },
      ]}
      examples={[
        {
          description:
            'Block until the next event arrives, print the prose block, exit. The agent’s default loop shape.',
          code: 'pd tube ui:clicks',
          output:
            'tube waiting on ui:clicks as pd-tube/myapp/ui_clicks (up to 600s; Ctrl+C to exit)\n\n──── event id=42 · channel ui:clicks ────\nFrom: web-demo · 2026-04-30T22:01:11.000Z\nBody:\n  {"button":"deploy-staging","user":"erich"}\n\nAct on the event above, then post your response by running:\n\n    pd tube ui:clicks --reply "your response here"\n\nThat command posts a reply correlated to id=42 AND continues\nlistening. Use --raw / --json for machine output. Ctrl+C to exit.\n──────────────────────────────────────',
        },
        {
          description: 'Inline reply: auto-correlates to id=42 above, posts, keeps listening.',
          code: 'pd tube ui:clicks --reply "Deployed to staging. CI is green."',
          output:
            'SUCCESS: tube: posted id=43 to ui:clicks\ntube waiting on ui:clicks as pd-tube/myapp/ui_clicks (up to 600s; Ctrl+C to exit)',
        },
        {
          description: 'Machine output: one JSON line per message, single pass.',
          code: 'pd tube ui:clicks --json --once',
          output:
            '{"id":42,"sender":"web-demo","createdAt":1714519871000,"body":"{\\"button\\":\\"deploy-staging\\"}"}',
        },
        {
          description: 'Explicit-parent shape: post a reply to id=42 from stdin.',
          code: 'printf "roger that" | pd tube ui:clicks --reply-to=42 --sender codex',
          output: 'SUCCESS: tube: posted id=43 to ui:clicks',
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
