import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { MessageSquare, Play, Reply, ScrollText, ShieldCheck } from 'lucide-react'

export function PdTube() {
  return (
    <TutorialLayout
      title="PD Tube"
      description="Use Port Daddy channels as a small conversational pipe: listen, send, reply, resume, and feed clean JSON lines into scripts or agents."
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
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <MessageSquare className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">A Conversation Pipe, Not A Chat App</h2>
          </div>
          <p>
            <code>pd tube</code> wraps the daemon&apos;s existing message channels in a tiny thread-aware envelope.
            It is meant for operator-visible agent handoffs: stdout stays scriptable, stderr carries status, and every
            emitted row can be piped into <code>jq</code>, tests, dashboards, or another agent.
          </p>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <Play className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">1. Start With A One-Pass Read</h2>
          </div>
          <p>
            Use <code>--once</code> when you want a deterministic script step. Add <code>--json</code> when another
            process will consume the output.
          </p>
          <CodeBlock language="bash">
            {`pd tube port-daddy:story:coordination --once --json --no-history --limit=5
# Expected result: up to five JSON message envelopes are printed, then the command exits.`}
          </CodeBlock>
        </section>

        <section className="space-y-4">
          <h2 className="m-0">Real Output Recording</h2>
          <p>
            This recording is generated from <code>examples/pd-tube/demo.sh</code> against the live daemon. The matching
            asciinema cast, VHS tape, and GIFs are checked in under <code>demos/pd-tube</code>.
          </p>
          <figure className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)]">
            <img
              src="/demos/pd-tube/pd-tube-real-output.gif"
              alt="Animated terminal recording of PD Tube sending a message, replying, and reading both records back from channel history"
              className="block w-full"
              loading="lazy"
            />
            <figcaption className="border-t border-[var(--border-subtle)] px-4 py-3 text-sm text-[var(--text-muted)]">
              Recorded with asciinema and rendered with agg from real Port Daddy channel history.
            </figcaption>
          </figure>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <Reply className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">2. Send And Reply From Stdin</h2>
          </div>
          <p>
            Tube deliberately reads bodies from stdin. That makes it hard to accidentally hang an interactive terminal
            and easy to connect real tools.
          </p>
          <CodeBlock language="bash">
            {`printf 'Docs patch is ready for review.' \\
  | pd tube port-daddy:story:coordination --send --sender codex
SUCCESS: tube: posted id=42 to port-daddy:story:coordination

printf 'Replying with the generated GIF and cast paths.' \\
  | pd tube port-daddy:story:coordination --reply=42 --sender codex
SUCCESS: tube: posted reply id=43 to port-daddy:story:coordination`}
          </CodeBlock>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <ScrollText className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">3. Resume Without Repeating Yourself</h2>
          </div>
          <p>
            Tube stores a small per-channel cursor under the Port Daddy home directory. Use <code>--since</code> when
            you need an explicit resume point, or <code>--no-history</code> for test fixtures and demos.
          </p>
          <CodeBlock language="bash">
            {`pd tube port-daddy:story:coordination --since=42 --json --once
pd tube port-daddy:story:coordination --no-history --limit=10 --once
# Expected result: the first command resumes after id 42; the second waits only for new messages.`}
          </CodeBlock>
        </section>

        <section className="space-y-4 border-l-4 border-[var(--brand-secondary)] pl-5">
          <div className="flex items-center gap-2 text-[var(--brand-secondary)]">
            <ShieldCheck size={18} />
            <h2 className="m-0 text-xl">Why This Matters</h2>
          </div>
          <p className="m-0">
            Port Daddy coordination becomes inspectable when agents use shared state instead of private vibes. Tube is
            the lightweight lane for that story: messages are persisted by the daemon, threaded by id, readable by
            humans, and safe for scripts.
          </p>
        </section>
      </div>
    </TutorialLayout>
  )
}
