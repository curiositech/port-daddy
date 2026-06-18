import * as React from 'react'

import {
  PortDaddyMark,
  PortDaddyMarkSmall,
  PortDaddyMarkMono,
  PortDaddyWordmark,
} from '@/components/brand'
import { PageContainer, PanelTitle, PanelBody, BracketLabel } from '@/components/site/primitives'

/**
 * /brand — the living logo roster. One screenshottable gallery of every
 * official mark, with usage notes. Mirrors public/logos/README.md.
 */
function Cell({
  label,
  note,
  children,
}: {
  label: string
  note: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
      <div className="flex min-h-[200px] flex-1 items-center justify-center p-[var(--space-6)]">
        {children}
      </div>
      <div className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-strong)] px-[var(--space-4)] py-[var(--space-3)]">
        <div className="font-display text-[length:var(--text-base)] font-black uppercase tracking-[var(--tracking-display-nav)] text-[var(--text-primary)]">
          {label}
        </div>
        <p className="mt-[var(--space-1)] font-sans text-[length:var(--text-sm)] leading-snug text-[var(--text-secondary)]">
          {note}
        </p>
      </div>
    </div>
  )
}

export function BrandPage() {
  return (
    <PageContainer width="wide" className="py-[var(--space-8)]">
      <BracketLabel>Brand</BracketLabel>
      <PanelTitle as="h1" size="hero" className="mt-[var(--space-3)] max-w-[20ch]">
        The Port Daddy logo roster
      </PanelTitle>
      <PanelBody className="mt-[var(--space-4)] max-w-[60ch]">
        Every official mark, theme-aware, drawn from the brand palette — cobalt,
        seafoam, amber. Source SVGs live in <code>public/logos/</code> and are
        wrapped by the typed components in <code>src/components/brand/</code>.
      </PanelBody>

      <div className="mt-[var(--space-7)] grid gap-[var(--space-5)] sm:grid-cols-2 lg:grid-cols-3">
        <Cell
          label="Animated mark"
          note="The flagship. Spinning radar + flipping P/D monogram. Hero + anywhere the full logo belongs."
        >
          <PortDaddyMark size={132} animated alt="Port Daddy animated mark" />
        </Cell>

        <Cell
          label="Static mark"
          note="Glossy, motion-free. Print, PDFs, dense pages, reduced-motion contexts."
        >
          <PortDaddyMark size={132} animated={false} alt="Port Daddy static mark" />
        </Cell>

        <Cell
          label="Small mark · favicon-grade"
          note="Monogram only, no radar. Stays legible to 16px. Tab strips, crumbs, compact chrome."
        >
          <div className="flex items-end gap-[var(--space-4)]">
            <PortDaddyMarkSmall size={16} />
            <PortDaddyMarkSmall size={24} />
            <PortDaddyMarkSmall size={32} />
            <PortDaddyMarkSmall size={56} />
          </div>
        </Cell>

        <Cell
          label="Inline · monochrome"
          note="Inherits currentColor. Buttons, nav links, footers — any single-color glyph slot."
        >
          <div className="flex items-center gap-[var(--space-5)]">
            <PortDaddyMarkMono size={40} className="text-[var(--brand-primary)]" />
            <PortDaddyMarkMono size={40} className="text-[var(--text-primary)]" />
            <PortDaddyMarkMono size={40} className="text-[var(--brand-accent)]" />
          </div>
        </Cell>

        <Cell
          label="Wordmark lockup"
          note="Mark + type + tagline rule. Headers, footers, share cards, slides."
        >
          <PortDaddyWordmark width={300} alt="Port Daddy wordmark" />
        </Cell>

        <Cell
          label="On dark"
          note="The same marks, dark variant. Always pass through the theme — never hard-code a path."
        >
          <div className="flex flex-col items-center gap-[var(--space-4)] rounded-sm bg-[#070B12] p-[var(--space-5)]">
            <PortDaddyMark size={96} variant="dark" animated={false} alt="" />
            <PortDaddyWordmark width={240} variant="dark" alt="" />
          </div>
        </Cell>
      </div>
    </PageContainer>
  )
}

export default BrandPage
