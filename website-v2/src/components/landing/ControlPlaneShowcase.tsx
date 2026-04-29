import {
  CartographerGlyph,
  ControlPlaneGlyph,
  DaemonGlyph,
  FleetGlyph,
  HarborGlyph,
  SpiderGlyph,
} from '@/components/PortDaddyMark'
import {
  BracketLabel,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'
import { cn } from '@/lib/utils'

const SHOWCASE_ROSTER = [
  {
    agent: 'docs-sentinel',
    status: 'Active',
    backend: 'Codex',
    model: 'gpt-5.4-mini',
    task: 'Reconciling CLI examples with the Fleet tutorial',
    file: 'website-v2/src/pages/tutorials/Fleet.tsx',
  },
  {
    agent: 'qa-sweep',
    status: 'Reviewing',
    backend: 'Claude',
    model: 'sonnet',
    task: 'Coverage pass on mixed-version harbor token paths',
    file: 'tests/unit/harbor-tokens.test.js',
  },
  {
    agent: 'local-smoke',
    status: 'Watching',
    backend: 'Ollama',
    model: 'qwen2.5-coder:7b',
    task: 'Waiting on qa:clean before opening the browser check',
    file: 'website-v2/src/components/landing/Hero.tsx',
  },
  {
    agent: 'sortie-log',
    status: 'Queued',
    backend: 'Claude',
    model: 'haiku',
    task: 'Drafting the operator handoff once the patch lands',
    file: '.portdaddy/briefing.md',
  },
] as const

const SHOWCASE_TIMELINE = [
  {
    time: '9:46 PM',
    kind: 'Session start',
    agent: 'qa-sweep',
    summary: 'Opened a review session after git:committed landed on the fleet lane.',
    trace: 'git:committed',
  },
  {
    time: '9:47 PM',
    kind: 'Session note',
    agent: 'docs-sentinel',
    summary: 'Flagged drift between tutorial copy and the CLI surface before editing.',
    trace: 'website-v2/src/pages/tutorials/Fleet.tsx',
  },
  {
    time: '9:49 PM',
    kind: 'File mutation',
    agent: 'docs-sentinel',
    summary: 'Touched the tutorial page and the API reference in one operator pass.',
    trace: 'website-v2/src/pages/docs/ApiReference.tsx',
  },
  {
    time: '9:51 PM',
    kind: 'Channel event',
    agent: 'system',
    summary: 'Published qa:findings so the follow-up run can pick up the same thread.',
    trace: 'qa:findings',
  },
  {
    time: '9:54 PM',
    kind: 'Salvage watch',
    agent: 'daemon',
    summary: 'Held one dead session in queue instead of dropping notes or file claims.',
    trace: 'pd salvage',
  },
] as const

const SHOWCASE_TRACES = [
  {
    label: 'Docs',
    file: 'website-v2/src/pages/tutorials/Fleet.tsx',
    detail: 'Tutorial copy updated to match the live operator loop.',
  },
  {
    label: 'Tests',
    file: 'tests/unit/harbor-tokens.test.js',
    detail: 'Mixed-version verification and tamper resistance under review.',
  },
  {
    label: 'Runtime',
    file: 'lib/harbor-tokens.ts',
    detail: 'Phase 2 token path tightened before the daemon pass.',
  },
  {
    label: 'UI',
    file: 'website-v2/src/components/landing/Hero.tsx',
    detail: 'Shared preview system replaces page-local mock panels.',
  },
] as const

const SHOWCASE_CHANNELS = [
  {
    channel: 'git:committed',
    state: 'Hot',
    detail: '2 subscribers woke on the latest commit.',
  },
  {
    channel: 'qa:findings',
    state: 'Pending',
    detail: 'Docs follow-up is queued behind the review note.',
  },
  {
    channel: 'salvage:pending',
    state: 'Watching',
    detail: 'One dead session remains claimable instead of lost.',
  },
  {
    channel: 'handoff:ready',
    state: 'Quiet',
    detail: 'Reserved for the operator summary after completion.',
  },
] as const

const SHOWCASE_METRICS = [
  { label: 'Active sessions', value: '4', tone: 'paper' as const, icon: FleetGlyph },
  { label: 'Hot channels', value: '3', tone: 'blue' as const, icon: SpiderGlyph },
  { label: 'File claims', value: '7', tone: 'paper' as const, icon: CartographerGlyph },
  { label: 'Salvage queue', value: '1', tone: 'lime' as const, icon: HarborGlyph },
] as const

function toneForStatus(status: string) {
  if (status === 'Active' || status === 'Reviewing') return 'primary'
  if (status === 'Queued') return 'accent'
  return 'default'
}

function toneForMetric(tone: 'paper' | 'blue' | 'lime') {
  return tone === 'blue' ? 'primary' : tone === 'lime' ? 'accent' : 'default'
}

export function ControlPlaneShowcase({
  variant = 'hero',
  className,
}: {
  variant?: 'hero' | 'tutorial'
  className?: string
}) {
  const isTutorial = variant === 'tutorial'
  const secondaryPanels = (
    <div className={cn('grid gap-[var(--space-4)]', isTutorial ? '' : 'md:grid-cols-2')}>
      <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
        <div className="flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] px-[var(--space-4)] py-[var(--space-3)]">
          <div className="space-y-[var(--space-1)]">
            <PanelEyebrow>File mutations</PanelEyebrow>
            <PanelTitle as="p" size="nav" className="max-w-none">
              Touched paths
            </PanelTitle>
          </div>
          <CartographerGlyph size={16} className="text-[var(--brand-primary)]" />
        </div>

        <div className="space-y-0">
          {SHOWCASE_TRACES.map((trace, index) => (
            <article
              key={trace.file}
              className={cn(
                'space-y-[var(--space-2)] px-[var(--space-4)] py-[var(--space-3)]',
                index > 0 ? 'border-t border-[var(--border-default)]' : '',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
                <BracketLabel>{trace.label}</BracketLabel>
              </div>
              <div className="font-mono text-[11px] text-[var(--text-primary)] break-all">{trace.file}</div>
              <PanelBody size="compact" className="max-w-none">
                {trace.detail}
              </PanelBody>
            </article>
          ))}
        </div>
      </section>

      <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
        <div className="flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] px-[var(--space-4)] py-[var(--space-3)]">
          <div className="space-y-[var(--space-1)]">
            <PanelEyebrow>Channels</PanelEyebrow>
            <PanelTitle as="p" size="nav" className="max-w-none">
              Why the next agent woke up
            </PanelTitle>
          </div>
          <SpiderGlyph size={16} className="text-[var(--brand-primary)]" />
        </div>

        <div className="space-y-0">
          {SHOWCASE_CHANNELS.map((item, index) => (
            <article
              key={item.channel}
              className={cn(
                'space-y-[var(--space-2)] px-[var(--space-4)] py-[var(--space-3)]',
                index > 0 ? 'border-t border-[var(--border-default)]' : '',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
                <div className="font-mono text-[11px] text-[var(--text-primary)] break-all">{item.channel}</div>
                <BracketLabel tone={toneForStatus(item.state)}>{item.state}</BracketLabel>
              </div>
              <PanelBody size="compact" className="max-w-none">
                {item.detail}
              </PanelBody>
            </article>
          ))}
        </div>
      </section>
    </div>
  )

  return (
    <SurfacePanel
      className={cn(
        'space-y-[var(--panel-gap)]',
        isTutorial ? 'min-h-[44rem]' : 'min-h-[36rem]',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)]/40 pb-[var(--panel-gap)]">
        <div className="space-y-[var(--space-2)]">
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <BracketLabel>Representative local runtime</BracketLabel>
            <PanelEyebrow>FleetBar + control plane preview</PanelEyebrow>
          </div>
          <PanelTitle as="h3" size={isTutorial ? 'card' : 'nav'} className="max-w-none">
            One daemon. One operator story. Multiple ways to inspect it.
          </PanelTitle>
        </div>

        <div className="flex items-center gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-strong)] px-[var(--space-3)] py-[var(--space-2)]">
          <ControlPlaneGlyph size={16} className="text-[var(--brand-primary)]" />
          <div className="space-y-[2px]">
            <PanelEyebrow>Single-daemon control plane</PanelEyebrow>
            <PanelEyebrow>sessions + notes + channels + file traces</PanelEyebrow>
          </div>
        </div>
      </div>

      <div
        className={cn(
          'grid gap-[var(--space-4)]',
          isTutorial ? 'xl:grid-cols-[minmax(16rem,0.74fr)_minmax(0,1.26fr)]' : 'lg:grid-cols-[minmax(18rem,0.84fr)_minmax(0,1.16fr)]',
        )}
      >
        <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
          <div className="flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] px-[var(--space-4)] py-[var(--space-3)]">
            <div className="space-y-[var(--space-1)]">
              <PanelEyebrow>FleetBar roster</PanelEyebrow>
              <PanelTitle as="p" size="nav" className="max-w-none">
                Needs-attention view
              </PanelTitle>
            </div>
            <BracketLabel>4 agents</BracketLabel>
          </div>

          <div className="space-y-0">
            {SHOWCASE_ROSTER.map((entry, index) => (
              <article
                key={entry.agent}
                className={cn(
                  'space-y-[var(--space-3)] px-[var(--space-4)] py-[var(--space-4)]',
                  index > 0 ? 'border-t border-[var(--border-default)]' : '',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-[var(--space-2)]">
                  <div className="space-y-[var(--space-1)]">
                    <PanelTitle as="p" size="nav" className="max-w-none">
                      {entry.agent}
                    </PanelTitle>
                    <PanelEyebrow>
                      {entry.backend} · {entry.model}
                    </PanelEyebrow>
                  </div>
                  <BracketLabel tone={toneForStatus(entry.status)}>{entry.status}</BracketLabel>
                </div>

                <PanelBody size="compact" className="max-w-none">
                  {entry.task}
                </PanelBody>

                <div className="grid gap-[var(--space-2)]">
                  <PanelEyebrow>Touched file</PanelEyebrow>
                  <div className="border border-[var(--border-default)] bg-[var(--surface-base)] px-[var(--space-2)] py-[var(--space-2)] font-mono text-[11px] text-[var(--text-primary)]">
                    {entry.file}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className={cn('grid gap-[var(--space-4)]', isTutorial ? 'lg:grid-cols-[minmax(0,1.12fr)_minmax(18rem,0.88fr)]' : '')}>
          <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
            <div className="flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] px-[var(--space-4)] py-[var(--space-3)]">
              <div className="space-y-[var(--space-1)]">
                <PanelEyebrow>Chronology</PanelEyebrow>
                <PanelTitle as="p" size="nav" className="max-w-none">
                  Session notes and mutations
                </PanelTitle>
              </div>
              <DaemonGlyph size={16} className="text-[var(--brand-primary)]" />
            </div>

            <div className="space-y-0">
              {SHOWCASE_TIMELINE.map((event, index) => (
                <article
                  key={`${event.time}-${event.kind}-${event.agent}`}
                  className={cn(
                    'space-y-[var(--space-2)] px-[var(--space-4)] py-[var(--space-4)]',
                    index > 0 ? 'border-t border-[var(--border-default)]' : '',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
                    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                      <BracketLabel>{event.kind}</BracketLabel>
                      <PanelEyebrow>{event.agent}</PanelEyebrow>
                    </div>
                    <PanelEyebrow>{event.time}</PanelEyebrow>
                  </div>
                  <PanelBody size="compact" className="max-w-none">
                    {event.summary}
                  </PanelBody>
                  <div className="border border-[var(--border-default)] bg-[var(--surface-base)] px-[var(--space-2)] py-[var(--space-2)] font-mono text-[11px] text-[var(--text-primary)] break-all">
                    {event.trace}
                  </div>
                </article>
              ))}
            </div>
          </section>

          {isTutorial ? <div className="grid gap-[var(--space-4)]">{secondaryPanels}</div> : secondaryPanels}
        </div>
      </div>

      <div className="grid border-2 border-[var(--border-strong)] md:grid-cols-4">
        {SHOWCASE_METRICS.map((metric, index) => {
          const Icon = metric.icon

          return (
            <div
              key={metric.label}
              className={cn(
                'space-y-[var(--space-3)] p-[var(--space-4)]',
                metric.tone === 'blue'
                  ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                  : metric.tone === 'lime'
                    ? 'bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]'
                    : 'bg-[var(--surface-raised)] text-[var(--text-primary)]',
                index < SHOWCASE_METRICS.length - 1
                  ? 'border-b-2 border-[var(--border-strong)] md:border-b-0 md:border-r-2'
                  : '',
              )}
            >
              <div className="flex items-center justify-between gap-[var(--space-3)]">
                <PanelEyebrow tone={toneForMetric(metric.tone)}>{metric.label}</PanelEyebrow>
                <Icon
                  size={16}
                  className={cn(
                    metric.tone === 'paper'
                      ? 'text-[var(--brand-primary)]'
                      : metric.tone === 'blue'
                        ? 'text-[var(--brand-primary-foreground)]'
                        : 'text-[var(--brand-accent-foreground)]',
                  )}
                />
              </div>
              <PanelTitle
                as="p"
                size="card"
                tone={toneForMetric(metric.tone)}
                className="max-w-none"
              >
                {metric.value}
              </PanelTitle>
            </div>
          )
        })}
      </div>
    </SurfacePanel>
  )
}
