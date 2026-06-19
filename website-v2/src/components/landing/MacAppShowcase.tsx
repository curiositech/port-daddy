import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Maximize2, MonitorCog, RadioTower, ShieldCheck, WalletCards, X } from 'lucide-react'
import {
  APP_SURFACES,
  MAC_APP_CAPABILITIES,
  type AppSurface,
  type MacAppCapability,
} from '@/data/product'
import { Button } from '@/components/ui/Button'
import { useTheme } from '@/lib/theme-context'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'
import { RoleTerm } from '@/components/site/RoleTerm'

const capabilityIcons = [MonitorCog, RadioTower, ShieldCheck, WalletCards] as const
type ThemedScreenshot = {
  light: string
  dark: string
}

const fleetbarNativeShellScreenshots: ThemedScreenshot = {
  light: '/img/app-screens/fleetbar-native-shell-light.png',
  dark: '/img/app-screens/fleetbar-native-shell-dark.png',
}

const surfaceScreenshots: Record<string, ThemedScreenshot> = {
  'fleet-flow': {
    light: '/img/app-screens/fleet-flow-light.png',
    dark: '/img/app-screens/fleet-flow-dark.png',
  },
  resources: {
    light: '/img/app-screens/resources-light.png',
    dark: '/img/app-screens/resources-dark.png',
  },
  sorties: {
    light: '/img/app-screens/sorties-light.png',
    dark: '/img/app-screens/sorties-dark.png',
  },
  'shipwright-harbor': {
    light: '/img/app-screens/shipwright-harbor-light.png',
    dark: '/img/app-screens/shipwright-harbor-dark.png',
  },
  'shipwright-focus': {
    light: '/img/app-screens/shipwright-focus-light.png',
    dark: '/img/app-screens/shipwright-focus-dark.png',
  },
  'shipwright-control': {
    light: '/img/app-screens/shipwright-control-light.png',
    dark: '/img/app-screens/shipwright-control-dark.png',
  },
}

const surfacePreviewRows: Record<string, string[]> = {
  agents: ['Coxswain: active', 'Lookout: docs drift clear', 'Quartermaster: budget guarded'],
  roadmap: ['built: FleetBar preview', 'next: Developer ID notarization', 'next: Shipwright onboarding'],
  activity: ['session.note', 'file.claim', 'sortie.completed'],
  channels: ['website:coordination', 'coordination:inconsistency', 'project:git:committed'],
  inbox: ['Claude handoff unread', 'Codex proof request', 'Navigator status ping'],
  memory: ['salvage context found', 'tuples joined', 'session anchor restored'],
  yaml: ['agents: 8 declared', 'triggers: git:committed', 'budget_usd_per_day: 8'],
  'shipwright-simulation': ['backend readiness', 'daily budget envelope', 'resource pressure'],
}

function ThemeLockedScreenshot({
  screenshots,
  alt,
  className,
  loading = 'lazy',
}: {
  screenshots: ThemedScreenshot
  alt: string
  className?: string
  loading?: 'eager' | 'lazy'
}) {
  const { theme } = useTheme()
  const themeKey = theme === 'dark' ? 'dark' : 'light'

  return (
    <img
      src={screenshots[themeKey]}
      alt={alt}
      className={className}
      data-theme-screenshot={themeKey}
      loading={loading}
    />
  )
}

function CapabilityRow({
  capability,
  index,
}: {
  capability: MacAppCapability
  index: number
}) {
  const Icon = capabilityIcons[index % capabilityIcons.length]

  return (
    <article className="grid gap-[var(--space-4)] border-t-2 border-[var(--border-strong)] py-[var(--space-5)] md:grid-cols-[4.5rem_minmax(0,1fr)]">
      <div className="flex items-start gap-[var(--space-3)] md:flex-col">
        <span className="font-mono text-[length:var(--type-panel-title-nav-size)] font-black text-[var(--brand-primary)]">
          {capability.label}
        </span>
        <span className="inline-flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)]">
          <Icon size={18} />
        </span>
      </div>
      <div className="grid gap-[var(--space-3)]">
        <PanelTitle as="h3" size="card" className="max-w-[18ch]">
          {capability.title}
        </PanelTitle>
        <PanelBody className="max-w-[42rem]">
          {capability.description}
        </PanelBody>
        <PanelBody size="compact" className="max-w-[42rem] text-[var(--text-muted)]">
          {capability.proof}
        </PanelBody>
      </div>
    </article>
  )
}

function SurfaceTitle({ title }: { title: string }) {
  if (title.startsWith('Shipwright')) {
    return (
      <>
        <RoleTerm role="shipwright">Shipwright</RoleTerm>
        {title.slice('Shipwright'.length)}
      </>
    )
  }
  if (title === 'Sorties') {
    return <RoleTerm role="sortie">Sorties</RoleTerm>
  }
  return <>{title}</>
}

function SurfacePreviewFallback({
  appSurface,
  mode = 'card',
}: {
  appSurface: AppSurface
  mode?: 'card' | 'dialog'
}) {
  const rows = surfacePreviewRows[appSurface.id] ?? [
    appSurface.surface,
    appSurface.id,
    'operator surface',
  ]

  return (
    <div
      className={[
        'grid min-h-[10rem] gap-[var(--space-4)] bg-[var(--surface-base)] p-[var(--space-4)]',
        mode === 'card'
          ? 'border-b-2 border-[var(--border-strong)]'
          : 'border-2 border-[var(--border-strong)]',
      ].join(' ')}
    >
      <div className="grid gap-[var(--space-3)]">
        <div className="flex items-center justify-between border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
          <span className="font-mono text-[12px] font-black uppercase tracking-[0.22em] text-[var(--text-secondary)]">
            Surface signals
          </span>
          <span className="h-3 w-3 border-2 border-[var(--border-strong)] bg-[var(--brand-primary)]" aria-hidden="true" />
        </div>
      </div>
      <div className="grid gap-[var(--space-2)]">
        {rows.map((row) => (
          <div
            className="grid grid-cols-[0.75rem_minmax(0,1fr)] items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-2)] py-[var(--space-1)]"
            key={row}
          >
            <span className="h-2 w-2 bg-[var(--brand-accent)]" aria-hidden="true" />
            <span className="min-w-0 font-mono text-[12px] font-black uppercase tracking-[0.14em] text-[var(--text-primary)] [overflow-wrap:anywhere]">
              {row}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DialogSignalList({ appSurface }: { appSurface: AppSurface }) {
  const rows = surfacePreviewRows[appSurface.id] ?? [
    appSurface.surface,
    appSurface.id,
    'operator surface',
  ]

  return (
    <div className="grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
      <PanelEyebrow>Surface signals</PanelEyebrow>
      <ul className="grid gap-[var(--space-2)]">
        {rows.map((row) => (
          <li
            className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-[var(--space-2)] border-2 border-[var(--border-default)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]"
            key={row}
          >
            <span className="mt-[0.45em] h-2 w-2 bg-[var(--brand-accent)]" aria-hidden="true" />
            <span>{row}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SurfaceTile({
  appSurface,
  featured = false,
  onOpen,
}: {
  appSurface: AppSurface
  featured?: boolean
  onOpen: (appSurface: AppSurface) => void
}) {
  const screenshot = surfaceScreenshots[appSurface.id]
  const detailLabel = `Open ${appSurface.title} details`

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(appSurface)
    }
  }

  return (
    <article
      aria-label={detailLabel}
      aria-haspopup="dialog"
      className={[
        'group min-w-0 cursor-pointer border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] transition-colors hover:bg-[var(--interactive-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-base)]',
        featured ? 'lg:col-span-12' : 'lg:col-span-6',
      ].join(' ')}
      onClick={() => onOpen(appSurface)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <div className="border-b-2 border-[var(--border-strong)] p-[var(--space-3)]">
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
          <PanelEyebrow>
            {appSurface.surface === 'Shipwright' ? (
              <RoleTerm role="shipwright">Shipwright</RoleTerm>
            ) : (
              appSurface.surface
            )}
          </PanelEyebrow>
          <BracketLabel>{appSurface.id}</BracketLabel>
        </div>
      </div>
      {screenshot ? (
        <ThemeLockedScreenshot
          screenshots={screenshot}
          alt={`${appSurface.title} screenshot from ${appSurface.surface}`}
          className="aspect-[16/10] w-full border-b-2 border-[var(--border-strong)] bg-[var(--surface-base)] object-cover object-left-top"
          loading="lazy"
        />
      ) : (
        <SurfacePreviewFallback appSurface={appSurface} />
      )}
      <div className="grid gap-[var(--space-4)] p-[var(--space-4)]">
        <PanelTitle as="h3" size="nav" className="max-w-none">
          <SurfaceTitle title={appSurface.title} />
        </PanelTitle>
        <PanelBody className="max-w-none">
          {appSurface.caption}
        </PanelBody>
        <PanelBody size="compact" className="max-w-none text-[var(--text-muted)]">
          {appSurface.operatorValue}
        </PanelBody>
        <div className="grid gap-[var(--space-2)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)]">
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
            <PanelEyebrow>What it unlocks</PanelEyebrow>
            <span className="inline-flex items-center gap-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
              <Maximize2 size={13} />
              Open details
            </span>
          </div>
          <ul className="grid gap-[var(--space-2)]">
            {appSurface.highlights.map((highlight) => (
              <li
                key={highlight}
                className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]"
              >
                <span className="mt-[0.45em] h-2 w-2 bg-[var(--brand-accent)]" aria-hidden="true" />
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  )
}

function SurfaceDetailDialog({
  appSurface,
  onClose,
}: {
  appSurface: AppSurface
  onClose: () => void
}) {
  const screenshot = surfaceScreenshots[appSurface.id]

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-[var(--scrim-backdrop)] p-[var(--space-4)]"
      onMouseDown={onClose}
      role="dialog"
    >
      <div
        aria-labelledby={`surface-detail-${appSurface.id}`}
        className="grid w-full max-w-5xl gap-0 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-[var(--shadow-brutal)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] p-[var(--space-4)]">
          <div>
            <div id={`surface-detail-${appSurface.id}`}>
              <PanelTitle as="h3" size="card" className="max-w-none">
                {appSurface.title}
              </PanelTitle>
            </div>
          </div>
          <Button type="button" variant="secondary" size="sm" aria-label="Close details" onClick={onClose}>
            <X size={16} />
            Close
          </Button>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
          <div className="grid gap-[var(--space-4)] border-b-2 border-[var(--border-strong)] p-[var(--space-4)] lg:border-r-2 lg:border-b-0">
            {screenshot ? (
              <ThemeLockedScreenshot
                screenshots={screenshot}
                alt={`${appSurface.title} screenshot from ${appSurface.surface}`}
                className="aspect-[16/10] w-full border-2 border-[var(--border-strong)] bg-[var(--surface-base)] object-cover object-left-top"
              />
            ) : (
              <DialogSignalList appSurface={appSurface} />
            )}
            <PanelBody className="max-w-none">
              {appSurface.caption}
            </PanelBody>
            <PanelBody size="compact" className="max-w-none text-[var(--text-muted)]">
              {appSurface.operatorValue}
            </PanelBody>
          </div>

          <div className="grid gap-[var(--space-5)] p-[var(--space-4)]">
            <div className="grid gap-[var(--space-3)]">
              <PanelEyebrow>Things you can do here</PanelEyebrow>
              <ul className="grid gap-[var(--space-2)]">
                {appSurface.actions.map((action) => (
                  <li
                    key={action}
                    className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-[var(--space-2)] text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]"
                  >
                    <span className="mt-[0.5em] h-2 w-2 bg-[var(--brand-primary)]" aria-hidden="true" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-4)]">
              <PanelEyebrow>Why it matters</PanelEyebrow>
              <ul className="grid gap-[var(--space-2)]">
                {appSurface.highlights.map((highlight) => (
                  <li
                    key={highlight}
                    className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]"
                  >
                    <span className="mt-[0.45em] h-2 w-2 bg-[var(--brand-accent)]" aria-hidden="true" />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function MacAppShowcase() {
  const [firstSurface, ...surfaces] = APP_SURFACES
  const [selectedSurface, setSelectedSurface] = useState<AppSurface | null>(null)

  useEffect(() => {
    if (!selectedSurface) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedSurface(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedSurface])

  return (
    <section id="mac-app" className="border-t-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer width="wide">
        <div className="grid gap-[var(--space-7)]">
          <div className="grid gap-[var(--space-5)] border-b-2 border-[var(--border-strong)] pb-[var(--space-6)] lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-5">
              <SectionIntro
                eyebrow="Mac app"
                title="FleetBar is the front door to the substrate."
                description={
                  <>
                    The native app is not a toy launcher. It is the compact Mac entrance to shared
                    agent state: Fleet Control Center, project fleets, agent radio,{' '}
                    <RoleTerm role="sortie">sortie</RoleTerm> work,{' '}
                    <RoleTerm role="shipwright">Shipwright</RoleTerm> proposals, resource pressure,
                    and backend readiness.
                  </>
                }
                titleAs="h2"
                titleSize="display"
                titleClassName="max-w-[14ch]"
              />
            </div>
            <div className="grid gap-[var(--space-4)] md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)] lg:col-span-7">
              <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-2)] self-start">
                <PanelEyebrow>Current distribution stance</PanelEyebrow>
                <PanelBody size="compact" className="max-w-none">
                  Homebrew and npm remain the install path for Port Daddy. The website now also
                  hosts an ad-hoc signed FleetBar preview while Developer ID signing and
                  notarization move into the release channel.
                </PanelBody>
              </SurfacePanel>
              <figure className="grid gap-[var(--space-2)]">
                <div className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                  <ThemeLockedScreenshot
                    screenshots={fleetbarNativeShellScreenshots}
                    alt="FleetBar macOS app shell with Fleet Control Center embedded"
                    className="aspect-[16/10] w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <PanelBody size="compact" className="max-w-none text-[var(--text-muted)]">
                  The product captures follow the site theme: light site, light app shell; dark site,
                  dark app shell.
                </PanelBody>
              </figure>
            </div>
          </div>

          <div className="grid gap-[var(--space-5)] lg:grid-cols-2">
            {MAC_APP_CAPABILITIES.map((capability, index) => (
              <CapabilityRow capability={capability} index={index} key={capability.id} />
            ))}
          </div>

          <div className="grid gap-[var(--space-4)] lg:grid-cols-12">
            <div className="lg:col-span-12">
              <SectionIntro
                eyebrow="Fleet Control Center gallery"
                title="Every tab is a job surface, not decoration."
                description="The Mac app exposes the same daemon truth from multiple angles: launch safety, agent handoffs, project memory, resource pressure, mission history, and Shipwright cold-start design."
                titleAs="h2"
                titleSize="card"
                titleClassName="max-w-none"
                bodyClassName="max-w-[48rem]"
              />
            </div>
            <SurfaceTile appSurface={firstSurface} featured onOpen={setSelectedSurface} />
            {surfaces.map((appSurface) => (
              <SurfaceTile appSurface={appSurface} key={appSurface.id} onOpen={setSelectedSurface} />
            ))}
          </div>
          {selectedSurface ? (
            <SurfaceDetailDialog appSurface={selectedSurface} onClose={() => setSelectedSurface(null)} />
          ) : null}
        </div>
      </PageContainer>
    </section>
  )
}
