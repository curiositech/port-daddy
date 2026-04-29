import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Zap, Terminal, Shield, Mail, Send, Activity, ArrowRight } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function Inbox() {
  return (
    <TutorialLayout
      title="The Agent Inbox"
      description="Coordination requires communication. Learn to use Port Daddy's internal messaging system to send direct signals, broadcast events, and monitor agent heartbeats in real-time."
      number={9}
      total={21}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: 'Session Phases', href: '/tutorials/session-phases' }}
      next={{ title: 'Sugar Commands', href: '/tutorials/sugar' }}
    >
      <div className="space-y-12">
        {/* Concept Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <Mail className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">Beyond Stdout</h2>
          </div>
          <p>
            In a multi-agent swarm, logs are noisy and hard to parse. Port Daddy provides every agent with a dedicated <strong>Inbox</strong> -- a structured messaging endpoint where it can receive direct instructions or status updates from other members of the harbor.
          </p>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-[var(--text-secondary)] m-0">
              <Send size={14} className="inline text-[var(--brand-secondary)] mr-1" />
              <strong>Direct Signals</strong> -- Send targeted JSON payloads to a specific agent identity without broadcasting to the whole mesh.
            </p>
            <p className="text-sm text-[var(--text-secondary)] m-0">
              <Activity size={14} className="inline text-[var(--brand-accent)] mr-1" />
              <strong>Radio Stream</strong> -- Subscribe to any inbox live via SSE to monitor agent progress in your terminal or dashboard.
            </p>
          </div>
        </section>

        {/* Step 1: Sending */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <Zap className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. Send a Signal</h2>
          </div>

          <p>
            Use the <code>msg send</code> command to route a message to an agent's inbox. You can send raw text or complex JSON objects.
          </p>

          <CodeBlock language="bash">
            {`$ pd pub swarm:analyst:main '{"task": "generate-report", "priority": "high"}'\n\n✓ Message routed to agent-7f3a.\n✓ Status: Received.`}
          </CodeBlock>

          <p className="m-0 text-sm border-l-4 border-[var(--brand-secondary)] pl-4" style={{ color: 'var(--text-secondary)' }}>
            The daemon ensures that the message is delivered even if the agent is currently busy, acting as a high-fidelity buffer between processes.
          </p>
        </section>

        {/* Step 2: Watching */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <Terminal className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">2. Watch the Stream</h2>
          </div>

          <p>
            Want to see what an agent is receiving? Use <code>msg watch</code> to open a real-time SSE stream of an inbox.
          </p>

          <CodeBlock language="bash">
            {`$ pd msg watch swarm:analyst:main\n\n[12:04:38] INCOMING: {"task": "generate-report"}\n[12:04:42] ACK: Processing started...`}
          </CodeBlock>

          <Surface depth="inset" radius="xl" className="p-5 space-y-3">
            <p className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)] m-0">The Inter-Agent Bridge</p>
            <div className="flex items-center justify-between text-xs font-mono gap-4">
              <span>
                <Badge variant="teal" className="mr-2">alpha</Badge>
                <code className="text-[var(--text-muted)]">pd pub...</code>
              </span>
              <ArrowRight size={14} className="text-[var(--brand-primary)] shrink-0" />
              <span>
                <Badge variant="gold" className="mr-2">Daemon</Badge>
                <code className="text-[var(--text-muted)]">Queue</code>
              </span>
              <ArrowRight size={14} className="opacity-40 shrink-0" />
              <span className="opacity-60">
                <Badge variant="default" className="mr-2">beta</Badge>
                <code className="text-[var(--text-muted)]">pd sub...</code>
              </span>
            </div>
          </Surface>
        </section>

        {/* Vision Callout */}
        <section className="p-6 text-center space-y-4">
          <p className="text-lg max-w-xl mx-auto text-[var(--text-secondary)]">
            The inbox system is the foundation of <strong>Swarm Radio</strong>. In Port Daddy v3.7, we've moved beyond simple text logs to a structured, auditable communication mesh where every signal has an owner and a destination.
          </p>
          <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-secondary)]">
            <Shield size={14} />
            SQLite-Backed Persistence
          </div>
        </section>
      </div>
    </TutorialLayout>
  )
}
