import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Link } from 'react-router-dom'
import { Github, Terminal, Sparkles, Anchor } from 'lucide-react'

export function CTABanner() {
  return (
    <section className="py-24 lg:py-32 bg-[var(--bg-surface)]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        <div className="relative p-8 lg:p-16 rounded-2xl bg-[var(--bg-base)] border border-[var(--border-subtle)] overflow-hidden">
          {/* Background gradient */}
          <div 
            className="absolute inset-0 opacity-[0.03]"
            style={{ background: 'radial-gradient(circle at 50% 50%, var(--brand-primary) 0%, transparent 70%)' }}
          />

          <div className="relative z-10 text-center">
            {/* Icon */}
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--interactive-active)] mb-8">
              <Anchor className="text-[var(--brand-primary)]" size={32} />
            </div>

            <Badge variant="teal" className="mb-4 block w-fit mx-auto">Get Started</Badge>
            
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[var(--text-primary)] mb-4">
              Your agents deserve a <span className="text-[var(--brand-primary)]">harbormaster</span>
            </h2>
            
            <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto mb-8">
              The era of wobbly scripts and port conflicts is over. Build swarms that are resilient, cryptographically secure, and always-on.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center justify-center gap-4 mb-8">
              <a 
                href="https://github.com/erichowens/port-daddy" 
                target="_blank" 
                rel="noopener noreferrer"
              >
                <Button size="lg" className="gap-2">
                  <Github size={20} />
                  Star on GitHub
                </Button>
              </a>
              <Link to="/tutorials/getting-started">
                <Button variant="secondary" size="lg" className="gap-2">
                  <Sparkles size={20} />
                  Learn the Protocol
                </Button>
              </Link>
            </div>

            {/* Install Command */}
            <div className="inline-flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-sm">
              <Terminal size={16} className="text-[var(--text-muted)]" />
              <span className="text-[var(--text-secondary)]">brew install erichowens/port-daddy</span>
            </div>
            
            <p className="mt-4 text-xs text-[var(--text-muted)]">
              Free · Open Source · MIT License
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
