import { useId, useState, type ReactNode } from 'react'
import { ChevronRight, FileCode2, Radio, Terminal, Zap, MonitorDot } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  CopyableCommandBlock,
  DocsCodeBlock,
  PanelBody,
  PanelEyebrow,
} from '@/components/site/primitives'
import { cn } from '@/lib/utils'

/**
 * HowItsWired — the legibility layer shared by every pd-tube playground demo.
 *
 * The demos look like magic. This panel removes the magic: for one demo it shows,
 * concretely and accurately, the channel, the listening agent's name + role, the
 * exact prompt that agent runs with, where that config lives (a real pd-fleet.yml
 * snippet AND the ad-hoc one-liner), the trigger the daemon dispatches on, and
 * where you watch it in the Mac app (FleetBar).
 *
 * Ground truth this mirrors: /Users/erichowens/coding/port-daddy/pd-fleet.yml —
 * each agent is declared with name / trigger / backend + fallbacks / prompt /
 * telos, and the daemon watches the trigger and dispatches. The ad-hoc form is a
 * process running `pd tube <channel>` whose model is handed a prompt.
 *
 * House style: cream/cobalt/teal, indigo-black ink, flat 2px borders, zero
 * radius, >=14px text. It is a native <details>/<summary> disclosure so it works
 * without JS and is keyboard-accessible by default.
 */

export interface WiredAgent {
  /** The agent's listening identity — the value passed to `pd tube ... --as`. */
  name: string
  /** Its human role, e.g. "Front-desk dispatcher". */
  role: string
  /** The real, concrete prompt the model runs with. Multi-line. */
  prompt: string
}

export interface HowItsWiredProps {
  /** The channel this demo posts to — a named mailbox the daemon owns. */
  channel: string
  /** One or more listening agents (War Room has three). */
  agents: WiredAgent[]
  /** Plain-language description of the trigger + that the daemon dispatches it. */
  trigger: ReactNode
  /** A real pd-fleet.yml snippet declaring this demo's agent(s). */
  fleetYaml: string
  /** The ad-hoc one-liner(s): start `pd tube <channel>` and supply a prompt. */
  adHocCommand: string
  /** Where you watch it in the app — one line. Defaults to the FleetBar line. */
  fleetBarNote?: ReactNode
  className?: string
}

/** Default FleetBar line — accurate to the Mac app's role: it lists the fleet. */
const DEFAULT_FLEETBAR_NOTE: ReactNode = (
  <>
    FleetBar — the Port Daddy menu-bar app — lists every agent in your fleet, shows which are
    listening, and surfaces what they post. This is where you watch the wire light up for real.
  </>
)

export function HowItsWired({
  channel,
  agents,
  trigger,
  fleetYaml,
  adHocCommand,
  fleetBarNote = DEFAULT_FLEETBAR_NOTE,
  className,
}: HowItsWiredProps) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className={cn(
        'border-2 border-[var(--border-strong)] bg-[var(--surface-base)]',
        className,
      )}
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center justify-between gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)]',
          'select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]',
          'hover:bg-[var(--surface-raised)]',
          open && 'border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)]',
        )}
        aria-controls={bodyId}
      >
        <span className="flex items-center gap-[var(--space-3)]">
          <ChevronRight
            size={18}
            className={cn(
              'shrink-0 text-[var(--brand-primary)] transition-transform duration-[var(--duration-fast)]',
              open && 'rotate-90',
            )}
            aria-hidden="true"
          />
          <span className="flex flex-col gap-[2px]">
            <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
              How this is wired
            </span>
            <span className="font-sans text-[length:var(--text-base)] text-[var(--text-primary)]">
              The channel, the agent, its real prompt, and where the config lives.
            </span>
          </span>
        </span>
        <span className="shrink-0 border border-[var(--border-default)] px-[var(--space-2)] py-[2px] font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
          {open ? 'hide' : 'show'}
        </span>
      </summary>

      <div id={bodyId} className="space-y-[var(--space-5)] px-[var(--space-4)] py-[var(--space-5)]">
        {/* The channel. */}
        <WiredRow icon={Radio} title="The channel">
          <PanelBody size="compact" className="max-w-[68ch]">
            <code className="font-mono font-bold text-[var(--brand-primary)]">{channel}</code> is a
            named mailbox the local daemon owns. Anyone can post to it; anyone running{' '}
            <code className="font-mono">pd tube {channel}</code> reads from it. The name is the only
            contract — pick one that says who is talking and about what.
          </PanelBody>
        </WiredRow>

        {/* The agent(s): name + role + the actual prompt. */}
        <WiredRow icon={Zap} title={agents.length > 1 ? 'The agents' : 'The agent'}>
          <div className="space-y-[var(--space-4)]">
            {agents.map((agent) => (
              <div
                key={agent.name}
                className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)] border-b-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-2)]">
                  <span className="font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">
                    {agent.name}
                  </span>
                  <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
                    {agent.role}
                  </span>
                </div>
                <div className="px-[var(--space-3)] py-[var(--space-3)]">
                  <PanelEyebrow className="mb-[var(--space-2)] text-[var(--brand-primary)]">
                    Its prompt — the instructions the model runs with
                  </PanelEyebrow>
                  <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[14px] leading-[1.6] text-[var(--text-primary)]">
                    {agent.prompt}
                  </pre>
                </div>
              </div>
            ))}
            <PanelBody size="compact" className="max-w-[68ch]">
              That prompt is the answer to “where the hell is the agent prompt?” In a fleet it lives
              in the <code className="font-mono">prompt:</code> block of{' '}
              <code className="font-mono">pd-fleet.yml</code> (below). Ad-hoc, you hand the same text
              to the model your <code className="font-mono">pd tube</code> listener wraps.
            </PanelBody>
          </div>
        </WiredRow>

        {/* The trigger / event. */}
        <WiredRow icon={Zap} title="The trigger">
          <PanelBody size="compact" className="max-w-[68ch]">
            {trigger}
          </PanelBody>
        </WiredRow>

        {/* Where the config lives — the fleet YAML. */}
        <WiredRow icon={FileCode2} title="Where the config lives — pd-fleet.yml">
          <div className="space-y-[var(--space-3)]">
            <PanelBody size="compact" className="max-w-[68ch]">
              This is the durable, declarative form. Drop it in{' '}
              <code className="font-mono">pd-fleet.yml</code> at your repo root, run{' '}
              <code className="font-mono">pd fleet up</code>, and the daemon owns the lifecycle:
              it watches the trigger, dispatches the agent, and applies the backend +{' '}
              <code className="font-mono">fallbacks</code> order.
            </PanelBody>
            <DocsCodeBlock code={fleetYaml} language="yaml" label="pd-fleet.yml" />
          </div>
        </WiredRow>

        {/* The ad-hoc one-liner. */}
        <WiredRow icon={Terminal} title="The ad-hoc form — pd tube">
          <div className="space-y-[var(--space-3)]">
            <PanelBody size="compact" className="max-w-[68ch]">
              No fleet file required. Run this in your project and the listener is live. The model is
              handed the prompt above; every reply is a real round-trip through the daemon.
            </PanelBody>
            <CopyableCommandBlock label="Start the listener" command={adHocCommand} />
          </div>
        </WiredRow>

        {/* Where you watch it. */}
        <WiredRow icon={MonitorDot} title="Where you see it in the app">
          <PanelBody size="compact" className="max-w-[68ch]">
            {fleetBarNote}
          </PanelBody>
        </WiredRow>

        {/* Docs links. */}
        <div className="flex flex-wrap items-center gap-[var(--space-3)] border-t-2 border-[var(--border-strong)] pt-[var(--space-4)]">
          <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
            Read the docs
          </span>
          <WiredDocLink to="/docs/cli/tube">pd tube</WiredDocLink>
          <WiredDocLink to="/docs/features/fleet">Fleet</WiredDocLink>
          <WiredDocLink to="/tutorials/fleet">Fleet tutorial</WiredDocLink>
        </div>
      </div>
    </details>
  )
}

function WiredRow({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Radio
  title: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid gap-[var(--space-2)] sm:grid-cols-[auto_1fr] sm:gap-[var(--space-4)]">
      <div className="flex items-center gap-[var(--space-2)] sm:flex-col sm:items-start sm:pt-[2px]">
        <span className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center border-2 border-[var(--brand-primary)] text-[var(--brand-primary)]">
          <Icon size={16} aria-hidden="true" />
        </span>
        <span className="font-sans text-[length:var(--text-base)] font-bold text-[var(--text-primary)] sm:max-w-[12ch]">
          {title}
        </span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function WiredDocLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-[var(--space-1)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]"
    >
      {children}
    </Link>
  )
}
