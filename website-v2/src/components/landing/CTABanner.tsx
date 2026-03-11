import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'

export function CTABanner() {
  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(30,107,107,0.2) 0%, transparent 70%)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="relative max-w-3xl mx-auto text-center flex flex-col items-center gap-8"
      >
        <div
          className="font-mono text-sm px-4 py-1.5 rounded-full"
          style={{
            background: 'var(--badge-teal-bg)',
            color: 'var(--badge-teal-text)',
            border: '1px solid var(--badge-teal-border)',
          }}
        >
          Free · Open Source · MIT License
        </div>

        <h2 className="text-4xl sm:text-5xl font-bold" style={{ color: 'var(--text-primary)', lineHeight: 1.1 }}>
          Your agents are waiting for a
          <br />
          <span style={{ color: 'var(--brand-primary)' }}>harbormaster</span>
        </h2>

        <p className="text-xl max-w-xl" style={{ color: 'var(--text-secondary)' }}>
          One daemon install. All your agents coordinated.
          Port collisions, dead-agent work loss, and race conditions — gone.
        </p>

        <div className="flex flex-wrap gap-4 justify-center">
          <Button size="lg">
            brew install port-daddy
          </Button>
          <Button variant="outline" size="lg"
            onClick={() => window.open('https://github.com/erichowens/port-daddy', '_blank')}
          >
            Read the Docs
          </Button>
        </div>

        {/* Quick terminal snippet */}
        <div
          className="font-mono text-sm px-6 py-4 rounded-xl text-left w-full max-w-sm"
          style={{
            background: 'var(--codeblock-bg)',
            border: '1px solid var(--border-default)',
          }}
        >
          <div>
            <span style={{ color: 'var(--code-prompt)' }}>$ </span>
            <span style={{ color: 'var(--text-primary)' }}>brew install port-daddy</span>
          </div>
          <div className="mt-1" style={{ color: 'var(--code-output)' }}>
            ✓ port-daddy 3.5.0 installed
          </div>
          <div className="mt-1">
            <span style={{ color: 'var(--code-prompt)' }}>$ </span>
            <span style={{ color: 'var(--text-primary)' }}>pd</span>
          </div>
          <div style={{ color: 'var(--code-output)' }}>
            ⚓ Port Daddy v3.5.0 — all clear
          </div>
        </div>
      </motion.div>
    </section>
  )
}
