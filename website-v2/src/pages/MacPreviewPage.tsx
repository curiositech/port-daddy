import { ArrowRight, Download, MonitorCheck } from 'lucide-react'
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
                  <PanelEyebrow>The Mac app</PanelEyebrow>
                  <PanelTitle as="h1" size="hero" className="max-w-[14ch]">
                    See what your coding agents are doing, in your menu bar.
                  </PanelTitle>
                  <PanelBody className="max-w-[44rem] text-[length:var(--text-lg)]">
                    FleetBar is the Mac app for Port Daddy. It lives in your menu bar and
                    shows the work that is usually buried in terminals: which agent is
                    running, which files each one has claimed, what is ready to run next,
                    and the messages they pass back and forth. You can read all of it
                    without opening a shell.
                  </PanelBody>
                  <div className="flex flex-wrap gap-[var(--space-3)]">
                    <Button asChild variant="primary" size="lg">
                      <a href="#download">
                        <Download size={16} />
                        Get the Mac app
                        <ArrowRight size={16} />
                      </a>
                    </Button>
                  </div>
                </div>
              </SwissGridItem>

              <SwissGridItem span="narrow">
                <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-4)]">
                  <div className="grid gap-[var(--space-2)]">
                    <PanelEyebrow>What you see first</PanelEyebrow>
                    <PanelTitle as="h2" size="nav" className="max-w-[18ch]">
                      Open it, and the work is already on screen.
                    </PanelTitle>
                    <PanelBody size="compact" className="max-w-none">
                      One window for the project you are on: whether Port Daddy is running,
                      which agents are working, what they have claimed, and the handoffs
                      between them. No shell prompt to find first.
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
                    <PanelEyebrow className="text-[var(--brand-primary)]">No terminal required</PanelEyebrow>
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
