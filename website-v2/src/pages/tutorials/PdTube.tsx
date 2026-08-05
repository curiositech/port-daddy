import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import {
  CornerDownRight,
  MessageSquare,
  Play,
  Radio,
  Reply,
  ScrollText,
  ShieldCheck,
  Wand2,
} from 'lucide-react'

export function PdTube() {
  return (
    <TutorialLayout
      title="PD Tube"
      description="The single command that turns any local UI, hook, or webhook into an event your running agent can answer in one shell call. Block-once-and-return makes the agent loop work."
      number={21}
      total={21}
      level="Intermediate"
      readTime="9 min read"
      prev={{ title: 'Walk the 11 Product Primitives', href: '/tutorials/primitives' }}
      next={undefined}
    >
      <div className="space-y-12">
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <MessageSquare className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">A Conversation Pipe, Not A Chat App</h2>
          </div>
          <p>
            <code>pd tube</code> wraps the daemon&apos;s message channels in a tiny thread-aware
            envelope. It is meant for operator-visible agent handoffs: a single command both delivers
            a reply <em>and</em> blocks for the next event. That is what makes the agent loop work:
            every invocation returns, the bash tool yields, the model decides what to reply, and the
            next call posts the answer.
          </p>
          <p>
            Publishers stay simple. Any process that can <code>POST</code> JSON to{' '}
            <code>/msg/&lt;channel&gt;</code> can summon the agent — no SDK, no MCP server, no
            websocket plumbing.
          </p>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Radio className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">1. Listen — Block Once, Return On First Event</h2>
          </div>
          <p>
            The default mode of <code>pd tube</code> blocks until a new event arrives, prints a
            single &quot;crank-handle&quot; prose block telling the agent how to reply, and exits.
            The bash tool yields control. The model reads the block, does work, and runs the
            suggested command on the next turn.
          </p>
          <CodeBlock language="bash">
            {`$ pd tube ui:clicks
INFO: tube waiting on ui:clicks as pd-tube/myapp/ui_clicks (up to 600s; Ctrl+C to exit)

──── event id=42 · channel ui:clicks ────
From: web-demo · 2026-04-30T22:01:11.000Z
Body:
  {"button":"deploy-staging","user":"erich"}

Act on the event above, then post your response by running:

    pd tube ui:clicks --reply "your response here"

That command posts a reply correlated to id=42 AND continues
listening. Use --raw / --json for machine output. Ctrl+C to exit.
──────────────────────────────────────`}
          </CodeBlock>
          <p>
            If no event arrives within <code>--wait-for=&lt;seconds&gt;</code> (default{' '}
            <code>600</code>), the call exits cleanly so the agent can loop without tripping a
            sandbox timeout.
          </p>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Reply className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">2. Reply Inline — One Command, Both Jobs</h2>
          </div>
          <p>
            The killer shape: <code>--reply &quot;body&quot;</code> takes a body directly,
            auto-correlates to the most recent event from someone else, posts the reply, and{' '}
            <em>then keeps listening</em>. The agent never has to remember an event id.
          </p>
          <CodeBlock language="bash">
            {`$ pd tube ui:clicks --reply "Deployed to staging. CI is green."
SUCCESS: tube: posted id=43 to ui:clicks
tube waiting on ui:clicks as pd-tube/myapp/ui_clicks (up to 600s; Ctrl+C to exit)
…blocks for the next event…`}
          </CodeBlock>
          <p>
            Auto-correlation works because <code>pd tube</code> tracks{' '}
            <code>lastForeignEventId</code> in the per-channel cursor. Messages whose sender matches
            the listener&apos;s synthesized identity (<code>pd-tube/&lt;cwd&gt;/&lt;channel&gt;</code>
            ) are filtered from the &quot;foreign event&quot; pointer so the listener never replies
            to itself.
          </p>
          <p>
            For long replies, pipe stdin: <code>echo &quot;long body&quot; | pd tube ch --reply -</code>
            . For explicit threading, pass the parent id with <code>--reply-to</code>:
          </p>
          <CodeBlock language="bash">
            {`# Explicit parent + stdin body.
$ printf 'roger that' | pd tube ui:clicks --reply-to=42 --sender codex
SUCCESS: tube: posted id=43 to ui:clicks`}
          </CodeBlock>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Wand2 className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">3. Output Modes — Prose, Raw, JSON</h2>
          </div>
          <p>
            Default output is the prose block. For machines, use <code>--json</code> (one JSON line
            per message) or <code>--raw</code> (tab-separated{' '}
            <code>id&nbsp;\t&nbsp;sender[&nbsp;↩parent]&nbsp;\t&nbsp;body</code>; the{' '}
            <code>↩parent</code> suffix on the sender column appears only on replies). For humans
            watching a terminal long-term, <code>--tail</code> keeps the polling loop alive instead
            of returning on first event.
          </p>
          <CodeBlock language="bash">
            {`$ pd tube ui:clicks --json --once
# Output:
{"id":42,"sender":"web-demo","createdAt":1714519871000,"body":"{\\"button\\":\\"deploy-staging\\"}"}

$ pd tube ui:clicks --raw --once
# Output:
42	web-demo	{"button":"deploy-staging"}
43	agent ↩42	shipping it

$ pd tube ui:clicks --tail
INFO: tailing ui:clicks; every new event prints as prose until Ctrl+C.`}
          </CodeBlock>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <CornerDownRight className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">4. The Smallest Useful Publisher</h2>
          </div>
          <p>
            Any process that can <code>fetch()</code> can fire an event. The browser side of the
            checked-in <code>examples/pd-tube</code> demo is just this:
          </p>
          <CodeBlock language="html">
            {`<button id="deploy">Deploy to staging</button>
<div id="reply"></div>
<script>
  const PD_URL = window.location.pathname.startsWith('/fleet-ui')
    ? ''
    : new URLSearchParams(location.search).get('daemon') ?? window.__PORT_DADDY_URL__
  if (!PD_URL && !window.location.pathname.startsWith('/fleet-ui')) {
    throw new Error('Choose a daemon endpoint or open this page inside the embedded dashboard.')
  }
  document.getElementById('deploy').onclick = async () => {
    await fetch(PD_URL ? new URL('/msg/ui:clicks', PD_URL) : '/msg/ui:clicks', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        payload: { button: 'deploy-staging', user: 'erich' },
      }),
    });
    // Poll the same channel for the agent's reply (envelope.inReplyTo).
    pollForReply();
  };
</script>`}
          </CodeBlock>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Play className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">5. Real Output Recording</h2>
          </div>
          <p>
            The recording below comes from <code>examples/pd-tube/demo.sh</code> hitting the live
            daemon. The matching asciinema cast and VHS tape are checked in under{' '}
            <code>demos/pd-tube</code>.
          </p>
          <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
            <img
              src="/demos/pd-tube/pd-tube-real-output.gif"
              alt="Animated terminal recording of pd tube sending a message, replying, and reading both records back from channel history"
              className="block w-full"
              loading="lazy"
            />
            <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-sm text-[var(--text-muted)]">
              Recorded with asciinema and rendered with agg from real Port Daddy channel history.
            </figcaption>
          </figure>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <ScrollText className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">6. Resume Without Repeating Yourself</h2>
          </div>
          <p>
            Tube stores a small per-channel cursor under the Port Daddy home directory. It tracks
            both <code>lastSeenId</code> (so the next call doesn&apos;t re-emit messages you already
            saw) and <code>lastForeignEventId</code> (so <code>--reply &quot;body&quot;</code> knows
            who to thread). Use <code>--since</code> for an explicit resume, or{' '}
            <code>--no-history</code> for test fixtures and demos.
          </p>
          <CodeBlock language="bash">
            {`$ pd tube ui:clicks --since=42 --json --once
{"id":43,"sender":"agent","inReplyTo":42,"body":"shipping it"}

$ pd tube ui:clicks --no-history --limit=10 --once
INFO: history skipped; waiting for the next live event only`}
          </CodeBlock>
        </section>

        <section className="space-y-4 border-l-4 border-[var(--brand-secondary)] pl-5">
          <div className="flex items-center gap-2 text-[var(--brand-secondary)]">
            <ShieldCheck size={18} />
            <h2 className="m-0 text-xl">Why This Matters</h2>
          </div>
          <p className="m-0">
            The trick is the single command that does both jobs. An agent in any tool-use loop
            (Claude Code, Cursor, Aider, your own bash wrapper) can now be summoned by any process
            that emits HTTP — editor extensions, test reporters, git hooks, browser pages, Slack
            bridges, Jupyter cells, IoT buttons. The agent that&apos;s already running is the
            backend. Port Daddy is the event bus your local agent was missing.
          </p>
        </section>
      </div>
    </TutorialLayout>
  )
}
