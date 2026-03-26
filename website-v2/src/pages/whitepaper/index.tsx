import * as React from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  FileText,
  Download,
  Shield,
  CheckCircle,
  Anchor,
  Lock,
  Terminal,
  Scale,
  Handshake,
  Eye
} from 'lucide-react'
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
  badgeVariant: 'teal' | 'neutral'
  highlights: Array<{ icon: typeof Shield; label: string; color: string }>
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
    badgeVariant: 'teal',
    highlights: [
      { icon: Scale, label: 'Sen\'s Impossibility Applied', color: 'text-amber-600' },
      { icon: Handshake, label: 'Collateralized Contracts', color: 'text-emerald-600' },
      { icon: Eye, label: 'Immutable Attribution', color: 'text-blue-600' },
      { icon: Terminal, label: 'TLA+ Verified', color: 'text-purple-600' },
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
        content: 'Grounded in Sen\'s Impossibility of a Paretian Liberal: enforced file allocation with private agent knowledge is provably suboptimal. The authority provides information, not allocation decisions.'
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
    badgeVariant: 'neutral',
    highlights: [
      { icon: Shield, label: 'ProVerif Verified', color: 'text-emerald-600' },
      { icon: Lock, label: 'Memory Safe (Rust)', color: 'text-blue-600' },
      { icon: CheckCircle, label: 'Constant-Time Crypto', color: 'text-purple-600' },
      { icon: Terminal, label: 'Formal Methods', color: 'text-amber-600' },
    ],
    sections: [
      {
        title: 'Abstract',
        content: 'Introduces the Anchor Protocol, a cryptographic and semantic identity framework. Details the evolution from symmetric MACs to asymmetric Ed25519 signatures and multi-hop delegation chains inspired by Macaroons.'
      },
      {
        title: 'The Local Swarm Problem',
        content: 'Three critical threat vectors on localhost: port squatting ("Ghost in the Harbor"), resource contention, and privilege escalation between concurrent agents.'
      },
      {
        title: 'Formal Verification',
        content: 'ProVerif symbolic analysis proves Injective Agreement: capabilities cannot be escalated and trust is perfectly transitive across delegation chains. Kani verifies memory safety and constant-time comparisons.'
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
    <div className="min-h-screen bg-[var(--bg-base)] pt-20">
      {/* Hero */}
      <section className="py-16 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-4xl mx-auto"
          >
            <h1 className="text-4xl sm:text-5xl font-medium italic text-[var(--text-primary)] mb-4">
              White Papers
            </h1>
            <p className="text-xl text-[var(--text-secondary)] leading-relaxed mb-4 font-sans">
              by Erich Owens
            </p>
            <p className="text-lg text-[var(--text-muted)] leading-relaxed font-sans max-w-2xl mx-auto">
              The formal foundations of Port Daddy: cryptographic identity,
              commons governance, and collateralized coordination for multi-agent systems.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Paper Selector */}
      <section className="px-6 pb-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-4">
            {PAPERS.map((p) => (
              <button
                key={p.id}
                onClick={() => { setActivePaper(p.id); setIsLoading(true) }}
                className={`text-left p-6 rounded-xl border transition-all ${
                  activePaper === p.id
                    ? 'bg-[var(--bg-surface)] border-[var(--brand-primary)] shadow-lg'
                    : 'bg-[var(--bg-base)] border-[var(--border-subtle)] hover:border-[var(--brand-primary)]/50'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <Badge variant={p.badgeVariant} className="mb-2 text-xs">
                      {p.badge}
                    </Badge>
                    <h2 className={`text-xl font-semibold ${
                      activePaper === p.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                    }`}>
                      {p.title}
                    </h2>
                  </div>
                  <FileText size={20} className={
                    activePaper === p.id ? 'text-[var(--brand-primary)]' : 'text-[var(--text-muted)]'
                  } />
                </div>
                <p className="text-sm text-[var(--text-muted)] font-sans">
                  {p.subtitle}
                </p>
                <div className="flex items-center gap-4 mt-3 text-xs text-[var(--text-muted)]">
                  <span>{p.date}</span>
                  <span>{p.pages} pages</span>
                  <span>{p.sizeKb} KB</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Active Paper: Badges */}
      <section className="px-6 pb-8">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-3">
          {paper.highlights.map((h, i) => (
            <motion.div
              key={h.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
            >
              <h.icon size={16} className={h.color} />
              <span className="text-sm font-medium text-[var(--text-secondary)]">{h.label}</span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Key Highlights */}
      <section className="py-8 px-6 border-y border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {paper.sections.map((section, i) => (
              <motion.div
                key={`${paper.id}-${section.title}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="space-y-3"
              >
                <h3 className="text-lg font-semibold text-[var(--text-primary)] font-sans">
                  {section.title}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                  {section.content}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* PDF Viewer */}
      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-subtle)] overflow-hidden shadow-xl">
            {/* PDF Toolbar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]">
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-[var(--brand-primary)]" />
                <span className="font-medium text-[var(--text-primary)]">{paper.filename}.pdf</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--text-muted)]">{paper.sizeKb} KB</span>
                <a
                  href={`/whitepaper/${paper.filename}.pdf`}
                  download
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-on-primary)] text-sm font-medium hover:bg-[var(--brand-primary-hover)] transition-colors"
                >
                  <Download size={16} />
                  Download PDF
                </a>
              </div>
            </div>

            {/* PDF Embed */}
            <div className="relative aspect-[1/1.4] w-full bg-[var(--bg-base)]">
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-2 border-[var(--brand-primary)] border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-[var(--text-muted)]">Loading PDF...</span>
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
          </div>
        </div>
      </section>

      {/* Relationship Between Papers */}
      <section className="py-16 px-6 bg-[var(--bg-surface)] border-t border-[var(--border-subtle)]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-medium italic text-[var(--text-primary)] mb-6">
            How the Papers Relate
          </h2>
          <div className="grid md:grid-cols-3 gap-6 items-center">
            <div className="p-6 rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)]">
              <Lock size={24} className="text-[var(--brand-primary)] mx-auto mb-3" />
              <h3 className="font-semibold text-[var(--text-primary)] mb-2 font-sans">Anchor Protocol</h3>
              <p className="text-sm text-[var(--text-secondary)] font-sans">
                The security foundation. Cryptographic identity, capability tokens, delegation chains.
              </p>
            </div>
            <div className="flex items-center justify-center">
              <div className="text-[var(--text-muted)] text-2xl font-light">builds on</div>
            </div>
            <div className="p-6 rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)]">
              <Scale size={24} className="text-[var(--brand-primary)] mx-auto mb-3" />
              <h3 className="font-semibold text-[var(--text-primary)] mb-2 font-sans">Bonded Commons</h3>
              <p className="text-sm text-[var(--text-secondary)] font-sans">
                The governance layer. Trust infrastructure, advisory coordination, collateralized contracts.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
