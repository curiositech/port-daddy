import { ArrowRight, MonitorCheck, PackageCheck } from 'lucide-react'
import { DISTRIBUTION_OPTIONS } from '@/data/product'
import { Button } from '@/components/ui/Button'
import { useTheme } from '@/lib/theme-context'
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

const fleetbarNativeShellScreenshots = {
  light: '/img/app-screens/fleetbar-native-shell-light.webp',
  dark: '/img/app-screens/fleetbar-native-shell-dark.webp',
} as const

const statusCopy = {
  available: 'Available',
  'mac-app': 'Mac app',
} as const

const downloadFacts = [
  ['App', 'FleetBar'],
  ['Runs on', 'Apple Silicon Mac, macOS 14 or newer'],
  ['Shows', 'Daemon health, current project, active agents, and install status'],
  ['Installed by', 'pd setup'],
] as const

const downloadSteps = [
  'Install Port Daddy with Homebrew.',
  'Run pd setup.',
  'Open FleetBar and choose your project.',
  'Run pd doctor only if FleetBar reports a problem.',
] as const

export function DistributionSection() {
  const primary = DISTRIBUTION_OPTIONS[0]
  const { theme } = useTheme()
  const shellScreenshot = theme === 'dark' ? fleetbarNativeShellScreenshots.dark : fleetbarNativeShellScreenshots.light

  return (
    <section
      id="download"
      className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <SwissGrid className="items-start">
          <SwissGridItem span="narrow">
            <SectionIntro
              eyebrow="Mac app"
              title="FleetBar comes with setup."
              description="Run setup once. It installs the app, starts the local runtime, and adds the project hooks. Doctor is the repair command when anything stops lining up."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[12ch]"
              bodyClassName="max-w-[42rem]"
            />

            <div className="mt-[var(--space-5)] flex flex-wrap gap-[var(--space-3)]">
              <Button asChild variant="primary" size="lg">
                <a href="#install">
                  <PackageCheck size={16} />
                  Run setup
                </a>
              </Button>
            </div>
            <figure className="mt-[var(--space-5)] block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
              <img
                src={shellScreenshot}
                alt="FleetBar macOS app in a native window shell"
                className="aspect-[16/9] w-full object-cover"
                data-theme-screenshot={theme === 'dark' ? 'dark' : 'light'}
                loading="lazy"
              />
            </figure>
          </SwissGridItem>

          <SwissGridItem span="wide">
            <div className="grid gap-[var(--space-4)]">
              <SurfacePanel elevation="quiet" className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1fr)]">
                <div className="grid content-start gap-[var(--space-3)]">
                  <PanelEyebrow>What setup adds</PanelEyebrow>
                  <PanelTitle as="h3" size="card" className="max-w-[16ch]">
                    A Mac window for the fleet.
                  </PanelTitle>
                  <PanelBody className="max-w-[38rem]">
                    FleetBar opens the Fleet Control Center from the menu bar. It shows daemon
                    health, the selected project, active agents, claimed files, inboxes, spawned runs,
                    Shipwright, and backend readiness without making the operator read terminal
                    output first.
                  </PanelBody>
                </div>

                <dl className="grid gap-[var(--space-2)]">
                  {downloadFacts.map(([label, value]) => (
                    <div
                      key={label}
                      className="grid gap-[var(--space-2)] border-t-2 border-[var(--border-default)] pt-[var(--space-2)] sm:grid-cols-[9rem_minmax(0,1fr)]"
                    >
                      <dt className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                        {label}
                      </dt>
                      <dd className="font-sans text-[length:var(--text-sm)] font-semibold leading-snug text-[var(--text-primary)]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </SurfacePanel>

              <SurfacePanel tone="blue" className="grid gap-[var(--space-4)] md:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
                <div className="grid gap-[var(--space-3)]">
                  <PanelEyebrow tone="primary">{statusCopy[primary.status]}</PanelEyebrow>
                  <PanelTitle as="h3" size="card" tone="primary" className="max-w-[18ch]">
                    {primary.title}
                  </PanelTitle>
                  <PanelBody tone="primary" className="max-w-[42rem]">
                    {primary.description}
                  </PanelBody>
                  <div className="inline-flex items-start gap-[var(--space-2)] border-t border-[color:var(--brand-primary-foreground-subtle)] pt-[var(--space-3)]">
                    <MonitorCheck className="mt-0.5 shrink-0" size={16} />
                    <PanelBody tone="primary" size="compact" className="max-w-none">
                      Setup installs FleetBar and opens the same control plane the browser uses.
                    </PanelBody>
                  </div>
                </div>
                <div className="grid content-start gap-[var(--space-3)] border-l-2 border-[color:var(--brand-primary-foreground-subtle)] pl-[var(--space-4)]">
                  <PanelEyebrow tone="primary">Human path</PanelEyebrow>
                  <PanelBody tone="primary" size="compact" className="max-w-none">
                    Run setup, open FleetBar, choose a project, and continue in the GUI. If a hook,
                    skill, MCP server, app install, or daemon route drifts, doctor tells you what
                    changed and how to repair it.
                  </PanelBody>
                  <div className="flex items-center gap-[var(--space-2)] text-[var(--brand-primary-foreground)]">
                    <MonitorCheck size={16} />
                    <PanelEyebrow tone="primary">FleetBar is the operator view</PanelEyebrow>
                  </div>
                </div>
              </SurfacePanel>

              <SurfacePanel elevation="quiet" className="grid gap-[var(--space-4)]">
                <div className="grid gap-[var(--space-2)]">
                  <PanelEyebrow>How to open it</PanelEyebrow>
                  <PanelTitle as="h3" size="card" className="max-w-[18ch]">
                    The happy path is setup, then FleetBar.
                  </PanelTitle>
                </div>
                <ol className="grid gap-[var(--space-3)] md:grid-cols-2">
                  {downloadSteps.map((step, index) => (
                    <li
                      key={step}
                      className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)]"
                    >
                      <span className="inline-flex h-8 w-8 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] font-mono text-[length:var(--type-meta-size)] font-black text-[var(--text-primary)]">
                        {index + 1}
                      </span>
                      <PanelBody size="compact" className="max-w-none">
                        {step}
                      </PanelBody>
                    </li>
                  ))}
                </ol>
              </SurfacePanel>

              {/* Account pairing CTA — after install, the one command that
                  links this machine to your runs. Benefit first: receipts and
                  a shared view across devices, not "create an account". */}
              <SurfacePanel elevation="quiet" className="grid gap-[var(--space-4)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="grid gap-[var(--space-2)]">
                  <PanelEyebrow>Pair your devices</PanelEyebrow>
                  <PanelTitle as="h3" size="card" className="max-w-[24ch]">
                    Pair your devices — <span className="font-mono">pd account login</span>
                  </PanelTitle>
                  <PanelBody size="compact" className="max-w-[46rem]">
                    One sign-in links this Mac, the CLI, and FleetBar to the same account, so
                    every fleet run lands in your receipts — verdicts, ships, and cost you can
                    share as a link, from any of your machines.
                  </PanelBody>
                </div>
                <Button asChild variant="secondary" size="lg">
                  <a href="https://relay.portdaddy.dev/account/runs">
                    See your fleet&apos;s receipts
                    <ArrowRight size={16} />
                  </a>
                </Button>
              </SurfacePanel>

            </div>
          </SwissGridItem>
        </SwissGrid>
      </PageContainer>
    </section>
  )
}
