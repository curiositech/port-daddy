import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { MessageSquare, Zap, Terminal, Shield, Mail, Send, Activity, ArrowRight } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function Inbox() {
  return (
    <TutorialLayout
      title="The Agent Inbox"
      description="Coordination requires communication. Learn to use Port Daddy's internal messaging system to send direct signals, broadcast events, and monitor agent heartbeats in real-time."
      number={10}
      total={16}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: 'Identity Discovery', href: '/tutorials/dns' }}
      next={{ title: 'Swarm Bootstrapping', href: '/tutorials/spawn' }}
    >
      <motion.div className="space-y-16">
        {/* Concept Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Mail className="text-[var(--brand-secondary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Beyond Stdout</motion.h2>
          </motion.div>
          <motion.p>
            In a multi-agent swarm, logs are noisy and hard to parse. Port Daddy provides every agent with a dedicated **Inbox**--a structured messaging endpoint where it can receive direct instructions or status updates from other members of the harbor.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <motion.div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <Send size={20} className="text-[var(--brand-secondary)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Direct Signals</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Send targeted JSON payloads to a specific agent identity without broadcasting to the whole mesh.</motion.p>
             </motion.div>
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <motion.div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <Activity size={20} className="text-[var(--brand-accent)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Radio Stream</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Subscribe to any inbox live via SSE to monitor agent progress in your terminal or dashboard.</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: Sending */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Zap className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Send a Signal</motion.h2>
          </motion.div>

          <motion.p>
            Use the <code>msg send</code> command to route a message to an agent's inbox. You can send raw text or complex JSON objects.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd msg send swarm:analyst:main '{"task": "generate-report", "priority": "high"}'\n\n✓ Message routed to agent-7f3a.\n✓ Status: Received.`}
          </CodeBlock>

          <Surface depth="inset" radius="2xl" padding="none" className="p-8 border-l-4 border-[var(--brand-primary)]">
             <motion.p className="m-0 text-sm italic opacity-60 font-medium">
               The daemon ensures that the message is delivered even if the agent is currently busy, acting as a high-fidelity buffer between processes.
             </motion.p>
          </blockquote>
        </section>

        {/* Step 2: Watching */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Terminal className="text-[var(--brand-secondary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Watch the Stream</motion.h2>
          </motion.div>

          <motion.p>
            Want to see what an agent is receiving? Use <code>msg watch</code> to open a real-time SSE stream of an inbox.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd msg watch swarm:analyst:main\n\n[12:04:38] INCOMING: {"task": "generate-report"}\n[12:04:42] ACK: Processing started...`}
          </CodeBlock>

          <Surface depth="raised" radius="2xl" className="p-10 space-y-6 relative overflow-hidden">
             <motion.div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-secondary)]/5 to-transparent" />
             <motion.p className="text-sm font-black uppercase tracking-widest text-[var(--text-muted)] m-0">The Inter-Agent Bridge</motion.p>
             <motion.div className="flex items-center justify-between gap-10">
                <Surface depth="inset" radius="2xl" padding="none" className="flex-1 p-6 text-center">
                   <Badge variant="teal" className="mb-2">Agent 'alpha'</Badge>
                   <motion.p className="text-[10px] text-[var(--text-muted)] font-mono">pd msg send...</motion.p>
                </motion.div>
                <motion.div className="shrink-0">
                   <ArrowRight size={20} className="text-[var(--brand-primary)] animate-pulse" />
                </motion.div>
                <Surface depth="raised" radius="2xl" className="flex-1 p-6 text-center">
                   <Badge variant="gold" className="mb-2">Daemon Inbox</Badge>
                   <motion.p className="text-[10px] text-[var(--text-muted)] font-mono">Persistent Queue</motion.p>
                </motion.div>
                <motion.div className="shrink-0">
                   <ArrowRight size={20} className="opacity-40" />
                </motion.div>
                <Surface depth="inset" radius="2xl" padding="none" className="flex-1 p-6 text-center opacity-60">
                   <Badge variant="default" className="mb-2">Agent 'beta'</Badge>
                   <motion.p className="text-[10px] text-[var(--text-muted)] font-mono">pd sub...</motion.p>
                </motion.div>
             </motion.div>
          </motion.div>
        </section>

        {/* Vision Callout */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <MessageSquare size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Coordination Maturity</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Swarm Radio.</motion.h3>
           <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
             The inbox system is the foundation of <strong>Swarm Radio</strong>. In Port Daddy v3.7, we've moved beyond simple text logs to a structured, auditable communication mesh where every signal has an owner and a destination.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-secondary)]">
              <Shield size={14} className="animate-pulse" />
              Anchor Protocol v4 Secure
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
