import { ArrowRight, MessageSquareDashed, Radio, Reply } from 'lucide-react'
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
              <SectionIntro
                eyebrow="pd tube"
                title="One command. The agent answers."
                description="One command turns any button, hook, or webhook into a message your local agent answers. Something sends JSON. The agent reads it, does the work, and replies. All in one shell call."
                titleAs="h2"
              />
              <div className="space-y-[var(--space-3)]">
                <PanelBody>
                  There is no SDK and no server to run. The sender uses plain <code>fetch()</code>.
                  The agent runs <code>pd tube</code> and waits. It runs on the same SQLite channels
                  Port Daddy already ships.
                </PanelBody>
                <PanelBody>
                  Each <code>pd tube</code> call ends on its own. That is what makes the loop work:
                  the agent gets the message, decides what to say, and the next call posts the answer
                  and waits for the next message.
                </PanelBody>
              </div>
              <div className="flex flex-wrap gap-[var(--space-3)] pt-[var(--space-2)]">
                <Link
                  to="/tutorials/pd-tube"
                  className="inline-flex items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-base)] font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
                >
                  Walk the tutorial <ArrowRight size={16} />
                </Link>
                <Link
                  to="/blog/pd-tube-event-reply-loop"
                  className="inline-flex items-center gap-2 border-2 border-transparent px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-base)] font-medium text-[var(--text-muted)] underline decoration-[var(--border-strong)] decoration-2 underline-offset-4 hover:text-[var(--text-primary)]"
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
                The block pd tube prints
              </PanelTitle>
              <PanelBody className="mb-[var(--space-4)] max-w-[52ch]">
                When a message arrives, <code>pd tube</code> prints one block: what happened, and the
                exact command to send a reply. The agent reads it, does the work, and runs that
                command. That is the whole thing.
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
              <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                Recorded from the live daemon with <code>asciinema</code> and rendered with{' '}
                <code>agg</code>. Source: <code>examples/pd-tube/demo.sh</code>.
              </figcaption>
            </figure>

            <div className="grid gap-[var(--space-4)] md:grid-cols-3">
              <BehaviorCard
                icon={Radio}
                title="Wait, then return"
                body="By default the command waits for the next message, prints it, and exits. The agent's turn ends, and the model picks up what to do next."
              />
              <BehaviorCard
                icon={Reply}
                title="Reply in one call"
                body={
                  <>
                    <code>pd tube ch --reply &quot;done&quot;</code> replies to the most recent
                    message automatically, then keeps listening. One command does both.
                  </>
                }
              />
              <BehaviorCard
                icon={MessageSquareDashed}
                title="Send over plain HTTP"
                body={
                  <>
                    Anything that can <code>POST</code> JSON to <code>/msg/&lt;channel&gt;</code> can
                    reach the agent. No SDK needed.
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
            eyebrow="Where messages come from"
            title="Senders that already exist on every dev machine."
            description="The same command connects each of these to your agent with nothing new to install. The agent already running on your machine is the backend."
            titleAs="h3"
            titleSize="card"
          />
          <div className="mt-[var(--space-5)] grid gap-[var(--space-4)] md:grid-cols-2 lg:grid-cols-3">
            <UnlockCard
              channel="editor:explain"
              title="VS Code lens"
              body="Select code, hit a shortcut, and the extension sends the selection and file. The answer shows up inline. About 300 lines of extension code."
            />
            <UnlockCard
              channel="test:failed"
              title="Jest / pytest reporter"
              body="On the first failure, send the stack trace and the diff since the last passing run. The agent you already have open reads it and proposes a fix."
            />
            <UnlockCard
              channel="chat:mention"
              title="Slack / Linear bridge"
              body="A webhook posts to the channel. Your machine becomes the bot, answering with full knowledge of the repo and your current branch."
            />
            <UnlockCard
              channel="git:committed"
              title="Git hook"
              body="A post-commit hook sends the diff and the message. The agent runs the linter, updates docs, or drafts a release note while you keep typing."
            />
            <UnlockCard
              channel="ui:clicks"
              title="Browser button"
              body="A plain HTML page posts to /msg/ui:clicks. The agent runs the tests, redeploys staging, or summarizes the latest pull request. No chat panel."
            />
            <UnlockCard
              channel="notebook:exception"
              title="Jupyter cell hook"
              body="When a cell raises, send the traceback and the cell's code. The agent debugs against the real state of the repo and replies inline."
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
      <div className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[var(--brand-primary)]">
        <Icon size={18} />
      </div>
      <PanelTitle as="h4" size="nav" className="mb-[var(--space-2)]">
        {title}
      </PanelTitle>
      <PanelBody size="compact">{body}</PanelBody>
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
      <code className="self-start border border-[var(--border-strong)] bg-[var(--surface-inset)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--type-meta-size)]">
        {channel}
      </code>
      <PanelTitle as="h4" size="nav">
        {title}
      </PanelTitle>
      <PanelBody size="compact">{body}</PanelBody>
    </div>
  )
}
