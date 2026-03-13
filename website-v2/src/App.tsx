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
import { motion } from 'framer-motion'

export default function App() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen flex flex-col selection:bg-[var(--brand-primary)] selection:text-white"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      <main className="flex-1">
        <Hero />
        <DemoGallery />
        <HowItWorks />
        <Features />
        <BlueprintsSection />
        <HarborsSection />
        <AgentEcosystem />
        <MaturitySection />
        <CTABanner />
      </main>
      <Footer />
    </motion.div>
  )
}
