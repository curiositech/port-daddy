import { Link } from 'react-router-dom'
import { ArrowRight, Download, MonitorCog, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { MacAppShowcase } from '@/components/landing/MacAppShowcase'
import { ColdStartSection } from '@/components/landing/ColdStartSection'
import { DistributionSection } from '@/components/landing/DistributionSection'
import { MacWorkflowDemos } from '@/components/landing/MacWorkflowDemos'
import { Footer } from '@/components/layout/Footer'
import {
  CommandBlock,
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
            <SwissGrid className="items-end">
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
                      <a href="/downloads/PortDaddy-FleetBar-macOS-arm64-dev.zip" download>
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
                        <Terminal size={16} />
                        Learn the primitives
                      </Link>
                    </Button>
                  </div>
                </div>
              </SwissGridItem>

              <SwissGridItem span="rail">
                <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-3)]">
                  <PanelEyebrow>Stable install</PanelEyebrow>
                  <CommandBlock
                    title="Install + open"
                    command={'brew install curiositech/tap/port-daddy\npd setup --project ~/coding/my-app'}
                    elevation="quiet"
                    hideLabel
                  />
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
