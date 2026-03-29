import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Shield, Network, Cpu, Lock, Waves } from 'lucide-react'

export function RoadmapPage() {
  const phases = [
    {
      title: 'Phase 1: The Secure Core',
      status: 'shipped',
      description: 'Formal verification of the Anchor Protocol via ProVerif. TypeScript daemon shipped with SQLite-backed state, atomic port assignment, and HMAC-signed harbor tokens.',
      icon: <Shield className="w-8 h-8 text-[var(--brand-primary)]" />
    },
    {
      title: 'Phase 2: Distributed Arbiters',
      status: 'preview',
      description: 'Introduction of ambient security agents that monitor Harbor state transitions in real-time, enforcing formally proven rules without human intervention.',
      icon: <Lock className="w-8 h-8 text-[var(--brand-secondary)]" />
    },
    {
      title: 'Phase 3: Stigmergic Pheromones',
      status: 'preview',
      description: 'Dynamic metadata decay systems allowing agents to coordinate via environmental traces. Think termite mounds, but for your microservices.',
      icon: <Waves className="w-8 h-8 text-[var(--brand-secondary)]" />
    },
    {
      title: 'Phase 4: Multi-hop Delegation',
      status: 'planned',
      description: 'Offline token attenuation based on Macaroons. Agents can spawn sub-agents with restricted subsets of their own capabilities.',
      icon: <Network className="w-8 h-8 text-[var(--brand-accent)]" />
    }
  ];

  return (
    <div className="min-h-screen pt-32 pb-24" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-5xl mx-auto px-6 lg:px-8">
        <header className="mb-24 text-center max-w-3xl mx-auto">
          <Surface depth="inset" radius="full" padding="none" className="inline-flex items-center gap-2 px-4 py-1.5 mb-8">

            <Cpu size={14} className="text-[var(--brand-primary)]" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Roadmap to v4.0</span>
          </Surface>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-6xl sm:text-8xl font-display font-black tracking-tighter leading-[0.9] mb-10 text-[var(--text-primary)]"
          >
            The Future of <span className="text-[var(--brand-primary)]">Agentic Trust.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-xl leading-relaxed text-[var(--text-secondary)]"
          >
            We are moving beyond simple port management toward a decentralized, formally verified control plane. No more edit wars. No more ghost processes. Just pure, mathematical coordination.
          </motion.p>
        </header>

        <div className="grid gap-8">
          {phases.map((phase, i) => (
            <motion.div
              key={phase.title}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
            >
            <Surface depth="raised" radius="2xl" padding="none" className="group p-10 transition-all flex flex-col md:flex-row gap-10 items-start">
              <Surface depth="inset" radius="2xl" padding="none" className="p-6 group-hover:scale-110 transition-transform">

                {phase.icon}
              </Surface>
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-3xl font-display font-bold text-[var(--text-primary)]">{phase.title}</h2>
                  <Badge variant={phase.status === 'shipped' ? 'teal' : phase.status === 'active' ? 'gold' : 'default'} className="uppercase text-[8px] font-black tracking-widest">
                    {phase.status}
                  </Badge>
                </div>
                <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-2xl">
                  {phase.description}
                </p>
                {/* Progress indicator with inset track */}
                <div
                  className="h-2 w-full rounded-full overflow-hidden"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: phase.status === 'shipped' ? 'var(--brand-primary)' : phase.status === 'active' ? 'var(--brand-accent)' : 'var(--text-muted)',
                      width: phase.status === 'shipped' ? '100%' : phase.status === 'active' ? '60%' : phase.status === 'preview' ? '20%' : '5%'
                    }}
                    initial={{ width: 0 }}
                    whileInView={{ width: phase.status === 'shipped' ? '100%' : phase.status === 'active' ? '60%' : phase.status === 'preview' ? '20%' : '5%' }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, delay: i * 0.15 }}
                  />
                </div>
              </div>
            </Surface>
            </motion.div>
          ))}
        </div>

        {/* Timeline connector */}
        <div className="flex justify-center my-8">
          <div className="w-[2px] h-16" style={{ background: 'var(--brand-accent)' }} />
        </div>

        <Surface depth="raised" radius="2xl" padding="none">
          <motion.footer
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            className="p-16 text-center space-y-8"
          >
          <h3 className="text-4xl font-display font-black text-[var(--text-primary)]">Ready to Build the Swarm?</h3>
          <p className="text-lg text-[var(--text-secondary)] max-w-xl mx-auto">
            Our formal verification models and TypeScript daemon are open source. Dive into the math and help us define the Anchor Protocol.
          </p>
          <div className="flex justify-center gap-4">
            <span
              className="px-6 py-2 rounded-xl cursor-pointer text-sm font-bold text-[var(--text-primary)]"
              style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' }}
            >GitHub</span>
            <span
              className="px-6 py-2 rounded-xl cursor-pointer text-sm font-bold text-[var(--text-inverse)]"
              style={{ background: 'var(--brand-primary)', boxShadow: 'var(--shadow-sm)' }}
            >Documentation</span>
          </div>
          </motion.footer>
        </Surface>
      </div>
    </div>
  )
}
