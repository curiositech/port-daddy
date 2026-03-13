import './App.css'
import { Link } from 'react-router-dom'
import { PortDaddyAnchor } from '@/components/PortDaddyMark'
import { Hero } from '@/components/landing/Hero'
import { DemoGallery } from '@/components/landing/DemoGallery'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { Features } from '@/components/landing/Features'
import { HarborsSection } from '@/components/landing/HarborsSection'
import { AgentEcosystem } from '@/components/landing/AgentEcosystem'
import { CTABanner } from '@/components/landing/CTABanner'

function Footer() {
  return (
    <footer
      className="py-12 px-4 sm:px-6 lg:px-8 border-t"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex flex-col items-center sm:items-start gap-1">
          <span className="font-mono font-bold text-lg flex items-center gap-2" style={{ color: 'var(--brand-primary)' }}>
            <PortDaddyAnchor size={18} style={{ color: 'var(--brand-primary)' }} />
            port-daddy
          </span>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            v3.7.0 · MIT License · Built for multi-agent workflows
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-6 text-sm" style={{ color: 'var(--text-muted)' }}>
          <a href="https://github.com/erichowens/port-daddy" target="_blank" rel="noopener noreferrer"
            className="transition-colors hover:text-[var(--text-primary)]">GitHub</a>
          <Link to="/docs" className="transition-colors hover:text-[var(--text-primary)] no-underline" style={{ color: 'var(--text-muted)' }}>Docs</Link>
          <Link to="/tutorials" className="transition-colors hover:text-[var(--text-primary)] no-underline" style={{ color: 'var(--text-muted)' }}>Tutorials</Link>
          <a href="#features" className="transition-colors hover:text-[var(--text-primary)]">Features</a>
        </div>
      </div>
    </footer>
  )
}

export default function App() {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      <main className="flex-1">
        <Hero />
        <DemoGallery />
        <HowItWorks />
        <Features />
        <HarborsSection />
        <AgentEcosystem />
        <CTABanner />
      </main>
      <Footer />
    </div>
  )
}
