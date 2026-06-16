import { GitFork, ListOrdered, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
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
 * Follow-on to `TubeShowcase`: point several agents at one channel and every
 * agent gets every message. Each listener keeps its own bookmark in the
 * stream, keyed on its `--as` name, so reconnecting picks up where it left off.
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
              <SectionIntro
                eyebrow="pd tube · fan-out"
                title="One channel. Many listeners. Every message."
                description="Point several agents at one channel. Every listener gets every message, instead of one listener grabbing each message. Send once; three listeners all wake up."
                titleAs="h2"
              />
              <div className="space-y-[var(--space-3)] text-[length:var(--text-base)] text-[var(--text-muted)]">
                <p>
                  Each listener keeps its own bookmark in the stream, keyed on its{' '}
                  <code>--as</code> name. Two <code>--tail</code> listeners no longer race for the
                  same message. Both read it. Each remembers its own place.
                </p>
                <p>
                  Think of a standup bot that pings one teammate at random, versus one that reaches
                  the whole room. Sending stays the same: a plain <code>POST</code> of JSON.
                </p>
              </div>
              <div className="flex flex-wrap gap-[var(--space-3)] pt-[var(--space-2)]">
                <Link
                  to="/pd-tube"
                  className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-base)] font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
                >
                  Explore pd tube
                </Link>
                <Link
                  to="/docs/cli/tube"
                  className="inline-flex items-center gap-[var(--space-2)] border-2 border-transparent px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-base)] font-medium text-[var(--text-muted)] underline decoration-[var(--border-strong)] decoration-2 underline-offset-4 hover:text-[var(--text-primary)]"
                >
                  Read the docs
                </Link>
              </div>
            </div>
          </SwissGridItem>

          <SwissGridItem span="wide" className="space-y-[var(--space-6)]">
            <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <img
                src="/img/generated/tube-multiplex/multiscreen-fanout.png"
                alt="Blueprint diagram: one POST to /msg/standup:demo fans out to three tiled console screens, each running pd tube on a distinct --as name (alice, bob, carol), while a FleetBar menu-bar panel shows the channel with 3 listeners."
                className="block w-full"
                loading="lazy"
              />
              <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-base)] text-[var(--text-muted)]">
                One <code>POST</code> reaches three screens at once. FleetBar shows the same channel
                and who is listening.
              </figcaption>
            </figure>

            <SurfacePanel className="overflow-hidden">
              <PanelEyebrow className="mb-[var(--space-2)]">Three listeners, one broadcast</PanelEyebrow>
              <PanelTitle as="h3" className="mb-[var(--space-4)]">
                Each <code>--as</code> name gets its own copy
              </PanelTitle>
              <PanelBody className="mb-[var(--space-4)] max-w-[52ch]">
                Start three listeners on <code>standup:demo</code>, each with a different name. Send
                one message. All three print it. Each keeps its own bookmark, so a listener that
                reconnects resumes where it stopped without eating the others&rsquo; backlog.
              </PanelBody>
              <CodeBlock language="bash" filename="four terminals" copyable={false}>
                {`# Terminal 1 — first listener
$ pd tube standup:demo --tail --as you

# Terminal 2 — second listener
$ pd tube standup:demo --tail --as claude-code

# Terminal 3 — third listener
$ pd tube standup:demo --tail --as gardener-bot

# Terminal 4 — send once
$ pd tube standup:demo --send "Standup in 5. Post blockers."
SUCCESS: tube: posted id=87 to standup:demo

# id=87 now prints in ALL THREE listener terminals.`}
              </CodeBlock>
            </SurfacePanel>

            <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <img
                src="/demos/pd-tube/pd-tube-multiplex.gif"
                alt="Animated terminal recording: one message sent to a channel, and three pd tube listeners each on a distinct --as name all receive the same message"
                className="block w-full"
                loading="lazy"
              />
              <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-base)] text-[var(--text-muted)]">
                One message, three listeners on distinct <code>--as</code> names. The message fans
                out to all three terminals.
              </figcaption>
            </figure>

            <div className="grid gap-[var(--space-4)] md:grid-cols-3">
              <BehaviorCard
                icon={GitFork}
                title="Fan-out, not a queue"
                body="One message reaches every listener. Adding a listener never starves the others, because no single consumer competes for each message."
              />
              <BehaviorCard
                icon={ListOrdered}
                title="Per-listener bookmark"
                body={
                  <>
                    Each listener keeps its own bookmark, keyed on its <code>--as</code> name, not
                    on the channel. Everyone tracks their own place in the stream.
                  </>
                }
              />
              <BehaviorCard
                icon={RotateCcw}
                title="Resumes per name"
                body="A listener that drops and reconnects with the same --as name picks up where it left off, without eating the backlog meant for anyone else."
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
      <div className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[var(--brand-primary)]">
        <Icon size={18} />
        <span className="text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
          Behavior
        </span>
      </div>
      <PanelTitle as="h4" className="mb-[var(--space-2)] text-[length:var(--type-panel-title-card-size)]">
        {title}
      </PanelTitle>
      <PanelBody size="compact">{body}</PanelBody>
    </div>
  )
}
