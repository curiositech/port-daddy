import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { PageContainer, SectionIntro } from '@/components/site/primitives'
import { ArrowRight, Download, MonitorCog, RadioTower, ShieldCheck, Terminal } from 'lucide-react'

const heroProof = [
  {
    label: 'Human surface',
    title: 'FleetBar opens the real console',
    detail: 'Check the daemon, selected project, guard state, backend readiness, and recent work before another agent runs.',
    icon: MonitorCog,
  },
  {
    label: 'Agent surface',
    title: 'CLI writes durable facts',
    detail: 'Agents begin sessions, leave notes, claim files, publish warnings, and finish with a trail the next process can read.',
    icon: Terminal,
  },
  {
    label: 'Safety surface',
    title: 'Guard turns intent into policy',
    detail: 'The console exposes guard state for people; the commit hook enforces claims when code crosses into history.',
    icon: ShieldCheck,
  },
] as const

export function Hero() {
  return (
    <section className="relative overflow-hidden py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      {/* Swiss-grid field for the infrastructure diagram. */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <PageContainer width="wide" className="relative z-10">
        <div className="grid items-center gap-[var(--space-6)] min-[960px]:grid-cols-[minmax(19rem,0.84fr)_minmax(0,1.16fr)] min-[960px]:gap-[var(--space-7)]">
          <div className="space-y-[var(--space-5)]">
            <Link to="/mac-preview" className="no-underline">
              <div
                className="mb-[var(--space-4)] inline-flex max-w-[42rem] items-center gap-2 border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--interactive-hover)]"
                style={{
                  background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--brand-primary) 25%, transparent)',
                  color: 'var(--brand-primary)',
                }}
              >
                <span>New</span>
                <span style={{ color: 'var(--text-secondary)' }}>FleetBar and Fleet Control Center now expose agent radio, handoffs, resources, and launch readiness.</span>
                <ArrowRight size={12} />
              </div>
            </Link>

            <SectionIntro
              eyebrow="What is Port Daddy?"
              title={
                <>
                  The local coordination layer for{' '}
                  <span className="text-[var(--brand-primary)]">
                    coding agents.
                  </span>
                </>
              }
              description="Port Daddy is the layer under your coding agents: a shared place for notes, work ownership, warnings, actor messages, readiness, budgets, and recoverable handoffs. Schedulers decide what runs. Port Daddy makes what agents know, touch, spend, and hand off inspectable."
              titleAs="h1"
              titleSize="hero"
              titleClassName="max-w-[13ch]"
              bodyClassName="max-w-[37rem]"
            />

            <div className="flex max-w-[37rem] flex-wrap gap-2">
              {[
                'FleetBar for humans',
                'CLI primitives for agents',
                'Recoverable handoffs',
              ].map((label) => (
                <span
                  key={label}
                  className="border px-3 py-1 text-xs font-semibold"
                  style={{
                    background: 'color-mix(in srgb, var(--brand-secondary) 10%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--brand-secondary) 20%, transparent)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {label}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-[var(--space-3)]">
              <Button asChild variant="primary" size="lg">
                <Link to="/mac-preview#download">
                  <Download size={16} />
                  Download Mac preview
                  <ArrowRight size={16} />
                </Link>
              </Button>
              <Link to="/docs">
                <Button variant="ghost" size="lg" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <Terminal size={16} />
                  Technical docs
                </Button>
              </Link>
            </div>
          </div>

          <div className="relative">
            <picture aria-hidden="true" className="pointer-events-none absolute -right-[4%] -top-[14%] hidden h-[50%] w-[70%] overflow-hidden border opacity-30 min-[960px]:block dark:opacity-25" style={{ borderColor: 'var(--border-subtle)' }}>
              <source srcSet="/img/generated/agent-runtime-map.webp" type="image/webp" />
              <img
                alt=""
                loading="lazy"
                decoding="async"
                fetchPriority="low"
                className="h-full w-full object-cover"
                src="/img/generated/agent-runtime-map.jpg"
              />
            </picture>
            <div className="relative z-10">
              <figure className="grid gap-[var(--space-3)]">
                <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[var(--shadow-sm)]">
                  <img
                    src="/media/landing-live-glory/port-daddy-live-glory-light-poster.jpg"
                    alt="Fleet Control Center showing Shipwright and FleetBar workflow evidence"
                    className="aspect-[16/9] w-full object-cover dark:hidden"
                  />
                  <img
                    src="/media/landing-live-glory/port-daddy-live-glory-dark-poster.jpg"
                    alt="Fleet Control Center showing Shipwright and FleetBar workflow evidence"
                    className="hidden aspect-[16/9] w-full object-cover dark:block"
                  />
                </div>
              </figure>
              <div className="grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)] sm:grid-cols-[auto_minmax(0,1fr)]">
                <span className="inline-flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] text-[var(--brand-primary)]">
                  <RadioTower size={18} />
                </span>
                <p className="max-w-none text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  The recording shows the split that matters: agents use Port Daddy commands to write coordination state, while humans inspect that state in FleetBar and the full console.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-[var(--space-7)] grid border-2 border-[var(--border-strong)] bg-[var(--surface-base)] md:grid-cols-3">
          {heroProof.map((item, index) => (
            <div
              key={item.title}
              className={[
                'grid gap-[var(--space-3)] p-[var(--space-4)]',
                index < heroProof.length - 1 ? 'border-b-2 border-[var(--border-strong)] md:border-b-0 md:border-r-2' : '',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-[var(--space-3)]">
                <span className="font-sans text-[length:var(--type-meta-size)] font-medium uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
                  {item.label}
                </span>
                <item.icon className="h-5 w-5 text-[var(--brand-primary)]" />
              </div>
              <h2 className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
                {item.title}
              </h2>
              <p className="max-w-none text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </PageContainer>
    </section>
  )
}
