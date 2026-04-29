import './App.css'
import { Hero } from '@/components/landing/Hero'
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
        <Hero />
        <CoordinationEnforcementSection />
        <AgentConversationSection />
        <AgenticSocialProofSection />
        <Features />
        <TerminalDemos />
      </main>

      <CTABanner />
      <Footer />
    </div>
  )
}
