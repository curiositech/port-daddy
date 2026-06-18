import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { PageContainer, PanelTitle, PanelBody, BracketLabel } from '@/components/site/primitives'
import { ArrowRight, Download, Terminal } from 'lucide-react'
import { FigureCarousel, type FigureSlide } from './FigureCarousel'
import { PortDaddyMark } from '@/components/brand'
import { SpineChain } from '@/components/library/SpineChain'
import { ThreeSidedMarket } from '@/components/library/ThreeSidedMarket'
import { AnchorFourPhases } from '@/components/library/AnchorFourPhases'
import { AnchorCapabilityAttenuation } from '@/components/library/AnchorCapabilityAttenuation'
import { AnchorRevocationGossip } from '@/components/library/AnchorRevocationGossip'

// Bespoke, theme-aware figures from the papers — the carousel auto-advances
// through them, pausing on hover and honouring prefers-reduced-motion.
const PAPER_FIGURES: FigureSlide[] = [
  {
    key: 'anchor-phases',
    title: 'Four phases of trust',
    explainer:
      'Every credential is hardened in four cryptographic phases — HS256 pinning, Ed25519 identity, macaroon delegation, cuckoo-filter revocation.',
    figure: <AnchorFourPhases />,
  },
  {
    key: 'revocation',
    title: 'Revoke once, everywhere',
    explainer:
      'Daemons gossip a revocation across the federation until every node rejects the card — epidemic, not central.',
    figure: <AnchorRevocationGossip />,
  },
  {
    key: 'attenuation',
    title: 'Power only ever shrinks',
    explainer:
      'Delegation can only narrow a capability — each hop drops rights and shortens the clock, never the reverse.',
    figure: <AnchorCapabilityAttenuation />,
  },
  {
    key: 'market',
    title: 'A three-sided market',
    explainer:
      'Labor, capital, and IP settle through escrow into one conserving bond ledger — value is never minted, only moved.',
    figure: <ThreeSidedMarket />,
  },
  {
    key: 'spine',
    title: 'One spine, seven chapters',
    explainer:
      'Memory to market: the through-line that threads the seven papers into a single argument.',
    figure: <SpineChain />,
  },
]

const BACKENDS = ['Claude Code', 'Codex', 'Cursor', 'Gemini CLI', 'Aider', 'local models']
const PILLS = ['Shared-state substrate', 'Visible ownership', 'Fail-closed launches']

export function Hero() {
  return (
    <section className="relative overflow-hidden py-[var(--space-7)] lg:py-[var(--space-8)]">
      {/* Swiss-grid field for the infrastructure aesthetic. */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <PageContainer className="relative z-10">
        <BracketLabel>For AI engineering teams</BracketLabel>

        {/* Logo + headline on one row — the big borderless spinning mark
            top-left, the headline taking the rest of the row. */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' as const }}
          className="mt-[var(--space-4)] flex items-center gap-[var(--space-4)] lg:gap-[var(--space-6)]"
        >
          <PortDaddyMark
            size={224}
            alt="Port Daddy"
            className="h-24 w-24 shrink-0 sm:h-32 sm:w-32 lg:h-44 lg:w-44"
          />
          <PanelTitle as="h1" size="hero" className="max-w-[16ch]">
            A harbor-master for your{' '}
            <span className="text-[var(--brand-primary)]">coding agents.</span>
          </PanelTitle>
        </motion.div>

        {/* Description + actions left; the $0 pitch + proof right. */}
        <div className="mt-[var(--space-6)] grid items-center gap-[var(--space-6)] lg:grid-cols-2 lg:gap-[var(--space-7)]">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.05, ease: 'easeOut' as const }}
            className="flex flex-col gap-[var(--space-5)]"
          >
            <PanelBody className="max-w-[48ch] text-[length:var(--type-panel-body-size)]">
              Run ten agents on one repo without losing track. Port Daddy gives every
              agent a shared-state substrate — sessions, claims, notes, channels,
              readiness, budgets, and salvage records that outlive the terminal that
              created them.
            </PanelBody>

            <div className="flex flex-wrap items-center gap-[var(--space-3)]">
              <Button asChild variant="primary" size="lg">
                <Link to="/mac-preview#download">
                  <Download size={16} />
                  Evaluate Mac preview
                  <ArrowRight size={16} />
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="lg"
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <Link to="/docs/">
                  <Terminal size={16} />
                  Technical Docs
                </Link>
              </Button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' as const }}
            className="flex flex-col gap-[var(--space-4)]"
          >
            <Link
              to="/cli-backend"
              className="group block border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] no-underline transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]"
            >
              <div className="flex items-start justify-between gap-[var(--space-3)]">
                <div className="space-y-[var(--space-2)]">
                  <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] group-hover:text-[color:var(--brand-primary-foreground-muted)]">
                    Already pay for Claude Max or ChatGPT Pro?
                  </span>
                  <p className="font-sans text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-primary)] group-hover:text-[var(--brand-primary-foreground)]">
                    <strong>The fleet rides on your subscription at $0 marginal cost.</strong>{' '}
                    Claude Code and Codex as first-class backends — setup takes two minutes.
                  </p>
                </div>
                <ArrowRight
                  size={18}
                  aria-hidden="true"
                  className="mt-1 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--brand-primary-foreground)]"
                />
              </div>
            </Link>

            <div className="flex flex-wrap gap-[var(--space-2)]">
              {PILLS.map((label) => (
                <span
                  key={label}
                  className="border-2 border-[var(--border-default)] px-[var(--space-3)] py-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]"
                >
                  {label}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-2)]">
              <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                Works with
              </span>
              {BACKENDS.map((name) => (
                <span
                  key={name}
                  className="font-mono text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]"
                >
                  {name}
                </span>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Full-width carousel band — the bespoke paper figures. */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
          className="mt-[var(--space-7)]"
        >
          <FigureCarousel slides={PAPER_FIGURES} />
        </motion.div>
      </PageContainer>
    </section>
  )
}
