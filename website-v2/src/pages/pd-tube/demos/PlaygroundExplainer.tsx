import { Link } from 'react-router-dom'
import { Inbox, FileCode2, Cpu, MonitorDot } from 'lucide-react'
import {
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'
import type { ReactNode } from 'react'

/**
 * PlaygroundExplainer — the top-of-page "how does pd tube actually work?" panel.
 *
 * Answers, in plain language, the questions the demos provoke but don't state:
 * what a channel is, where events/triggers are declared, who dispatches them,
 * where the agent's prompt lives, and where you watch it. It sets up the per-demo
 * "How this is wired" disclosures below so a reader can reproduce any demo.
 *
 * Ground truth it mirrors: pd-fleet.yml (triggers + prompt blocks), the local
 * daemon (watches + dispatches), and FleetBar (lists the fleet). No magic, no
 * cloud.
 */
export function PlaygroundExplainer() {
  return (
    <div className="space-y-[var(--space-6)]">
      <div className="max-w-[52rem] space-y-[var(--space-4)]">
        <PanelEyebrow>How pd tube actually works</PanelEyebrow>
        <PanelTitle as="h2" size="display" className="max-w-[24ch]">
          Where everything lives — no magic, no cloud.
        </PanelTitle>
        <PanelBody className="max-w-[46rem] text-[length:var(--text-lg)]">
          The demos below look like a page summoning an agent out of thin air. It is not. Each one is
          four concrete things you can point at: a channel, a trigger, a prompt, and a daemon that
          ties them together on your own machine. Here is each one, then every demo shows its exact
          wiring.
        </PanelBody>
      </div>

      <div className="grid gap-[var(--space-4)] md:grid-cols-2">
        <ExplainerCard
          icon={Inbox}
          eyebrow="The channel"
          title="A named mailbox the daemon owns"
        >
          A channel like <Code>desk:requests</Code> is only a name. Posting to it drops a message in
          a local mailbox; running <Code>pd tube desk:requests</Code> reads from that mailbox. No
          registration, no schema — the name is the whole contract. Pick one that says who is talking
          and about what.
        </ExplainerCard>

        <ExplainerCard
          icon={FileCode2}
          eyebrow="Events & triggers"
          title="Declared in pd-fleet.yml"
        >
          An agent's trigger lives in <Code>pd-fleet.yml</Code> at your repo root —{' '}
          <Code>git:committed</Code>, <Code>pull_request:opened</Code>, a cron <Code>schedule</Code>,
          or a channel name. The same file holds the agent's <Code>prompt:</Code> block: that is
          where the agent prompt is. Not hidden, not generated — a multi-line string you write.
        </ExplainerCard>

        <ExplainerCard
          icon={Cpu}
          eyebrow="Who dispatches it"
          title="The local daemon — on your machine"
        >
          The Port Daddy daemon watches the declared triggers and dispatches the agent when one
          fires, picking the first healthy <Code>backend</Code> from its fallback order. Everything
          runs locally. For a one-off you skip the file entirely: a process running{' '}
          <Code>pd tube &lt;channel&gt;</Code> with a prompt is the whole agent.
        </ExplainerCard>

        <ExplainerCard
          icon={MonitorDot}
          eyebrow="Where you watch it"
          title="FleetBar, the menu-bar app"
        >
          FleetBar lists every agent in your fleet, shows which are listening, and surfaces what they
          post. When a trigger fires and an agent replies, that is where you see it light up — the
          same round-trip these demos draw, on your real fleet.
        </ExplainerCard>
      </div>

      <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-3)]">
        <PanelEyebrow>The short version</PanelEyebrow>
        <PanelBody size="compact" className="max-w-[72ch]">
          A channel is a named mailbox. A trigger and a prompt are declared in{' '}
          <Code>pd-fleet.yml</Code> (or supplied inline to <Code>pd tube</Code>). The local daemon
          watches triggers and dispatches the agent. FleetBar is where you watch it. Each demo below
          opens a “How this is wired” panel with its real channel, agent name + role, prompt, and the
          exact config.
        </PanelBody>
        <div className="flex flex-wrap items-center gap-[var(--space-3)] pt-[var(--space-1)]">
          <ExplainerDocLink to="/docs/cli/tube">Read: pd tube</ExplainerDocLink>
          <ExplainerDocLink to="/docs/features/fleet">Read: Fleet</ExplainerDocLink>
          <ExplainerDocLink to="/tutorials/fleet">Tutorial: declare a fleet</ExplainerDocLink>
        </div>
      </SurfacePanel>
    </div>
  )
}

function ExplainerCard({
  icon: Icon,
  eyebrow,
  title,
  children,
}: {
  icon: typeof Inbox
  eyebrow: string
  title: string
  children: ReactNode
}) {
  return (
    <SurfacePanel className="flex flex-col gap-[var(--space-3)]">
      <div className="flex items-center gap-[var(--space-3)]">
        <span className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center border-2 border-[var(--brand-primary)] text-[var(--brand-primary)]">
          <Icon size={18} aria-hidden="true" />
        </span>
        <PanelEyebrow className="text-[var(--brand-primary)]">{eyebrow}</PanelEyebrow>
      </div>
      <PanelTitle as="h3" size="card" className="normal-case">
        {title}
      </PanelTitle>
      <PanelBody size="compact" className="max-w-none">
        {children}
      </PanelBody>
    </SurfacePanel>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono font-semibold text-[var(--brand-primary)]">{children}</code>
}

function ExplainerDocLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-[var(--space-1)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]"
    >
      {children}
    </Link>
  )
}
