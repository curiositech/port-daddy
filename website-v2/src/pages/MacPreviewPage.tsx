import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Download, MonitorCheck, MonitorCog } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { MacAppShowcase } from '@/components/landing/MacAppShowcase'
import { ColdStartSection } from '@/components/landing/ColdStartSection'
import { DistributionSection } from '@/components/landing/DistributionSection'
import { MacWorkflowDemos } from '@/components/landing/MacWorkflowDemos'
import { Footer } from '@/components/layout/Footer'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

export function MacPreviewPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content">
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-center">
              <SwissGridItem span="wide">
                <div className="space-y-[var(--space-5)]">
                  <PanelEyebrow>Mac Preview</PanelEyebrow>
                  <PanelTitle as="h1" size="hero" className="max-w-[12ch]">
                    FleetBar is the Mac app for agent coordination.
                  </PanelTitle>
                  <PanelBody className="max-w-[44rem] text-[length:var(--text-lg)]">
                    The native menu-bar app opens the real Fleet Control Center: Flow, Roadmap,
                    Agents, Resources, Activity, Channels, Inbox, Sorties, Memory, Shipwright,
                    YAML, backend readiness, and project-scoped coordination state. This is where
                    the daemon becomes visible enough for a Mac developer to trust.
                  </PanelBody>
                  <div className="flex flex-wrap gap-[var(--space-3)]">
                    <Button asChild variant="primary" size="lg">
                      <a href="/downloads/PortDaddy-FleetBar-macOS-arm64.zip" download>
                        <Download size={16} />
                        Download FleetBar
                        <ArrowRight size={16} />
                      </a>
                    </Button>
                    <Button asChild variant="secondary" size="lg">
                      <a href="#cold-start">
                        <MonitorCog size={16} />
                        Shipwright cold start
                      </a>
                    </Button>
                    <Button asChild variant="ghost" size="lg">
                      <Link to="/tutorials/primitives">
                        <BookOpen size={16} />
                        Learn the primitives
                      </Link>
                    </Button>
                  </div>
                </div>
              </SwissGridItem>

              <SwissGridItem span="narrow">
                <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-4)]">
                  <div className="grid gap-[var(--space-2)]">
                    <PanelEyebrow>Human entry</PanelEyebrow>
                    <PanelTitle as="h2" size="nav" className="max-w-[18ch]">
                      Open the app, then decide.
                    </PanelTitle>
                    <PanelBody size="compact" className="max-w-none">
                      FleetBar shows daemon health, selected project, agent work, resources,
                      inboxes, and handoffs before anyone needs a shell prompt.
                    </PanelBody>
                  </div>
                  <picture className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                    <source srcSet="/img/app-screens/fleetbar-native-shell-dark.png" media="(prefers-color-scheme: dark)" />
                    <img
                      src="/img/app-screens/fleetbar-native-shell-light.png"
                      alt="FleetBar native Mac window showing the Fleet Control Center"
                      className="aspect-[16/10] w-full object-cover"
                      loading="eager"
                    />
                  </picture>
                  <div className="flex items-center gap-[var(--space-2)] text-[var(--brand-primary)]">
                    <MonitorCheck size={16} />
                    <PanelEyebrow className="text-[var(--brand-primary)]">GUI-first preview</PanelEyebrow>
                  </div>
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        <MacAppShowcase />
        <ColdStartSection />
        <MacWorkflowDemos />
        <DistributionSection />
      </main>
      <Footer />
    </div>
  )
}
