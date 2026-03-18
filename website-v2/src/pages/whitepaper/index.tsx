import * as React from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { 
  FileText, 
  Download, 
  Shield, 
  CheckCircle, 
  Anchor,
  Home,
  ArrowLeft,
  Lock,
  Terminal
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'

const VERIFICATION_BADGES = [
  { icon: Shield, label: 'ProVerif Verified', color: 'text-emerald-600' },
  { icon: Lock, label: 'Memory Safe (Rust)', color: 'text-blue-600' },
  { icon: CheckCircle, label: 'Constant-Time Crypto', color: 'text-purple-600' },
  { icon: Terminal, label: 'Formal Methods', color: 'text-amber-600' },
]

const PAPER_SECTIONS = [
  {
    title: 'Abstract',
    content: 'As AI agents transition from isolated copilots to collaborative, autonomous swarms, local development environments face a crisis of coordination and trust. This paper introduces the Anchor Protocol, a cryptographic and semantic identity framework built into the Port Daddy daemon.'
  },
  {
    title: 'The Local Swarm Problem',
    content: 'In a multi-agent development environment, agents operate concurrently to read files, spin up test servers, and execute commands. This introduces three critical threat vectors: port squatting, resource contention, and privilege escalation.'
  },
  {
    title: 'Formal Verification',
    content: 'Using ProVerif symbolic analysis, we prove Injective Agreement—the guarantee that capabilities cannot be escalated and trust is perfectly transitive across delegation chains.'
  },
  {
    title: 'Implementation',
    content: 'The Rust-based core uses constant-time cryptographic comparisons verified with Kani model checker, ensuring immunity to timing side-channel attacks.'
  }
]

export default function WhitepaperPage() {
  const [isLoading, setIsLoading] = React.useState(true)

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      {/* Navigation Bar */}
      <nav className="fixed top-0 left-0 right-0 h-16 bg-[var(--bg-base)]/80 backdrop-blur-xl border-b border-[var(--border-subtle)] z-50">
        <div className="max-w-7xl mx-auto h-full px-6 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link 
              to="/" 
              className="flex items-center gap-2 text-[var(--text-primary)] hover:text-[var(--brand-primary)] transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-[var(--brand-primary)]/10 flex items-center justify-center">
                <Anchor size={18} className="text-[var(--brand-primary)]" />
              </div>
              <span className="font-semibold">Port Daddy</span>
            </Link>
            
            <div className="h-5 w-px bg-[var(--border-subtle)] hidden sm:block" />
            
            <Link 
              to="/" 
              className="hidden sm:flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Home size={14} />
              Back to Home
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <Link 
              to="/docs" 
              className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Documentation
            </Link>
            <a 
              href="/whitepaper/anchor-protocol-whitepaper.pdf"
              download
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-on-primary)] text-sm font-medium hover:bg-[var(--brand-primary-hover)] transition-colors"
            >
              <Download size={16} />
              Download PDF
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-16 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-4xl mx-auto"
          >
            <Badge variant="teal" className="mb-6 px-4 py-1.5 text-xs font-medium uppercase tracking-wider">
              Technical White Paper
            </Badge>
            
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-medium italic text-[var(--text-primary)] mb-6">
              The Anchor Protocol
            </h1>
            
            <p className="text-xl text-[var(--text-secondary)] leading-relaxed mb-8 font-sans">
              A Formally Verified Control Plane for Local Agent Swarms
            </p>

            {/* Verification Badges */}
            <div className="flex flex-wrap items-center justify-center gap-4 mb-12">
              {VERIFICATION_BADGES.map((badge, i) => (
                <motion.div
                  key={badge.label}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
                >
                  <badge.icon size={16} className={badge.color} />
                  <span className="text-sm font-medium text-[var(--text-secondary)]">{badge.label}</span>
                </motion.div>
              ))}
            </div>

            {/* Paper Metadata */}
            <div className="flex items-center justify-center gap-6 text-sm text-[var(--text-muted)] font-sans">
              <span>Version 1.0</span>
              <span>•</span>
              <span>March 16, 2026</span>
              <span>•</span>
              <span>12 pages</span>
              <span>•</span>
              <span>Port Daddy v3.7.0</span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Key Highlights */}
      <section className="py-12 px-6 border-y border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {PAPER_SECTIONS.map((section, i) => (
              <motion.div
                key={section.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
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
                <span className="font-medium text-[var(--text-primary)]">anchor-protocol-whitepaper.pdf</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--text-muted)]">360 KB</span>
                <a 
                  href="/whitepaper/anchor-protocol-whitepaper.pdf"
                  download
                  className="p-2 rounded-lg hover:bg-[var(--interactive-hover)] transition-colors"
                  title="Download PDF"
                >
                  <Download size={18} className="text-[var(--text-secondary)]" />
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
                src="/whitepaper/anchor-protocol-whitepaper.pdf#toolbar=1&navpanes=0"
                className="w-full h-full"
                onLoad={() => setIsLoading(false)}
                title="Anchor Protocol Whitepaper"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Related Resources */}
      <section className="py-16 px-6 border-t border-[var(--border-subtle)]">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-medium italic text-[var(--text-primary)] mb-8 text-center">
            Related Resources
          </h2>
          
          <div className="grid md:grid-cols-3 gap-6">
            <Link 
              to="/docs/adr/0014-the-anchor-protocol"
              className="group p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--brand-primary)] transition-all"
            >
              <Terminal size={24} className="text-[var(--brand-primary)] mb-4" />
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2 font-sans">
                ADR-0014: The Anchor Protocol
              </h3>
              <p className="text-sm text-[var(--text-secondary)] font-sans">
                Architecture Decision Record detailing the protocol design and security considerations.
              </p>
            </Link>

            <Link 
              to="/docs/security"
              className="group p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--brand-primary)] transition-all"
            >
              <Shield size={24} className="text-[var(--brand-primary)] mb-4" />
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2 font-sans">
                Security & Soundness
              </h3>
              <p className="text-sm text-[var(--text-secondary)] font-sans">
                Overview of formal verification methodology and cryptographic guarantees.
              </p>
            </Link>

            <a 
              href="https://github.com/erichowens/port-daddy/tree/main/analyses"
              target="_blank"
              rel="noopener noreferrer"
              className="group p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--brand-primary)] transition-all"
            >
              <Lock size={24} className="text-[var(--brand-primary)] mb-4" />
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2 font-sans">
                ProVerif Models
              </h3>
              <p className="text-sm text-[var(--text-secondary)] font-sans">
                Complete formal verification models on GitHub. Run them yourself.
              </p>
            </a>
          </div>
        </div>
      </section>

      {/* Blog Entry Excerpt */}
      <section className="py-16 px-6 bg-[var(--bg-surface)] border-t border-[var(--border-subtle)]">
        <div className="max-w-4xl mx-auto">
          <Badge variant="neutral" className="mb-4">Blog</Badge>
          <h2 className="text-3xl font-medium italic text-[var(--text-primary)] mb-4">
            Why Formal Verification Matters for AI Swarms
          </h2>
          <p className="text-lg text-[var(--text-secondary)] leading-relaxed mb-6 font-sans">
            As AI agents gain the ability to spawn other agents, delegate tasks, and share resources, 
            the attack surface of local development environments expands exponentially. Traditional 
            testing cannot catch all edge cases in concurrent, adversarial scenarios.
          </p>
          <p className="text-lg text-[var(--text-secondary)] leading-relaxed mb-8 font-sans">
            The Anchor Protocol represents our commitment to "math-based security"—using symbolic 
            protocol analysis and memory-safe implementation verification to provide guarantees 
            that go beyond "it seems to work in our tests."
          </p>
          <Link 
            to="/blog/formal-verification-ai-swarms"
            className="inline-flex items-center gap-2 text-[var(--brand-primary)] hover:text-[var(--brand-primary-hover)] font-medium font-sans"
          >
            Read the full blog post
            <ArrowLeft size={16} className="rotate-180" />
          </Link>
        </div>
      </section>
    </div>
  )
}
