import './App.css'
import { Hero } from '@/components/landing/Hero'
import { Features } from '@/components/landing/Features'
import { TerminalDemos } from '@/components/landing/TerminalDemos'
import { CTABanner } from '@/components/landing/CTABanner'
import { Footer } from '@/components/layout/Footer'
import { Nav } from '@/components/landing/Nav'

export default function App() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-white">
      <Nav />

      <main id="main-content">
        <Hero />
        <Features />
        <TerminalDemos />
      </main>

      <CTABanner />
      <Footer />
    </div>
  )
}
