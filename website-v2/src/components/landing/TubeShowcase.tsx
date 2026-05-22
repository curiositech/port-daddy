import { ArrowRight, MessageSquareDashed, Radio, Reply } from 'lucide-react'
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
 * The headline section for `pd tube` — the single command that turns any
 * local UI / hook / webhook into an event the running agent can answer in
 * one shell call. Replaces the old "tube" tab in TerminalDemos and the
 * passing mention in the Features list, so the homepage points at one
 * winner.
 */
export function TubeShowcase() {
  return (
    <section
      id="pd-tube"
      className="border-t-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <SwissGrid className="items-start gap-y-[var(--space-7)]">
          <SwissGridItem span="narrow">
            <div className="sticky top-28 space-y-[var(--space-5)]">
              <BracketLabel>The flagship primitive</BracketLabel>
              <SectionIntro
                eyebrow="pd tube"
                title="One command. The agent answers."
                description="`pd tube` is the zero-protocol event bus your local agent was missing. A button, test runner, editor, hook, or webhook publishes JSON. The agent on the other end of the channel does the work and replies — both jobs in a single shell call."
                titleAs="h2"
              />
              <div className="space-y-[var(--space-3)] text-[var(--text-muted)]">
                <p>
                  No SDK. No MCP server. No websocket dance. The publisher is plain{' '}
                  <code>fetch()</code>; the agent runs <code>pd tube</code> in a loop. The substrate is
                  the same SQLite-backed channel system Port Daddy already ships.
                </p>
                <p>
                  Every <code>pd tube</code> invocation returns. That is what unlocks the agent loop:
                  the tool yields, the model decides what to reply, the next call posts the answer{' '}
                  <em>and</em> blocks for the next event.
                </p>
              </div>
              <div className="flex flex-wrap gap-[var(--space-3)] pt-[var(--space-2)]">
                <Link
                  to="/tutorials/pd-tube"
                  className="inline-flex items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
                >
                  Walk the tutorial <ArrowRight size={16} />
                </Link>
                <Link
                  to="/blog/pd-tube-event-reply-loop"
                  className="inline-flex items-center gap-2 border-2 border-transparent px-4 py-2 text-sm font-medium text-[var(--text-muted)] underline decoration-[var(--border-strong)] decoration-2 underline-offset-4 hover:text-[var(--text-primary)]"
                >
                  Read the post
                </Link>
              </div>
            </div>
          </SwissGridItem>

          <SwissGridItem span="wide" className="space-y-[var(--space-6)]">
            <SurfacePanel className="overflow-hidden">
              <PanelEyebrow className="mb-[var(--space-2)]">Real terminal output</PanelEyebrow>
              <PanelTitle as="h3" className="mb-[var(--space-4)]">
                The crank-handle prose block
              </PanelTitle>
              <PanelBody className="mb-[var(--space-4)] max-w-[52ch]">
                When an event arrives, <code>pd tube</code> emits a single block telling the agent
                what happened and exactly how to answer. The agent reads it, does the work, then
                runs the suggested command. That is the whole protocol.
              </PanelBody>
              <CodeBlock language="bash" filename="agent terminal" copyable={false}>
                {`$ pd tube ui:clicks
tube waiting on ui:clicks as pd-tube/myapp/ui_clicks (up to 600s; Ctrl+C to exit)

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
            </SurfacePanel>

            <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <img
                src="/demos/pd-tube/pd-tube-real-output.gif"
                alt="Animated terminal recording showing pd tube receiving an event, posting a reply, and reading both records back from channel history"
                className="block w-full"
                loading="lazy"
              />
              <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-sm text-[var(--text-muted)]">
                Recorded from the live daemon with <code>asciinema</code> and rendered with{' '}
                <code>agg</code>. Source: <code>examples/pd-tube/demo.sh</code>.
              </figcaption>
            </figure>

            <div className="grid gap-[var(--space-4)] md:grid-cols-3">
              <BehaviorCard
                icon={Radio}
                title="Block, then return"
                body="Default mode blocks until the next event arrives, prints the prose, exits. The agent's bash tool yields; the model takes the next turn."
              />
              <BehaviorCard
                icon={Reply}
                title="Inline --reply"
                body={
                  <>
                    <code>pd tube ch --reply &quot;done&quot;</code> auto-correlates to the most
                    recent event from someone else, posts the reply, then keeps listening. One
                    command, both jobs.
                  </>
                }
              />
              <BehaviorCard
                icon={MessageSquareDashed}
                title="Plain HTTP publisher"
                body={
                  <>
                    Any process that can <code>POST</code> JSON to{' '}
                    <code>/msg/&lt;channel&gt;</code> can summon the agent. No SDK required.
                  </>
                }
              />
            </div>
          </SwissGridItem>
        </SwissGrid>

        <div className="mt-[var(--space-8)] border-t-2 border-[var(--border-strong)] pt-[var(--space-6)]">
          {/*
            Gestalt similarity fix: `SectionIntro` defaults titleSize
            to "display" (≈53.6px) which is identical to the page's
            section H2s. Combined with titleAs="h3", that rendered a
            subsection heading at the visual rank of a top-level
            section header — false similarity. The reader's eye reads
            it as a new section starting, then has to reconcile that
            with the surrounding context. Step down to "card" size
            (≈29.6px) which matches the actual H3 rank used in
            CoordinationEnforcementSection and AgentConversationSection.
          */}
          <SectionIntro
            eyebrow="What this unlocks"
            title="Publishers that already exist on every dev machine."
            description="The same primitive turns each of these into a real agent integration with no new infrastructure. The agent that's already running is the backend."
            titleAs="h3"
            titleSize="card"
          />
          <div className="mt-[var(--space-5)] grid gap-[var(--space-4)] md:grid-cols-2 lg:grid-cols-3">
            <UnlockCard
              channel="editor:explain"
              title="VS Code lens"
              body="Selection + shortcut publishes range + file. Inline answer rendered as a CodeLens. ~300 LOC extension."
            />
            <UnlockCard
              channel="test:failed"
              title="Jest / pytest reporter"
              body="On first failure, publish stack + diff since last green. The session you already have open picks it up and proposes a fix."
            />
            <UnlockCard
              channel="chat:mention"
              title="Slack / Linear bridge"
              body="Inbound webhook → POST → tube. Your workstation becomes the bot backend, with full repo context and your live branch."
            />
            <UnlockCard
              channel="git:committed"
              title="Git hook"
              body="post-commit publishes the diff and message. The agent runs lint, regenerates docs, or drafts a release note while you keep typing."
            />
            <UnlockCard
              channel="ui:clicks"
              title="Browser button"
              body="Plain HTML page hits /msg/ui:clicks. The agent runs tests, redeploys staging, or summarizes the latest PR — without opening a chat panel."
            />
            <UnlockCard
              channel="notebook:exception"
              title="Jupyter cell hook"
              body="On exception, publish traceback + cell source. The agent debugs against the real repo state and replies inline."
            />
          </div>
        </div>
      </PageContainer>
    </section>
  )
}

function BehaviorCard({
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
      <PanelTitle as="h4" className="mb-[var(--space-2)] text-base">
        {title}
      </PanelTitle>
      <PanelBody className="text-sm">{body}</PanelBody>
    </div>
  )
}

function UnlockCard({
  channel,
  title,
  body,
}: {
  channel: string
  title: string
  body: string
}) {
  return (
    <div className="flex h-full flex-col gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
      <code className="self-start border border-[var(--border-strong)] bg-[var(--surface-inset)] px-2 py-0.5 text-xs">
        {channel}
      </code>
      <PanelTitle as="h4" className="text-base">
        {title}
      </PanelTitle>
      <PanelBody className="text-sm">{body}</PanelBody>
    </div>
  )
}
