import './App.css'
import { Nav } from '@/components/landing/Nav'
import { Hero } from '@/components/landing/Hero'
import { Features } from '@/components/landing/Features'

function Footer() {
  return (
    <footer
      className="py-12 px-4 sm:px-6 lg:px-8 border-t"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold" style={{ color: 'var(--brand-primary)' }}>
            ⚓ port-daddy
          </span>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            v3.5.0 · MIT License
          </span>
        </div>
        <div className="flex items-center gap-6 text-sm" style={{ color: 'var(--text-muted)' }}>
          <a href="https://github.com/erichowens/port-daddy" target="_blank" rel="noopener noreferrer"
            className="hover:text-[var(--text-primary)] transition-colors">GitHub</a>
          <a href="#docs" className="hover:text-[var(--text-primary)] transition-colors">Docs</a>
          <a href="#tutorials" className="hover:text-[var(--text-primary)] transition-colors">Tutorials</a>
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
        <Features />
      </main>
      <Footer />
    </div>
  )
}
