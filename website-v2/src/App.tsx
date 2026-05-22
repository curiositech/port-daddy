import './App.css'
import { Hero } from '@/components/landing/Hero'
import { TubeShowcase } from '@/components/landing/TubeShowcase'
import { CoordinationEnforcementSection } from '@/components/landing/CoordinationEnforcementSection'
import { AgentConversationSection } from '@/components/landing/AgentConversationSection'
import { AgenticSocialProofSection } from '@/components/landing/AgenticSocialProofSection'
import { Features } from '@/components/landing/Features'
import { TerminalDemos } from '@/components/landing/TerminalDemos'
import { CTABanner } from '@/components/landing/CTABanner'
import { Footer } from '@/components/layout/Footer'

export default function App() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content">
        {/*
          IA order rationale (see docs/recovery/ia-audit-2026-05-20.md or
          the audit verdict in conversation logs):
            1. Hero            — "what is this and why should I care"
            2. TerminalDemos   — moved up; prove it's real before any
                                 conceptual scaffolding
            3. CoordinationEnforcementSection — the operator surface,
                                 now earned after seeing real commands
            4. AgentConversationSection — primitives, grounded in the
                                 demos above
            5. TubeShowcase    — deepest single-feature dive; now lands
                                 after the reader has a product model
                                 to attach it to (was position 2, too
                                 deep too fast)
            6. AgenticSocialProofSection — quotes (collapsed in a later
                                 slice; for now order matters more)
            7. Features        — catalog after the reader has context
        */}
        <Hero />
        <TerminalDemos />
        <CoordinationEnforcementSection />
        <AgentConversationSection />
        <TubeShowcase />
        <AgenticSocialProofSection />
        <Features />
      </main>

      <CTABanner />
      <Footer />
    </div>
  )
}
