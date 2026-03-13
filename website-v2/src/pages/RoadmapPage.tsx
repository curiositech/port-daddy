import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Shield, Network, Cpu, Lock, Waves } from 'lucide-react'

export function RoadmapPage() {
  const phases = [
    {
      title: 'Phase 1: The Secure Core',
      status: 'shipped',
      description: 'Formal verification of the Anchor Protocol via ProVerif and transition to memory-safe Rust for sensitive cryptographic parsing.',
      icon: <Shield className="w-8 h-8 text-[var(--brand-primary)]" />
    },
    {
      title: 'Phase 2: Distributed Arbiters',
      status: 'active',
      description: 'Introduction of ambient security agents that monitor Harbor state transitions in real-time, enforcing formally proven rules without human intervention.',
      icon: <Lock className="w-8 h-8 text-[var(--p-teal-400)]" />
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
    <div className="min-h-screen pt-32 pb-24 bg-[var(--bg-base)]">
      <div className="max-w-5xl mx-auto px-6 lg:px-8">
        <header className="mb-24 text-center max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[var(--bg-overlay)] border border-[var(--border-subtle)] mb-8"
          >
            <Cpu size={14} className="text-[var(--brand-primary)]" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60 text-[var(--text-primary)]">Roadmap to v4.0</span>
          </motion.div>
          
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
              className="group p-10 rounded-[40px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--brand-primary)] transition-all flex flex-col md:flex-row gap-10 items-start"
            >
              <div className="p-6 rounded-3xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] group-hover:scale-110 transition-transform">
                {phase.icon}
              </div>
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-3xl font-display font-bold text-[var(--text-primary)]">{phase.title}</h2>
                  <Badge variant={phase.status === 'shipped' ? 'teal' : phase.status === 'active' ? 'amber' : 'neutral'} className="uppercase text-[8px] font-black tracking-widest">
                    {phase.status}
                  </Badge>
                </div>
                <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-2xl">
                  {phase.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.footer 
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          className="mt-32 p-16 rounded-[60px] bg-gradient-to-br from-[var(--bg-overlay)] to-transparent border border-[var(--border-subtle)] text-center space-y-8"
        >
          <h3 className="text-4xl font-display font-black text-[var(--text-primary)]">Ready to Build the Swarm?</h3>
          <p className="text-lg text-[var(--text-secondary)] max-w-xl mx-auto">
            Our formal verification models and Rust core are open source. Dive into the math and help us define the Anchor Protocol.
          </p>
          <div className="flex justify-center gap-4">
            <Badge variant="neutral" className="px-6 py-2 cursor-pointer hover:bg-[var(--interactive-hover)]">GitHub</Badge>
            <Badge variant="teal" className="px-6 py-2 cursor-pointer">Documentation</Badge>
          </div>
        </motion.footer>
      </div>
    </div>
  )
}
