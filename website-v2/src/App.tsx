import './App.css'
import { Hero } from '@/components/landing/Hero'
import { Features } from '@/components/landing/Features'
import { CTABanner } from '@/components/landing/CTABanner'
import { Footer } from '@/components/layout/Footer'
import { Nav } from '@/components/landing/Nav'

export default function App() {
  return (
    <div className="min-h-screen bg-[var(--bg-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-on-primary)]">
      <Nav />

      <main id="main-content">
        <Hero />
        <Features />
      </main>

      <CTABanner />
      <Footer />
    </div>
  )
}
