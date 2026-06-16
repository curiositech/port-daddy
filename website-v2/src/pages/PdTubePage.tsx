import { ArrowRight, GitFork, Radio, Reply } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Footer } from '@/components/layout/Footer'
import { CodeBlock } from '@/components/ui/CodeBlock'
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

/**
 * Standalone feature page for `pd tube` at /pd-tube. Covers what the
 * command does, the message -> agent reply loop, and the multi-subscriber
 * fan-out where distinct `--as` identities each receive every message.
 * Links out to the CLI docs, the tutorial, and the post.
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
                  <PanelEyebrow>pd tube</PanelEyebrow>
                  <PanelTitle as="h1" size="hero" className="max-w-[18ch]">
                    Let any button talk to your agent.
                  </PanelTitle>
                  <PanelBody className="max-w-[46rem] text-[length:var(--text-lg)]">
                    One command turns a button, a Git hook, a test run, or a webhook into a message
                    your agent answers. The agent is already running in your project. It hears the
                    message, does the work, and replies — all in a single shell call. No SDK, no MCP
                    server, no websocket setup. One channel can also reach many listeners at once:
                    each <code>--as</code> identity gets its own copy of every message.
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
                  <PanelEyebrow>The whole loop</PanelEyebrow>
                  <CodeBlock language="bash" filename="agent terminal" copyable>
                    {`# 1. Agent listens on a channel
$ pd tube ui:clicks

# 2. A button sends JSON to POST /msg/ui:clicks
#    -> the agent wakes with the message

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
              title="Something sends a message. The agent answers. Both in one call."
              description="Anything that can send JSON to POST /msg/<channel> can reach the agent. The agent runs pd tube in a loop. Each call waits for the next message, prints a short block telling the model how to respond, then returns. That return is what hands the turn back to the model so it can do the work and post a reply."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] md:grid-cols-3">
              <FeatureCard
                icon={Radio}
                title="Wait, then return"
                body="Run pd tube and it waits for the next message, prints a block telling the model how to respond, then exits. The agent's shell call returns, so the model takes the next turn."
              />
              <FeatureCard
                icon={Reply}
                title="Reply in the same command"
                body={
                  <>
                    <code>pd tube ch --reply &quot;done&quot;</code> matches the most recent incoming
                    message, posts the reply, and keeps listening. One command does both jobs.
                  </>
                }
              />
              <FeatureCard
                icon={GitFork}
                title="Reach many listeners"
                body="Each --as identity gets its own copy of every message on the channel. One message reaches every listener, not one picked at random."
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
                  <SectionIntro
                    eyebrow="Many listeners"
                    title="One channel. Many listeners. Every message."
                    description="Each listener now keeps its own place in the stream. Two listeners on the same channel used to race for each message, and only one would get it. Now every --as identity reads the channel independently, so all of them receive every message."
                    titleAs="h2"
                    titleSize="display"
                  />
                  <PanelBody tone="default">
                    Nothing changes for the sender. The same message now reaches a standup bot, a
                    notifier, and a logger at once — all on one channel, each on its own identity.
                  </PanelBody>
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
                    One <code>POST</code> reaches three screens at once. FleetBar shows the same
                    channel and who is listening.
                  </figcaption>
                </figure>

                <SurfacePanel className="overflow-hidden">
                  <PanelEyebrow className="mb-[var(--space-2)]">Three listeners, one broadcast</PanelEyebrow>
                  <PanelTitle as="h3" className="mb-[var(--space-4)]">
                    Each <code>--as</code> identity gets its own copy
                  </PanelTitle>
                  <CodeBlock language="bash" filename="four terminals" copyable>
                    {`# Terminal 1 — first listener
$ pd tube standup:demo --tail --as you

# Terminal 2 — second listener
$ pd tube standup:demo --tail --as claude-code

# Terminal 3 — third listener
$ pd tube standup:demo --tail --as gardener-bot

# Terminal 4 — sender posts once
$ pd tube standup:demo --send "Standup in 5. Post blockers."
SUCCESS: tube: posted id=87 to standup:demo

# id=87 now prints in all three listener terminals — every listener gets it.`}
                  </CodeBlock>
                </SurfacePanel>

                <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                  <img
                    src="/demos/pd-tube/pd-tube-multiplex.gif"
                    alt="Animated terminal recording: a broadcaster sends one message to a channel and three pd tube subscribers, each on a distinct --as identity, all receive the same message"
                    className="block w-full"
                    loading="lazy"
                  />
                  <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                    One sender, three listeners on distinct <code>--as</code> identities. The single
                    message reaches all three terminals.
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
              description="Channels are the SQLite-backed messaging Port Daddy already ships. Pick a channel name, run pd tube, and wire up any sender you like."
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
              <Button asChild variant="secondary">
                <Link to="/docs/cli/tube">
                  CLI reference <ArrowRight size={16} />
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/tutorials/pd-tube">
                  Tutorial <ArrowRight size={16} />
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/blog/pd-tube-event-reply-loop">Read the post</Link>
              </Button>
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
      <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)] text-[var(--brand-primary)]">
        <Icon size={20} />
      </div>
      <PanelTitle as="h3" size="card" className="mb-[var(--space-2)]">
        {title}
      </PanelTitle>
      <PanelBody size="compact">{body}</PanelBody>
    </div>
  )
}
