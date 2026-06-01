import { ArrowRight, GitFork, Radio, Reply } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Footer } from '@/components/layout/Footer'
import { CodeBlock } from '@/components/ui/CodeBlock'
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

/**
 * Standalone feature page for `pd tube` at /pd-tube. Covers what the
 * command is, the event -> agent reply loop, and the multi-subscriber
 * fan-out shipped in v3.16.2 (distinct `--as` identities each receive
 * every message). Links out to the CLI docs, the tutorial, and the post.
 */
export function PdTubePage() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content">
        {/* Hero */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-center">
              <SwissGridItem span="wide">
                <div className="space-y-[var(--space-5)]">
                  <BracketLabel>pd tube</BracketLabel>
                  <PanelTitle as="h1" size="hero" className="max-w-[16ch]">
                    The event bus your local agent was missing.
                  </PanelTitle>
                  <PanelBody className="max-w-[46rem] text-[length:var(--text-lg)]">
                    <code>pd tube</code> turns any local UI, hook, test runner, or webhook into an
                    event the agent already running in your project can answer — in a single shell
                    call. No SDK, no MCP server, no websocket dance. As of v3.16.2 the same channel
                    fans out to many listeners at once: distinct <code>--as</code> identities each
                    receive every message.
                  </PanelBody>
                  <div className="flex flex-wrap gap-[var(--space-3)]">
                    <Button asChild variant="primary" size="lg">
                      <Link to="/docs/cli/tube">
                        Read the CLI reference
                        <ArrowRight size={16} />
                      </Link>
                    </Button>
                    <Button asChild variant="secondary" size="lg">
                      <Link to="/tutorials/pd-tube">Walk the tutorial</Link>
                    </Button>
                  </div>
                </div>
              </SwissGridItem>

              <SwissGridItem span="narrow">
                <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-3)]">
                  <PanelEyebrow>The whole protocol</PanelEyebrow>
                  <CodeBlock language="bash" filename="agent terminal" copyable>
                    {`# 1. Agent listens
$ pd tube ui:clicks

# 2. A button POSTs JSON to /msg/ui:clicks
#    -> the agent wakes with the event

# 3. Agent does the work, then replies
$ pd tube ui:clicks --reply "Deployed to staging."`}
                  </CodeBlock>
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        {/* The event -> agent loop */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="The loop"
              title="A publisher speaks. The agent answers. Both in one call."
              description="Any process that can POST JSON to /msg/<channel> can summon the agent. The agent runs pd tube in a loop: each invocation blocks for the next event, prints a prose block telling the model exactly how to respond, and returns — which is what lets the model take its turn and post a reply."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] md:grid-cols-3">
              <FeatureCard
                icon={Radio}
                title="Block, then return"
                body="Default mode blocks until the next event, prints the prose crank-handle block, and exits. The agent's bash tool yields so the model can take the next turn."
              />
              <FeatureCard
                icon={Reply}
                title="Inline --reply"
                body={
                  <>
                    <code>pd tube ch --reply &quot;done&quot;</code> auto-correlates to the most recent
                    foreign event, posts the reply, and keeps listening. One command, both jobs.
                  </>
                }
              />
              <FeatureCard
                icon={GitFork}
                title="Fan-out to many"
                body="Distinct --as identities each receive every message on the channel. One broadcast reaches the whole room, not one listener at random."
              />
            </div>
          </PageContainer>
        </section>

        {/* Multi-subscriber fan-out */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-start gap-y-[var(--space-7)]">
              <SwissGridItem span="narrow">
                <div className="space-y-[var(--space-5)]">
                  <BracketLabel>New in v3.16.2</BracketLabel>
                  <SectionIntro
                    eyebrow="Multi-subscriber"
                    title="One channel. Many listeners. Every message."
                    description="Earlier builds shared a single resume cursor per channel, so two --tail listeners raced for each message and only one won it. The cursor is now namespaced per listener identity, so every distinct --as subscriber keeps its own place in the stream and receives every message."
                    titleAs="h2"
                    titleSize="display"
                  />
                  <PanelBody className="text-[var(--text-muted)]">
                    Nothing changes for the publisher. The same plain <code>POST</code> now reaches
                    a standup bot, a notifier, and a logger simultaneously — all on the same
                    channel, each on its own identity.
                  </PanelBody>
                </div>
              </SwissGridItem>

              <SwissGridItem span="wide" className="space-y-[var(--space-6)]">
                <SurfacePanel className="overflow-hidden">
                  <PanelEyebrow className="mb-[var(--space-2)]">Three listeners, one broadcast</PanelEyebrow>
                  <PanelTitle as="h3" className="mb-[var(--space-4)]">
                    Each <code>--as</code> identity gets its own copy
                  </PanelTitle>
                  <CodeBlock language="bash" filename="four terminals" copyable>
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
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        {/* Get started / links */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Get started"
              title="Copy a command and point it at a channel."
              description="The substrate is the SQLite-backed channel system Port Daddy already ships. Pick a channel name, run pd tube, and wire any publisher you like."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-2">
              <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-3)]">
                <PanelEyebrow>Listen</PanelEyebrow>
                <CodeBlock language="bash" filename="listen" copyable>
                  {`pd tube ui:clicks --tail --as you`}
                </CodeBlock>
              </SurfacePanel>
              <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-3)]">
                <PanelEyebrow>Send</PanelEyebrow>
                <CodeBlock language="bash" filename="send" copyable>
                  {`pd tube ui:clicks --send "shipping it"`}
                </CodeBlock>
              </SurfacePanel>
            </div>

            <div className="mt-[var(--space-6)] flex flex-wrap gap-[var(--space-3)]">
              <Link
                to="/docs/cli/tube"
                className="inline-flex items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
              >
                CLI reference <ArrowRight size={16} />
              </Link>
              <Link
                to="/tutorials/pd-tube"
                className="inline-flex items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
              >
                Tutorial <ArrowRight size={16} />
              </Link>
              <Link
                to="/blog/pd-tube-event-reply-loop"
                className="inline-flex items-center gap-2 border-2 border-transparent px-4 py-2 text-sm font-medium text-[var(--text-muted)] underline decoration-[var(--border-strong)] decoration-2 underline-offset-4 hover:text-[var(--text-primary)]"
              >
                Read the post
              </Link>
            </div>
          </PageContainer>
        </section>
      </main>
      <Footer />
    </div>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Radio
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
      <PanelTitle as="h3" className="mb-[var(--space-2)] text-base">
        {title}
      </PanelTitle>
      <PanelBody className="text-sm">{body}</PanelBody>
    </div>
  )
}
