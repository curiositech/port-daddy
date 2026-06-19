import { useCallback, useMemo, useState, type ComponentType } from 'react'
import {
  GitBranch,
  MessageSquare,
  MousePointerClick,
  QrCode,
  Terminal,
  Webhook,
  FlaskConical,
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  CopyableCommandBlock,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'
import { cn } from '@/lib/utils'
import {
  AgentNode,
  ReplyThread,
  TubeMotionProvider,
  TubeStatus,
  Wire,
  fireTube,
  usePublish,
  useReplyWatch,
  type ThreadEntry,
  type TubePhase,
} from '@/components/tube/TubeWire'
import { RedToGreen } from './demos/RedToGreen'
import { EditorLightbulb } from './demos/EditorLightbulb'
import { WarRoom } from './demos/WarRoom'

/**
 * The pd tube playground — every trigger, one agent.
 *
 * Route: /pd-tube/playground. Hosts the demo suite for `pd tube`, starting with
 * "The Switchboard": seven distinct trigger tiles, each firing a REAL POST to
 * the SAME channel (summon:demo) with a different sender. A single shared
 * AgentNode sits center; the cobalt send-pulse travels to it and the teal reply
 * routes back to whichever tile fired.
 *
 * Honesty: the tiles that mock a non-UI surface (Git hook, test runner, Slack,
 * webhook, Jupyter, QR scan) are labelled as UI mocks — clicking them fires a
 * real POST and each shows the copyable real shell command. No fake activity:
 * every pulse is a real round-trip or a real timeout.
 */

const DEMO_CHANNEL = 'summon:demo'

interface Trigger {
  id: string
  /** The `sender` posted with this trigger — distinct per tile. */
  sender: string
  label: string
  icon: ComponentType<{ size?: number | string; className?: string }>
  /** The message body posted to the channel. */
  body: string
  /** A short note on what real surface this tile stands in for. */
  note: string
  /** The real shell command that fires the same POST from a terminal. */
  command: string
  /** True for tiles that mock a non-browser surface (label them as mocks). */
  mocked: boolean
}

const TRIGGERS: Trigger[] = [
  {
    id: 'button',
    sender: 'web-button',
    label: 'A button',
    icon: MousePointerClick,
    body: 'A button on the page asked the agent to weigh in.',
    note: 'A plain button in this page — the one real UI trigger here.',
    command: `pd tube ${DEMO_CHANNEL} --send "button: weigh in" --as web-button`,
    mocked: false,
  },
  {
    id: 'git-hook',
    sender: 'git-post-commit',
    label: 'A Git hook',
    icon: GitBranch,
    body: 'post-commit: a commit just landed on this branch.',
    note: 'Stands in for a real .git/hooks/post-commit script.',
    command: `pd tube ${DEMO_CHANNEL} --send "post-commit: $(git rev-parse --short HEAD)" --as git-post-commit`,
    mocked: true,
  },
  {
    id: 'tests',
    sender: 'test-runner',
    label: 'A test run',
    icon: FlaskConical,
    body: 'The test suite finished. Asking the agent to read the result.',
    note: 'Stands in for a CI step or a watch-mode test runner.',
    command: `pd tube ${DEMO_CHANNEL} --send "tests: 142 passed" --as test-runner`,
    mocked: true,
  },
  {
    id: 'slack',
    sender: 'slack-bot',
    label: 'A Slack message',
    icon: MessageSquare,
    body: 'Someone in #deploys asked the agent for a status.',
    note: 'Stands in for a Slack bot relaying a message to the channel.',
    command: `pd tube ${DEMO_CHANNEL} --send "slack #deploys: status?" --as slack-bot`,
    mocked: true,
  },
  {
    id: 'webhook',
    sender: 'webhook',
    label: 'A webhook',
    icon: Webhook,
    body: 'An inbound webhook fired and reached the agent.',
    note: 'Stands in for any service POSTing straight to the daemon.',
    command: `curl -s http://127.0.0.1:9876/msg/${DEMO_CHANNEL} \\
  -H 'content-type: application/json' \\
  -d '{"sender":"webhook","payload":{"v":1,"kind":"tube.msg","body":"webhook fired"}}'`,
    mocked: true,
  },
  {
    id: 'jupyter',
    sender: 'jupyter-cell',
    label: 'A Jupyter cell',
    icon: Terminal,
    body: 'A notebook cell finished and pinged the agent.',
    note: 'Stands in for a notebook cell shelling out to pd tube.',
    command: `pd tube ${DEMO_CHANNEL} --send "notebook: run complete" --as jupyter-cell`,
    mocked: true,
  },
  {
    id: 'qr',
    sender: 'qr-scan',
    label: 'A QR / barcode scan',
    icon: QrCode,
    body: 'A scanned code triggered the agent.',
    note: 'Stands in for a scanner app that POSTs the scanned value.',
    command: `pd tube ${DEMO_CHANNEL} --send "scanned: SKU-00428" --as qr-scan`,
    mocked: true,
  },
]

export function Playground() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content">
        {/* Hero */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <div className="max-w-[52rem] space-y-[var(--space-5)]">
              <PanelEyebrow>pd tube · playground</PanelEyebrow>
              <PanelTitle as="h1" size="hero" className="max-w-[20ch]">
                The pd tube playground — every trigger, one agent.
              </PanelTitle>
              <PanelBody className="max-w-[46rem] text-[length:var(--text-lg)]">
                Each demo here fires a real message at a Port Daddy channel and waits for a real
                reply. Run an agent on the same channel and the wire lights up; without one, the
                demo says so and shows you the one command to start it. Nothing is staged — every
                pulse is a round-trip you triggered.
              </PanelBody>
            </div>
          </PageContainer>
        </section>

        {/* Demo #1 — The Switchboard */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Demo 01 · The Switchboard"
              title="Seven different triggers. One channel. The same agent answers."
              description="A button, a Git hook, a test run, a Slack message, a webhook, a Jupyter cell, and a QR scan all post to summon:demo with a different sender. One agent listens. Each trigger's cobalt pulse travels to the agent; the teal reply routes back to the tile that fired it."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)]">
              <Switchboard />
            </div>
          </PageContainer>
        </section>

        {/* Demo #2 — Red-to-Green */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Demo 02 · Red-to-Green"
              title="A test fails. An agent reads it and replies with a fix."
              description="Run tests posts a captured failure — suite, failing assertion, stack snippet — to dev:test-failed. An agent listening there replies with a diagnosis and a suggested diff. When the reply lands, the status bar wipes from red to green."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)]">
              <RedToGreen />
            </div>
          </PageContainer>
        </section>

        {/* Demo #3 — Editor Lightbulb */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Demo 03 · Editor Lightbulb"
              title="Select code. The lightbulb lights up. An agent explains it."
              description="A selection in a faux editor carries a cobalt lightbulb in the gutter. Ask the agent posts the file, range, and selected text to editor:explain. An agent listening there replies with a plain-language explanation — and a suggested change as a unified diff when it has one. The bulb lighting up is the signature beat."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)]">
              <EditorLightbulb />
            </div>
          </PageContainer>
        </section>

        {/* Demo #4 — War Room */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Demo 04 · War Room"
              title="Three agents investigate one incident — and reply to each other."
              description="This one isn't human→agent; it's agent↔agent. Open the incident seeds a real symptom to bridge:warroom. Three named agents — alpha (lead), bravo (database), charlie (logs) — post findings on the same channel and reply to one another. Each reply draws a teal provenance arrow between the cards, so you see the argument's lineage. When an agent posts a ROOT CAUSE, it lands in a cobalt banner."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)]">
              <WarRoom />
            </div>
          </PageContainer>
        </section>

        {/* Run the agent */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Make it answer"
              title="Start an agent on summon:demo, then fire any tile."
              description="The page never fakes a reply. To see the wire complete, run pd tube in your project on the same channel. Each tile also shows the exact shell command that fires the same message from a terminal."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-2">
              <SurfacePanel elevation="quiet" padding="compact">
                <CopyableCommandBlock
                  label="Listen on the demo channel"
                  command={`pd tube ${DEMO_CHANNEL}`}
                />
              </SurfacePanel>
              <SurfacePanel elevation="quiet" padding="compact">
                <CopyableCommandBlock
                  label="Reply from the same command"
                  command={`pd tube ${DEMO_CHANNEL} --reply "on it."`}
                />
              </SurfacePanel>
            </div>
          </PageContainer>
        </section>
      </main>
      <Footer />
    </div>
  )
}

/**
 * Switchboard — the shared-agent, many-triggers composition. It owns one
 * publish/watch pair against DEMO_CHANNEL and routes every tile's reply back to
 * the tile that fired. Built on the exported TubeWire parts (no re-implemented
 * fetch/poll/animation).
 */
function Switchboard() {
  const publish = usePublish(DEMO_CHANNEL)
  const watch = useReplyWatch(DEMO_CHANNEL)
  const [phase, setPhase] = useState<TubePhase>('idle')
  const [pulse, setPulse] = useState<'none' | 'send' | 'reply'>('none')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number>()
  const [errorMessage, setErrorMessage] = useState<string>()
  const [entries, setEntries] = useState<ThreadEntry[]>([])
  const busy = phase === 'sending' || phase === 'awaiting'

  const fire = useCallback(
    (trigger: Trigger) => {
      if (busy) return
      setActiveId(trigger.id)
      setErrorMessage(undefined)
      setPulse('send')
      void fireTube({
        channel: DEMO_CHANNEL,
        sender: trigger.sender,
        body: trigger.body,
        publish,
        watch,
        onPhase: setPhase,
        onSent: (id) =>
          setEntries((prev) => [
            { key: `c${id}`, kind: 'click', who: `${trigger.label} (${trigger.sender})`, id, body: trigger.body },
            ...prev,
          ]),
        onReply: (reply, ms) => {
          setElapsedMs(ms)
          setPulse('reply')
          setEntries((prev) => [
            {
              key: `r${reply.id}`,
              kind: 'reply',
              who: `${reply.sender ?? 'agent'} → ${trigger.label}`,
              id: reply.id,
              body: reply.payload.body ?? '',
            },
            ...prev,
          ])
        },
        onError: (e) => setErrorMessage(e.message),
      })
    },
    [busy, publish, watch],
  )

  const activeTrigger = useMemo(
    () => TRIGGERS.find((t) => t.id === activeId) ?? null,
    [activeId],
  )

  return (
    <TubeMotionProvider>
      <div className="grid gap-[var(--space-5)] lg:grid-cols-[1fr_minmax(20rem,28rem)]">
        {/* Trigger gallery */}
        <div className="space-y-[var(--space-4)]">
          <PanelEyebrow>Triggers · all POST to {DEMO_CHANNEL}</PanelEyebrow>
          <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
            {TRIGGERS.map((trigger) => (
              <TriggerTile
                key={trigger.id}
                trigger={trigger}
                active={activeId === trigger.id}
                disabled={busy}
                onFire={() => fire(trigger)}
              />
            ))}
          </div>
        </div>

        {/* Shared wire + agent + thread */}
        <SurfacePanel className="space-y-[var(--space-5)]">
          <PanelEyebrow>One agent · one channel</PanelEyebrow>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-[var(--space-2)]">
            <div
              className={cn(
                'border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)] text-center',
                activeTrigger && 'border-[var(--brand-primary)] bg-[var(--surface-raised)]',
              )}
            >
              <div className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
                Sender
              </div>
              <div className="mt-[var(--space-1)] font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">
                {activeTrigger ? activeTrigger.sender : 'any trigger'}
              </div>
            </div>
            <Wire pulse={pulse} />
            <AgentNode name="agent" channel={DEMO_CHANNEL} phase={phase} />
          </div>
          <TubeStatus
            phase={phase}
            channel={DEMO_CHANNEL}
            elapsedMs={elapsedMs}
            errorMessage={errorMessage}
          />
          {entries.length === 0 ? (
            <PanelBody size="compact" className="max-w-none">
              Fire a tile to post a real message. The reply lands here, newest first.
            </PanelBody>
          ) : (
            <ReplyThread entries={entries} />
          )}
        </SurfacePanel>
      </div>
    </TubeMotionProvider>
  )
}

function TriggerTile({
  trigger,
  active,
  disabled,
  onFire,
}: {
  trigger: Trigger
  active: boolean
  disabled: boolean
  onFire: () => void
}) {
  const Icon = trigger.icon
  return (
    <div
      className={cn(
        'flex flex-col gap-[var(--space-3)] border-2 p-[var(--space-4)]',
        active
          ? 'border-[var(--brand-primary)] bg-[var(--surface-raised)]'
          : 'border-[var(--border-strong)] bg-[var(--surface-base)]',
      )}
    >
      <div className="flex items-start justify-between gap-[var(--space-2)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Icon size={20} className="text-[var(--brand-primary)]" />
          <PanelTitle as="h3" size="nav" className="normal-case">
            {trigger.label}
          </PanelTitle>
        </div>
        {trigger.mocked ? (
          <span className="shrink-0 border border-[var(--border-default)] px-[var(--space-2)] py-[2px] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
            UI mock
          </span>
        ) : null}
      </div>

      <PanelBody size="compact" className="max-w-none">
        {trigger.note}
        {trigger.mocked ? ' Clicking fires a real POST.' : ''}
      </PanelBody>

      <button
        type="button"
        onClick={onFire}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] transition-colors',
          'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
          'hover:bg-[var(--brand-primary-on-tint)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        Fire this trigger
      </button>

      <CopyableCommandBlock
        label="Real shell command"
        command={trigger.command}
        className="mt-[var(--space-1)]"
      />
    </div>
  )
}
