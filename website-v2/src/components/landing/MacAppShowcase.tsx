import { MonitorCog, RadioTower, ShieldCheck, WalletCards } from 'lucide-react'
import {
  APP_SURFACES,
  MAC_APP_CAPABILITIES,
  type AppSurface,
  type MacAppCapability,
} from '@/data/product'
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
  roadmap: ['built: FleetBar preview', 'blocked: signed release channel', 'next: Shipwright onboarding'],
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

function SurfacePreviewFallback({ appSurface, featured = false }: { appSurface: AppSurface; featured?: boolean }) {
  const rows = surfacePreviewRows[appSurface.id] ?? [
    appSurface.surface,
    appSurface.title,
    'operator surface',
  ]

  return (
    <div className="grid aspect-[16/10] content-between border-b-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
      <div className="grid gap-[var(--space-3)]">
        <div className="flex items-center justify-between border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
          <span className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-secondary)]">
            Console subset
          </span>
          <span className="h-3 w-3 border-2 border-[var(--border-strong)] bg-[var(--brand-primary)]" aria-hidden="true" />
        </div>
        <PanelTitle as="p" size={featured ? 'card' : 'nav'} className="max-w-[18ch]">
          <SurfaceTitle title={appSurface.title} />
        </PanelTitle>
      </div>
      <div className="grid gap-[var(--space-2)]">
        {rows.map((row) => (
          <div
            className="grid grid-cols-[0.75rem_minmax(0,1fr)] items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-2)] py-[var(--space-1)]"
            key={row}
          >
            <span className="h-2 w-2 bg-[var(--brand-accent)]" aria-hidden="true" />
            <span className="truncate font-mono text-[11px] font-black uppercase tracking-[0.14em] text-[var(--text-primary)]">
              {row}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SurfaceTile({ appSurface, featured = false }: { appSurface: AppSurface; featured?: boolean }) {
  const screenshot = surfaceScreenshots[appSurface.id]

  return (
    <article
      className={[
        'min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]',
        featured ? 'lg:col-span-8' : 'lg:col-span-4',
      ].join(' ')}
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
        <SurfacePreviewFallback appSurface={appSurface} featured={featured} />
      )}
      <div className="grid gap-[var(--space-2)] p-[var(--space-4)]">
        <PanelTitle as="h3" size="nav" className="max-w-none">
          <SurfaceTitle title={appSurface.title} />
        </PanelTitle>
        <PanelBody size="compact" className="max-w-none">
          {appSurface.caption}
        </PanelBody>
      </div>
    </article>
  )
}

export function MacAppShowcase() {
  const [firstSurface, ...surfaces] = APP_SURFACES

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
                  Homebrew and npm remain the install path for Port Daddy. The website now also hosts a Mac developer-preview FleetBar app bundle while the signed release channel matures.
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
              <PanelEyebrow>Fleet Control Center gallery</PanelEyebrow>
            </div>
            <SurfaceTile appSurface={firstSurface} featured />
            {surfaces.map((appSurface) => (
              <SurfaceTile appSurface={appSurface} key={appSurface.id} />
            ))}
          </div>
        </div>
      </PageContainer>
    </section>
  )
}
