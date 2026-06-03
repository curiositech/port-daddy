import { GitFork, ListOrdered, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'
import { CodeBlock } from '@/components/ui/CodeBlock'

/**
 * Follow-on to `TubeShowcase`: the multi-subscriber fan-out shipped in
 * v3.16.2. Several `pd tube CH --tail` listeners with distinct `--as`
 * identities now EACH receive every message on the channel. Previously a
 * single shared per-channel resume cursor meant exactly one listener
 * consumed each message — a race, not a broadcast. The fix namespaces the
 * resume cursor per listener identity, turning the channel into real
 * fan-out instead of an accidental work queue.
 */
export function TubeMultiplexSection() {
  return (
    <section
      id="pd-tube-fan-out"
      className="border-t-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <SwissGrid className="items-start gap-y-[var(--space-7)]">
          <SwissGridItem span="narrow">
            <div className="sticky top-28 space-y-[var(--space-5)]">
              <BracketLabel>New in v3.16.2</BracketLabel>
              <SectionIntro
                eyebrow="pd tube · fan-out"
                title="One channel. Many listeners. Every message."
                description="Point several agents at the same channel and each one receives every message — not one-of-N. A broadcaster sends once; three listeners on three different identities all wake up. The channel is a fan-out, not a queue."
                titleAs="h2"
              />
              <div className="space-y-[var(--space-3)] text-[var(--text-muted)]">
                <p>
                  Earlier builds shared a single resume cursor per channel, so two{' '}
                  <code>--tail</code> listeners raced for the same message and only one won it. The
                  cursor is now namespaced per listener identity (the <code>--as</code> value), so
                  every distinct listener keeps its own place in the stream.
                </p>
                <p>
                  That is the difference between a standup bot that pings one teammate at random and
                  one that reaches the whole room. Nothing in the publisher changes — still a plain{' '}
                  <code>POST</code> of JSON.
                </p>
              </div>
              <div className="flex flex-wrap gap-[var(--space-3)] pt-[var(--space-2)]">
                <Link
                  to="/pd-tube"
                  className="inline-flex items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
                >
                  Explore pd tube
                </Link>
                <Link
                  to="/docs/cli/tube"
                  className="inline-flex items-center gap-2 border-2 border-transparent px-4 py-2 text-sm font-medium text-[var(--text-muted)] underline decoration-[var(--border-strong)] decoration-2 underline-offset-4 hover:text-[var(--text-primary)]"
                >
                  Read the docs
                </Link>
              </div>
            </div>
          </SwissGridItem>

          <SwissGridItem span="wide" className="space-y-[var(--space-6)]">
            <SurfacePanel className="overflow-hidden">
              <PanelEyebrow className="mb-[var(--space-2)]">Three listeners, one broadcast</PanelEyebrow>
              <PanelTitle as="h3" className="mb-[var(--space-4)]">
                Each <code>--as</code> identity gets its own copy
              </PanelTitle>
              <PanelBody className="mb-[var(--space-4)] max-w-[52ch]">
                Start three listeners on <code>standup:demo</code>, each with a different identity.
                Send one message. All three print it — and each keeps its own resume cursor, so a
                listener that reconnects picks up exactly where it left off without stealing the
                others&rsquo; backlog.
              </PanelBody>
              <CodeBlock language="bash" filename="four terminals" copyable={false}>
                {`# Terminal 1 — first subscriber
$ pd tube standup:demo --tail --as you

# Terminal 2 — second subscriber
$ pd tube standup:demo --tail --as claude-code

# Terminal 3 — third subscriber
$ pd tube standup:demo --tail --as gardener-bot

# Terminal 4 — broadcaster sends once
$ pd tube standup:demo --send "Standup in 5. Post blockers."
SUCCESS: tube: posted id=87 to standup:demo

# id=87 now prints in ALL THREE listener terminals — fan-out, not one-of-N.`}
              </CodeBlock>
            </SurfacePanel>

            <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <img
                src="/demos/pd-tube/pd-tube-multiplex.gif"
                alt="Animated terminal recording: a broadcaster sends one message to a channel and three pd tube subscribers, each on a distinct --as identity, all receive the same message"
                className="block w-full"
                loading="lazy"
              />
              <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-sm text-[var(--text-muted)]">
                One broadcaster, three subscribers on distinct <code>--as</code> identities. The
                single message fans out to all three terminals — the behavior shipped in v3.16.2.
              </figcaption>
            </figure>

            <div className="grid gap-[var(--space-4)] md:grid-cols-3">
              <BehaviorCard
                icon={GitFork}
                title="Fan-out, not a queue"
                body="One message reaches every listener on the channel. Adding a subscriber never starves the others — there is no single consumer competing for each event."
              />
              <BehaviorCard
                icon={ListOrdered}
                title="Per-listener cursor"
                body={
                  <>
                    The resume cursor is keyed on the listener&rsquo;s <code>--as</code> identity,
                    not the channel. Each subscriber tracks its own position in the stream
                    independently.
                  </>
                }
              />
              <BehaviorCard
                icon={RotateCcw}
                title="Resumes per identity"
                body="A listener that drops and reconnects with the same identity picks up exactly where it left off — without consuming the backlog meant for anyone else."
              />
            </div>
          </SwissGridItem>
        </SwissGrid>
      </PageContainer>
    </section>
  )
}

function BehaviorCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof GitFork
  title: string
  body: ReactNode
}) {
  return (
    <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
      <div className="mb-[var(--space-2)] flex items-center gap-2 text-[var(--brand-primary)]">
        <Icon size={18} />
        <span className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
          Behavior
        </span>
      </div>
      <PanelTitle as="h4" className="mb-[var(--space-2)] text-base">
        {title}
      </PanelTitle>
      <PanelBody className="text-sm">{body}</PanelBody>
    </div>
  )
}
