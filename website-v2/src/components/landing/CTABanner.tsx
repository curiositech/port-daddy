import { Link } from 'react-router-dom'
import { Github, Terminal, Sparkles } from 'lucide-react'

export function CTABanner() {
  return (
    <section className="relative py-24 lg:py-32 overflow-hidden">
      {/* Neumorphic surface with subtle teal wash */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, var(--bg-base) 0%, #d6ddd9 50%, var(--bg-base) 100%)',
        }}
      />

      <div className="relative z-10 max-w-[800px] mx-auto px-6 lg:px-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--brand-secondary)] mb-6">
          Get Started
        </p>

        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[var(--text-primary)] mb-4 leading-tight">
          One daemon to rule your swarm.
        </h2>

        <p className="text-lg text-[var(--text-secondary)] max-w-xl mx-auto mb-10">
          Port Daddy is open-source and installs in seconds. Start building your autonomous organization today.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4 mb-10">
          <a
            href="https://github.com/erichowens/port-daddy"
            target="_blank"
            rel="noopener noreferrer"
          >
            <button
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-lg font-semibold text-white cursor-pointer transition-all duration-200"
              style={{
                background: '#0d9488',
                boxShadow: '4px 4px 8px #b8b8b8, -4px -4px 8px #ffffff',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '2px 2px 4px #b8b8b8, -2px -2px 4px #ffffff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = '4px 4px 8px #b8b8b8, -4px -4px 8px #ffffff'
              }}
            >
              <Github size={18} />
              Star on GitHub
            </button>
          </a>
          <Link to="/tutorials/getting-started">
            <button
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-lg font-semibold text-[var(--text-primary)] cursor-pointer transition-all duration-200"
              style={{
                background: 'var(--bg-surface)',
                boxShadow: '4px 4px 8px #b8b8b8, -4px -4px 8px #ffffff',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '2px 2px 4px #b8b8b8, -2px -2px 4px #ffffff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = '4px 4px 8px #b8b8b8, -4px -4px 8px #ffffff'
              }}
            >
              <Sparkles size={18} />
              Learn the Protocol
            </button>
          </Link>
        </div>

        {/* Install Command - inset neumorphic */}
        <div
          className="inline-flex items-center gap-3 px-5 py-3 font-mono text-sm text-[var(--text-secondary)]"
          style={{
            background: 'var(--bg-base)',
            boxShadow: 'inset 3px 3px 6px #c4c4c4, inset -3px -3px 6px #ffffff',
            borderRadius: '12px',
          }}
        >
          <Terminal size={16} className="text-[#0d9488]" />
          <span>brew install erichowens/port-daddy</span>
        </div>

        <p className="mt-4 text-xs text-[var(--text-muted)]">
          Free &middot; Open Source &middot; MIT License
        </p>
      </div>
    </section>
  )
}
