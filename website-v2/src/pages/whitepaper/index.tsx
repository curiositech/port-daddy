import * as React from 'react'
import { motion } from 'framer-motion'
import {
  FileText,
  Download,
  Shield,
  CheckCircle,
  Lock,
  Terminal,
  Scale,
  Handshake,
  Eye,
  Anchor
} from 'lucide-react'
import { Surface } from '@/components/ui/Surface'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

interface Paper {
  id: string
  title: string
  subtitle: string
  filename: string
  date: string
  pages: number
  sizeKb: number
  badge: string
  badgeVariant: 'red' | 'teal' | 'gold' | 'default'
  highlights: Array<{ icon: typeof Shield; label: string; badgeVariant: 'red' | 'teal' | 'gold' | 'default' | 'success' }>
  sections: Array<{ title: string; content: string }>
}

const PAPERS: Paper[] = [
  {
    id: 'bonded-commons',
    title: 'The Bonded Commons',
    subtitle: 'Pre-Transactional Trust Infrastructure for Multi-Agent Systems',
    filename: 'agent-transactions-whitepaper',
    date: 'March 2026',
    pages: 16,
    sizeKb: 400,
    badge: 'New',
    badgeVariant: 'red',
    highlights: [
      { icon: Scale, label: "Sen's Impossibility Applied", badgeVariant: 'gold' },
      { icon: Handshake, label: 'Collateralized Contracts', badgeVariant: 'success' },
      { icon: Eye, label: 'Immutable Attribution', badgeVariant: 'teal' },
      { icon: Terminal, label: 'TLA+ Verified', badgeVariant: 'default' },
    ],
    sections: [
      {
        title: 'The Trust Problem',
        content: 'There will be no AI economy without trust, and trust cannot be earned peer-to-peer at every transaction. Multi-agent collaboration requires a commons authority that provides trust as infrastructure, not trust as ceremony.'
      },
      {
        title: 'Three Layers',
        content: 'Structural prevention via capability tokens (walls, not laws). Immutable attribution via Merkle-chained evidence trails. Economic alignment via collateralized work contracts that pre-fund damage regardless of intent.'
      },
      {
        title: 'Why Advisory Claims',
        content: "Grounded in Sen's Impossibility of a Paretian Liberal: enforced file allocation with private agent knowledge is provably suboptimal. The authority provides information, not allocation decisions."
      },
      {
        title: 'The Open Problem',
        content: 'Bond pricing: designing a function that makes defection expensive without pricing legitimate agents out of the commons. A mechanism design problem at the intersection of systems engineering and economics.'
      }
    ]
  },
  {
    id: 'anchor-protocol',
    title: 'The Anchor Protocol',
    subtitle: 'A Formally Verified Control Plane for Local Agent Swarms',
    filename: 'anchor-protocol-whitepaper',
    date: 'March 2026',
    pages: 12,
    sizeKb: 368,
    badge: 'Foundation',
    badgeVariant: 'teal',
    highlights: [
      { icon: Shield, label: 'ProVerif Verified', badgeVariant: 'success' },
      { icon: Lock, label: 'Memory Safe (Rust)', badgeVariant: 'teal' },
      { icon: CheckCircle, label: 'Constant-Time Crypto', badgeVariant: 'default' },
      { icon: Terminal, label: 'Formal Methods', badgeVariant: 'gold' },
    ],
    sections: [
      {
        title: 'Abstract',
        content: 'Introduces the Anchor Protocol, a cryptographic and semantic identity framework. Details the evolution from symmetric MACs to asymmetric Ed25519 signatures and multi-hop delegation chains inspired by Macaroons.'
      },
      {
        title: 'The Local Swarm Problem',
        content: 'Three critical threat vectors on localhost: port squatting, resource contention, and privilege escalation between concurrent agents.'
      },
      {
        title: 'Formal Verification',
        content: "ProVerif symbolic analysis proves Injective Agreement: capabilities cannot be escalated and trust is perfectly transitive across delegation chains. Kani verifies memory safety and constant-time comparisons."
      },
      {
        title: 'Implementation',
        content: 'Rust-based core with Ed25519 signatures, constant-time cryptographic comparisons, and offline capability attenuation for multi-hop delegation without daemon round-trips.'
      }
    ]
  }
]

export default function WhitepaperPage() {
  const [activePaper, setActivePaper] = React.useState<string>(PAPERS[0].id)
  const [isLoading, setIsLoading] = React.useState(true)

  const paper = PAPERS.find(p => p.id === activePaper)!

  return (
    <div className="min-h-screen pt-20" style={{ background: 'var(--surface-base)' }}>
      {/* Hero */}
      <section className="py-16 px-6 sm:px-8 lg:px-10">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center gap-6"
          >
            <Badge variant="red" size="lg" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.2em]">
              White Papers
            </Badge>

            <motion.div
              className="w-20 h-20 rounded-[28px] flex items-center justify-center"
              style={{
                background: 'var(--surface-base)',
                boxShadow: 'var(--shadow-inset)',
              }}
            >
              <Anchor size={36} style={{ color: 'var(--brand-primary)' }} />
            </motion.div>

            <h1
              className="text-4xl sm:text-5xl lg:text-6xl font-display font-black tracking-tighter leading-[0.9]"
              style={{ color: 'var(--text-primary)' }}
            >
              Formal Foundations
            </h1>

            <p className="text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              by <strong style={{ color: 'var(--text-primary)' }}>Erich Owens</strong> — Cryptographic identity,
              commons governance, and collateralized coordination for multi-agent systems.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Paper Selector — radio cards */}
      <section className="px-6 sm:px-8 lg:px-10 pb-10">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-6">
          {PAPERS.map((p) => {
            const isActive = activePaper === p.id
            return (
              <Surface
                key={p.id}
                depth={isActive ? 'inset' : 'raised'}
                radius="2xl"
                padding="lg"
                interactive
                className="text-left cursor-pointer"
                onClick={() => { setActivePaper(p.id); setIsLoading(true) }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {/* Radio indicator */}
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                      style={{
                        border: `2px solid ${isActive ? 'var(--brand-primary)' : 'var(--text-muted)'}`,
                      }}
                    >
                      {isActive && (
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--brand-primary)' }} />
                      )}
                    </div>
                    <Badge variant={p.badgeVariant} size="sm">{p.badge}</Badge>
                  </div>
                  <FileText
                    size={20}
                    style={{ color: isActive ? 'var(--brand-primary)' : 'var(--text-muted)' }}
                  />
                </div>
                <h2
                  className="text-xl font-bold tracking-tight mb-2"
                  style={{ color: isActive ? 'var(--brand-primary)' : 'var(--text-primary)' }}
                >
                  {p.title}
                </h2>
                <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-muted)' }}>
                  {p.subtitle}
                </p>
                <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>{p.date}</span>
                  <span>{p.pages} pages</span>
                  <span>{p.sizeKb} KB</span>
                </div>
              </Surface>
            )
          })}
        </div>
      </section>

      {/* Active Paper Badges */}
      <section className="px-6 sm:px-8 lg:px-10 pb-10">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-center gap-3">
          {paper.highlights.map((h, i) => (
            <motion.div
              key={h.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.06 }}
            >
              <Badge variant={h.badgeVariant} size="md" className="gap-1.5">
                <h.icon size={12} />
                {h.label}
              </Badge>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Key Highlights */}
      <section className="py-12 px-6 sm:px-8 lg:px-10">
        <div className="max-w-5xl mx-auto">
          <Surface depth="flat" radius="2xl" padding="lg">
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {paper.sections.map((section, i) => (
                <motion.div
                  key={`${paper.id}-${section.title}`}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.5 }}
                  className="space-y-3"
                >
                  <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                    {section.title}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {section.content}
                  </p>
                </motion.div>
              ))}
            </div>
          </Surface>
        </div>
      </section>

      {/* PDF Viewer */}
      <section className="py-12 px-6 sm:px-8 lg:px-10">
        <div className="max-w-5xl mx-auto">
          <Surface depth="raised" radius="2xl" padding="none" className="overflow-hidden">
            {/* PDF Toolbar */}
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <div className="flex items-center gap-3">
                <FileText size={18} style={{ color: 'var(--brand-primary)' }} />
                <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                  {paper.filename}.pdf
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {paper.sizeKb} KB
                </span>
                <Button variant="primary" size="sm" asChild>
                  <a href={`/whitepaper/${paper.filename}.pdf`} download>
                    <Download size={14} />
                    Download
                  </a>
                </Button>
              </div>
            </div>

            {/* PDF Embed */}
            <div className="relative aspect-[1/1.4] w-full" style={{ background: 'var(--surface-sunken)' }}>
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-4">
                    <div
                      className="w-8 h-8 rounded-full animate-spin"
                      style={{
                        border: '2px solid var(--border-default)',
                        borderTopColor: 'var(--brand-primary)',
                      }}
                    />
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading PDF...</span>
                  </div>
                </div>
              )}
              <iframe
                key={paper.id}
                src={`/whitepaper/${paper.filename}.pdf#toolbar=1&navpanes=0`}
                className="w-full h-full"
                onLoad={() => setIsLoading(false)}
                title={`${paper.title} Whitepaper`}
              />
            </div>
          </Surface>
        </div>
      </section>

      {/* How They Relate */}
      <section className="py-16 px-6 sm:px-8 lg:px-10">
        <div className="max-w-4xl mx-auto text-center">
          <h2
            className="text-3xl font-display font-black tracking-tighter mb-10"
            style={{ color: 'var(--text-primary)' }}
          >
            How the Papers Relate
          </h2>
          <div className="grid md:grid-cols-3 gap-6 items-center">
            <Surface
              depth={activePaper === 'anchor-protocol' ? 'inset' : 'raised'}
              radius="xl"
              padding="lg"
              interactive
              className="text-center cursor-pointer"
              onClick={() => { setActivePaper('anchor-protocol'); setIsLoading(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            >
              <Lock size={28} style={{ color: 'var(--brand-secondary)' }} className="mx-auto mb-3" />
              <h3 className="font-bold mb-2" style={{ color: activePaper === 'anchor-protocol' ? 'var(--brand-primary)' : 'var(--text-primary)' }}>
                Anchor Protocol
              </h3>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                The security foundation. Cryptographic identity, capability tokens, delegation chains.
              </p>
            </Surface>

            <div className="flex items-center justify-center">
              <span
                className="text-lg font-display font-black tracking-tight"
                style={{ color: 'var(--text-muted)' }}
              >
                builds on &rarr;
              </span>
            </div>

            <Surface
              depth={activePaper === 'bonded-commons' ? 'inset' : 'raised'}
              radius="xl"
              padding="lg"
              interactive
              className="text-center cursor-pointer"
              onClick={() => { setActivePaper('bonded-commons'); setIsLoading(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            >
              <Scale size={28} style={{ color: 'var(--brand-primary)' }} className="mx-auto mb-3" />
              <h3 className="font-bold mb-2" style={{ color: activePaper === 'bonded-commons' ? 'var(--brand-primary)' : 'var(--text-primary)' }}>
                Bonded Commons
              </h3>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                The governance layer. Trust infrastructure, advisory coordination, collateralized contracts.
              </p>
            </Surface>
          </div>
        </div>
      </section>
    </div>
  )
}
