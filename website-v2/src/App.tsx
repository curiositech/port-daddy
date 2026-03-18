import './App.css'
import { Hero } from '@/components/landing/Hero'
import { DemoGallery } from '@/components/landing/DemoGallery'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { Features } from '@/components/landing/Features'
import { BlueprintsSection } from '@/components/blueprints/BlueprintsSection'
import { HarborsSection } from '@/components/landing/HarborsSection'
import { AgentEcosystem } from '@/components/landing/AgentEcosystem'
import { MaturitySection } from '@/components/landing/MaturitySection'
import { CTABanner } from '@/components/landing/CTABanner'
import { Footer } from '@/components/layout/Footer'
import { Nav } from '@/components/landing/Nav'

export default function App() {
  return (
    <div className="min-h-screen bg-[var(--bg-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-on-primary)]">
      <Nav />
      
      <main id="main-content">
        <Hero />
        <DemoGallery />
        <HowItWorks />
        <Features />
        <BlueprintsSection />
        <HarborsSection />
        <AgentEcosystem />
        <MaturitySection />
      </main>

      <CTABanner />
      <Footer />
    </div>
  )
}
