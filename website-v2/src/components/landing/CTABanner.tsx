import { Button } from '@/components/ui/Button'
import { Link } from 'react-router-dom'
import { Github, Terminal, Sparkles } from 'lucide-react'

export function CTABanner() {
  return (
    <section className="relative py-24 lg:py-32 overflow-hidden noise">
      {/* Full-bleed dark background with teal glow */}
      <div className="absolute inset-0 bg-[#050d0c]" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 800px 400px at 50% 0%, rgba(13, 148, 136, 0.15) 0%, transparent 70%),
            radial-gradient(ellipse 600px 300px at 80% 100%, rgba(6, 182, 212, 0.08) 0%, transparent 60%)
          `
        }}
      />

      <div className="relative z-10 max-w-[800px] mx-auto px-6 lg:px-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#5eead4] mb-6">
          Get Started
        </p>

        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-white mb-4 leading-tight">
          One daemon to rule your swarm.
        </h2>

        <p className="text-lg text-[#a3a3a3] max-w-xl mx-auto mb-10">
          Port Daddy is open-source and installs in seconds. Start building your autonomous organization today.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4 mb-10">
          <a
            href="https://github.com/erichowens/port-daddy"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="lg" className="gap-2 bg-white text-[#0a0a0a] hover:bg-white/90 border-0 font-semibold">
              <Github size={18} />
              Star on GitHub
            </Button>
          </a>
          <Link to="/tutorials/getting-started">
            <Button variant="outline" size="lg" className="gap-2 text-white border-white/20 hover:bg-white/10 hover:border-white/40">
              <Sparkles size={18} />
              Learn the Protocol
            </Button>
          </Link>
        </div>

        {/* Install Command */}
        <div className="inline-flex items-center gap-3 px-5 py-3 rounded-lg bg-white/5 border border-white/10 font-mono text-sm text-white/70">
          <Terminal size={16} className="text-[#5eead4]" />
          <span>brew install erichowens/port-daddy</span>
        </div>

        <p className="mt-4 text-xs text-white/40">
          Free &middot; Open Source &middot; MIT License
        </p>
      </div>
    </section>
  )
}
