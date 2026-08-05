import type { ComponentType } from 'react'
import {
  FlaskConical,
  GitBranch,
  MessageSquare,
  MousePointerClick,
  Radio,
  Reply,
  Send,
  Terminal,
  Webhook,
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
import { RedToGreen } from './demos/RedToGreen'
import { EditorLightbulb } from './demos/EditorLightbulb'
import { WarRoom } from './demos/WarRoom'

const PAGE_SECTION_CLASS =
  'border-b-2 border-[var(--border-strong)] py-[var(--space-6)] lg:py-[var(--space-7)]'

const TUBE_CHANNEL = 'ui:clicks'
const LISTEN_COMMAND = `pd tube ${TUBE_CHANNEL} --as reviewer`
const SEND_COMMAND = `pd tube ${TUBE_CHANNEL} --send "deploy button clicked; review the release note" --as internal-tool`
const REPLY_COMMAND = `pd tube ${TUBE_CHANNEL} --reply "release note is clear; ship it" --as reviewer`

const FETCH_SNIPPET = `const PD_URL = window.location.pathname.startsWith('/fleet-ui')
  ? ''
  : new URLSearchParams(location.search).get('daemon') ?? window.__PORT_DADDY_URL__
if (!PD_URL && !window.location.pathname.startsWith('/fleet-ui')) {
  throw new Error('Choose a daemon endpoint or open this page inside the embedded dashboard.')
}
await fetch(PD_URL ? new URL('/msg/ui:clicks', PD_URL) : '/msg/ui:clicks', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    sender: 'internal-tool',
    payload: {
      v: 1,
      kind: 'tube.msg',
      body: 'deploy button clicked; review the release note'
    }
  })
})`

const FLEET_YAML = `# pd-fleet.yml
fleet:
  agents:
    reviewer:
      trigger: ui:clicks
      backend: cli:codex
      singleton: true
      prompt: |
        Read each event on ui:clicks.
        Inspect the repo if needed.
        Reply on the same tube thread with the next action.`

const EVENT_CONTRACT = `{
  "channel": "ui:clicks",
  "sender": "internal-tool",
  "payload": {
    "v": 1,
    "kind": "tube.msg",
    "body": "deploy button clicked"
  },
  "replyTo": "optional-parent-event-id"
}`

interface TriggerExample {
  label: string
  icon: ComponentType<{ size?: number | string; className?: string }>
  sender: string
  command: string
  note: string
}

const TRIGGER_EXAMPLES: TriggerExample[] = [
  {
    label: 'Product button',
    icon: MousePointerClick,
    sender: 'internal-tool',
    command: SEND_COMMAND,
    note: 'A UI action asks a local agent for help without opening a terminal.',
  },
  {
    label: 'Git hook',
    icon: GitBranch,
    sender: 'post-commit',
    command: `pd tube ${TUBE_CHANNEL} --send "post-commit: $(git rev-parse --short HEAD)" --as post-commit`,
    note: 'A repository hook posts while the branch context is still fresh.',
  },
  {
    label: 'Test runner',
    icon: FlaskConical,
    sender: 'test-runner',
    command: `pd tube tests:failed --send "checkout.spec.ts failed on retry" --as test-runner`,
    note: 'A red test can summon the agent that knows how to inspect the failure.',
  },
  {
    label: 'Team chat',
    icon: MessageSquare,
    sender: 'slack-bot',
    command: `pd tube deploys --send "staging deploy status?" --as slack-bot`,
    note: 'A chat bridge can ask the fleet for status without granting chat control.',
  },
  {
    label: 'Webhook',
    icon: Webhook,
    sender: 'webhook',
    command: `PD_URL="\${PORT_DADDY_URL:-$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed 's#^#http://127.0.0.1:#')}"
curl -s "$PD_URL/msg/${TUBE_CHANNEL}" \\
  -H 'content-type: application/json' \\
  -d '{"sender":"webhook","payload":{"v":1,"kind":"tube.msg","body":"payment webhook fired"}}'`,
    note: 'Any service that can POST can become an event source.',
  },
  {
    label: 'Notebook or script',
    icon: Terminal,
    sender: 'notebook',
    command: `pd tube analysis:done --send "experiment finished; summarize deltas" --as notebook`,
    note: 'A script can hand off findings to an agent and keep the reply threaded.',
  },
]

export function Playground() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content">
        <section className={PAGE_SECTION_CLASS}>
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.88fr)_minmax(21rem,0.62fr)] lg:items-start">
              <div className="max-w-[54rem] space-y-[var(--space-4)]">
                <PanelEyebrow>pd tube · playground</PanelEyebrow>
                <PanelTitle
                  as="h1"
                  size="hero"
                  className="max-w-[14ch] !text-[length:var(--type-panel-title-display-size)] md:!text-[length:var(--type-hero-size)]"
                >
                  PD Tube is a tube.
                </PanelTitle>
                <PanelBody className="max-w-[44rem] text-[length:var(--text-lg)]">
                  Code can drop an event into it. Agents can listen, reply on the same
                  thread, and talk to each other. Developers can use it directly from Port
                  Daddy. Anything programmable can become a trigger.
                </PanelBody>
              </div>
              <TubePrimitivePanel />
            </div>
          </PageContainer>
        </section>

        <section className={PAGE_SECTION_CLASS}>
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="The primitive"
              title="Send an event. Keep the reply on the same thread."
              description="A tube is a named local channel. Your app, hook, script, webhook, test runner, notebook, or another agent sends one event. A listener receives it and replies with a parent event id, so the whole exchange stays legible."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-3">
              <StepPanel
                number="01"
                icon={Send}
                title="Send"
                body="Publish one short event from code or the CLI."
                command={SEND_COMMAND}
              />
              <StepPanel
                number="02"
                icon={Radio}
                title="Listen"
                body="Keep an agent, script, or human terminal subscribed to the channel."
                command={LISTEN_COMMAND}
              />
              <StepPanel
                number="03"
                icon={Reply}
                title="Reply"
                body="Answer on the same tube thread so provenance stays attached."
                command={REPLY_COMMAND}
              />
            </div>
            <TubeDefinitionBar />
          </PageContainer>
        </section>

        <section className={PAGE_SECTION_CLASS}>
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Wire it once"
              title="Make an agent wait for the trigger."
              description="A developer can run a listener ad hoc, or declare one in pd-fleet.yml so the daemon starts it when a message lands. That is the whole move: channel name in, threaded reply out."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
              <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-4)]">
                <PanelEyebrow>Ad hoc listener</PanelEyebrow>
                <PanelTitle as="h3" size="card">
                  Good for a terminal, test run, or quick handoff.
                </PanelTitle>
                <CopyableCommandBlock label="Start listening" command={LISTEN_COMMAND} />
                <CopyableCommandBlock label="Send a trigger" command={SEND_COMMAND} />
              </SurfacePanel>
              <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-4)]">
                <PanelEyebrow>Fleet listener</PanelEyebrow>
                <PanelTitle as="h3" size="card">
                  Good when the trigger should wake an agent every time.
                </PanelTitle>
                <CopyableCommandBlock label="pd-fleet.yml" command={FLEET_YAML} />
              </SurfacePanel>
            </div>
          </PageContainer>
        </section>

        <section className={PAGE_SECTION_CLASS}>
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Anything programmable can post"
              title="Buttons, hooks, tests, chats, webhooks, notebooks."
              description="These are event sources, not product definitions. Each one sends the same kind of tube message, with a different sender and payload."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)] grid gap-[var(--space-3)] md:grid-cols-2 xl:grid-cols-3">
              {TRIGGER_EXAMPLES.map((example) => (
                <TriggerExampleCard key={example.label} example={example} />
              ))}
            </div>
          </PageContainer>
        </section>

        <section className={PAGE_SECTION_CLASS}>
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="From app code"
              title="If it can call fetch, it can use the tube."
              description="The browser example in the Tube event-reply post is this small. A product surface posts to the local daemon; the listener owns the work; the reply stays attached to the event."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-2">
              <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-4)]">
                <PanelEyebrow>Plain HTTP</PanelEyebrow>
                <CopyableCommandBlock label="Browser or local app" command={FETCH_SNIPPET} />
              </SurfacePanel>
              <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-4)]">
                <PanelEyebrow>Event shape</PanelEyebrow>
                <CopyableCommandBlock label="Message contract" command={EVENT_CONTRACT} />
                <PanelBody size="compact" className="max-w-none">
                  The useful fields are deliberately boring: channel, sender, payload, and
                  an optional parent id for replies. The boring shape is what makes it easy
                  for agents and ordinary code to share the same loop.
                </PanelBody>
              </SurfacePanel>
            </div>
          </PageContainer>
        </section>

        <section className={PAGE_SECTION_CLASS}>
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Example · failing test"
              title="A test fails. An agent reads it and replies with a fix."
              description="Run tests posts a captured failure to tests:failed. The listener replies with a diagnosis and a suggested diff. This is one app you can build on the tube primitive."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)]">
              <RedToGreen />
            </div>
          </PageContainer>
        </section>

        <section className={PAGE_SECTION_CLASS}>
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Example · editor selection"
              title="Select code. Ask an agent. Keep the answer threaded."
              description="A faux editor posts the file, range, and selected text to editor:explain. The reply can be an explanation, a risk note, or a suggested patch."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)]">
              <EditorLightbulb />
            </div>
          </PageContainer>
        </section>

        <section className={PAGE_SECTION_CLASS}>
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Example · agent to agent"
              title="Agents can use the same channel to investigate together."
              description="One agent posts a symptom. Other agents reply with findings on the same tube thread. The operator sees the argument's lineage instead of a pile of disconnected chat."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)]">
              <WarRoom />
            </div>
          </PageContainer>
        </section>
      </main>
      <Footer />
    </div>
  )
}

function TubePrimitivePanel() {
  return (
    <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-4)] lg:mt-[var(--space-2)]">
      <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)] p-[var(--space-4)]">
        <div className="grid gap-[var(--space-3)]">
          <SignalRow label="Code, hook, app, agent" value="send event" tone="primary" />
          <div className="mx-auto h-8 border-l-2 border-[var(--brand-primary)]" aria-hidden="true" />
          <SignalRow label={TUBE_CHANNEL} value="named local channel" tone="accent" />
          <div className="mx-auto h-8 border-l-2 border-[var(--brand-secondary)]" aria-hidden="true" />
          <SignalRow label="Listener" value="reply on thread" tone="secondary" />
        </div>
      </div>
      <div className="grid gap-[var(--space-2)] sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        {[
          ['01', 'code triggers'],
          ['02', 'agent listens'],
          ['03', 'reply returns'],
        ].map(([number, label]) => (
          <div key={number} className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
            <div className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">{number}</div>
            <div className="mt-[var(--space-1)] font-sans text-[length:var(--type-panel-body-compact-size)] font-semibold text-[var(--text-primary)]">
              {label}
            </div>
          </div>
        ))}
      </div>
      <CopyableCommandBlock label="Start the listener" command={LISTEN_COMMAND} />
    </SurfacePanel>
  )
}

function SignalRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'primary' | 'secondary' | 'accent'
}) {
  const color =
    tone === 'primary'
      ? 'var(--brand-primary)'
      : tone === 'secondary'
        ? 'var(--brand-secondary)'
        : 'var(--accent-teal)'

  return (
    <div className="grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)] sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="font-mono text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="border-2 px-[var(--space-3)] py-[var(--space-2)] font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]" style={{ borderColor: color }}>
        {value}
      </div>
    </div>
  )
}

function StepPanel({
  number,
  icon: Icon,
  title,
  body,
  command,
}: {
  number: string
  icon: ComponentType<{ size?: number | string; className?: string }>
  title: string
  body: string
  command: string
}) {
  return (
    <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-4)]">
      <div className="flex items-center justify-between gap-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Icon size={22} className="text-[var(--brand-primary)]" />
          <PanelTitle as="h3" size="card">
            {title}
          </PanelTitle>
        </div>
        <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
          {number}
        </span>
      </div>
      <PanelBody size="compact" className="max-w-none">
        {body}
      </PanelBody>
      <CopyableCommandBlock label={`${title} command`} command={command} />
    </SurfacePanel>
  )
}

function TubeDefinitionBar() {
  return (
    <SurfacePanel
      elevation="quiet"
      padding="compact"
      className="mt-[var(--space-5)] grid gap-[var(--space-4)] border-[var(--brand-primary)] bg-[var(--surface-raised)] lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:items-center"
    >
      <div>
        <PanelEyebrow>Plain English</PanelEyebrow>
        <PanelTitle as="h2" size="card" className="mt-[var(--space-2)] max-w-[18ch]">
          A named local pipe for agent work.
        </PanelTitle>
      </div>
      <PanelBody className="max-w-none text-[length:var(--text-lg)]">
        PD Tube does not care whether the sender is a web button, a Git hook, a
        test runner, a chat bridge, a script, or another agent. It gives all of
        them the same small contract: post to a channel, listen on that channel,
        and attach replies to the event that caused them.
      </PanelBody>
    </SurfacePanel>
  )
}

function TriggerExampleCard({ example }: { example: TriggerExample }) {
  const Icon = example.icon

  return (
    <SurfacePanel elevation="quiet" padding="compact" className="flex min-h-full flex-col gap-[var(--space-4)]">
      <div className="flex items-start justify-between gap-[var(--space-2)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Icon size={20} className="text-[var(--brand-primary)]" />
          <PanelTitle as="h3" size="nav" className="normal-case">
            {example.label}
          </PanelTitle>
        </div>
        <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
          {example.sender}
        </span>
      </div>
      <PanelBody size="compact" className="max-w-none">
        {example.note}
      </PanelBody>
      <CopyableCommandBlock label="Trigger" command={example.command} className="mt-auto" />
    </SurfacePanel>
  )
}
