import './App.css'
import { Nav } from '@/components/landing/Nav'
import { Hero } from '@/components/landing/Hero'
import { DemoGallery } from '@/components/landing/DemoGallery'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { Features } from '@/components/landing/Features'
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
          <span className="font-mono font-bold text-lg" style={{ color: 'var(--brand-primary)' }}>
            ⚓ port-daddy
          </span>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            v3.5.0 · MIT License · Built for multi-agent workflows
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-6 text-sm" style={{ color: 'var(--text-muted)' }}>
          <a href="https://github.com/erichowens/port-daddy" target="_blank" rel="noopener noreferrer"
            className="transition-colors hover:text-[var(--text-primary)]">GitHub</a>
          <a href="#docs" className="transition-colors hover:text-[var(--text-primary)]">Docs</a>
          <a href="#tutorials" className="transition-colors hover:text-[var(--text-primary)]">Tutorials</a>
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
      <Nav />
      <main className="flex-1">
        <Hero />
        <DemoGallery />
        <HowItWorks />
        <Features />
        <AgentEcosystem />
        <CTABanner />
      </main>
      <Footer />
    </div>
  )
}
