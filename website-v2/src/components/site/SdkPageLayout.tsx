import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import {
  BracketLabel,
  DocsCodeBlock,
  DocsNoteCard,
  PanelBody,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'

/**
 * Shared scaffolding for the SDK + Feature reference pages under /docs/sdk and
 * /docs/features. Consolidates the breadcrumb, header, function panel, parameter
 * tables, examples, and bottom navigation into primitives so each page stays
 * thin and on-brand.
 */

export interface SdkBreadcrumb {
  label: string
  href?: string
}

export interface SdkParam {
  name: string
  type: string
  required?: boolean
  description: ReactNode
}

export interface SdkExample {
  title?: ReactNode
  language?: 'cli' | 'text' | 'typescript'
  code: string
  output?: string
}

export interface SdkFunction {
  name: string
  signature: string
  /** One-paragraph plain-language explanation of what this function does. */
  description: ReactNode
  params?: SdkParam[]
  examples?: SdkExample[]
}

export function SdkPageHeader({
  eyebrow,
  title,
  summary,
  breadcrumbs,
  meta,
}: {
  eyebrow: string
  title: string
  summary: string
  breadcrumbs: SdkBreadcrumb[]
  meta?: ReactNode
}) {
  return (
    <SurfacePanel>
      <div className="grid gap-[var(--panel-gap-loose)] lg:grid-cols-12">
        <div className="space-y-[var(--panel-gap)] lg:col-span-8">
          <nav
            aria-label="Breadcrumb"
            className="flex flex-wrap items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]"
          >
            {breadcrumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="inline-flex items-center gap-[var(--space-2)]">
                {crumb.href ? (
                  <Link to={crumb.href} className="transition-colors hover:text-[var(--text-primary)]">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-[var(--text-primary)]">{crumb.label}</span>
                )}
                {index < breadcrumbs.length - 1 ? <span aria-hidden="true">/</span> : null}
              </span>
            ))}
          </nav>
          <BracketLabel>{eyebrow}</BracketLabel>
          <PanelTitle as="h1" size="section" className="max-w-[16ch]">
            {title}
          </PanelTitle>
          <PanelBody className="max-w-[58rem] text-[length:var(--type-panel-body-large-size)] leading-[var(--leading-body-large)]">
            {summary}
          </PanelBody>
        </div>
        {meta ? <div className="grid content-start gap-[var(--panel-gap)] lg:col-span-4">{meta}</div> : null}
      </div>
    </SurfacePanel>
  )
}

export function SdkParamTable({ params }: { params: SdkParam[] }) {
  if (!params.length) return null

  return (
    <div className="border-2 border-[var(--border-strong)]">
      <div className="hidden border-b-2 border-[var(--border-strong)] bg-[var(--text-primary)] text-[var(--text-inverse)] md:grid md:grid-cols-[minmax(0,0.32fr)_minmax(0,0.22fr)_minmax(0,0.46fr)]">
        {['Parameter', 'Type', 'What it does'].map((heading, idx) => (
          <div
            key={heading}
            className={`p-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] ${
              idx < 2 ? 'border-r-2 border-[color:var(--brand-primary-foreground-subtle)]' : ''
            }`}
          >
            {heading}
          </div>
        ))}
      </div>
      <div className="divide-y-2 divide-[var(--border-default)]">
        {params.map((param) => (
          <div
            key={param.name}
            className="grid gap-[var(--space-2)] p-[var(--space-4)] md:grid-cols-[minmax(0,0.32fr)_minmax(0,0.22fr)_minmax(0,0.46fr)] md:gap-[var(--space-3)]"
          >
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              <code className="font-mono text-[length:var(--type-panel-body-compact-size)] font-bold text-[var(--brand-primary)]">
                {param.name}
              </code>
              {param.required ? (
                <span className="border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] px-[var(--space-2)] py-[1px] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary-foreground)]">
                  required
                </span>
              ) : (
                <span className="border border-[var(--border-default)] px-[var(--space-2)] py-[1px] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  optional
                </span>
              )}
            </div>
            <code className="font-mono text-[length:var(--type-meta-size)] font-semibold text-[var(--text-secondary)]">
              {param.type}
            </code>
            <PanelBody size="compact" className="max-w-none">
              {param.description}
            </PanelBody>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SdkFunctionPanel({ fn, index }: { fn: SdkFunction; index: number }) {
  return (
    <SurfacePanel className="space-y-[var(--panel-gap-loose)]">
      <div className="space-y-[var(--panel-gap-tight)]">
        <BracketLabel>Function {String(index + 1).padStart(2, '0')}</BracketLabel>
        <PanelTitle as="h2" size="card" className="font-mono normal-case">
          {fn.name}
        </PanelTitle>
        <PanelBody size="default" className="max-w-[58rem]">
          {fn.description}
        </PanelBody>
      </div>

      <DocsCodeBlock code={fn.signature} language="typescript" label="Signature" />

      {fn.params?.length ? (
        <div className="space-y-[var(--panel-gap-tight)]">
          <BracketLabel>Parameters</BracketLabel>
          <SdkParamTable params={fn.params} />
        </div>
      ) : null}

      {fn.examples?.length ? (
        <div className="space-y-[var(--panel-gap)]">
          <BracketLabel>Worked examples</BracketLabel>
          {fn.examples.map((example, idx) => (
            <div key={idx} className="space-y-[var(--space-2)]">
              {example.title ? (
                <PanelBody size="compact" className="max-w-[58rem] italic">
                  {example.title}
                </PanelBody>
              ) : null}
              <DocsCodeBlock
                code={example.code}
                language={example.language ?? 'typescript'}
                label={typeof example.title === 'string' ? example.title : `Example ${idx + 1}`}
              />
              {example.output ? (
                <DocsCodeBlock code={example.output} language="text" label={`Example ${idx + 1} — output`} />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </SurfacePanel>
  )
}

export function SdkTypesPanel({ code, label = 'Type definitions' }: { code: string; label?: string }) {
  return (
    <DocsNoteCard label={label} title="The shapes the SDK actually returns" titleSize="nav">
      <DocsCodeBlock code={code} language="typescript" label={label} />
    </DocsNoteCard>
  )
}

export function SdkPager({
  prev,
  next,
}: {
  prev?: { title: string; href: string; label?: string }
  next?: { title: string; href: string; label?: string }
}) {
  if (!prev && !next) return null

  return (
    <nav
      aria-label="SDK pager"
      className="grid gap-[var(--space-4)] border-t-2 border-[var(--border-strong)] pt-[var(--space-5)] sm:grid-cols-2"
    >
      {prev ? (
        <Link
          to={prev.href}
          className="group flex flex-col gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
        >
          <BracketLabel className="self-start">{prev.label ?? 'Previous'}</BracketLabel>
          <span className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]">
            {prev.title}
          </span>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      {next ? (
        <Link
          to={next.href}
          className="group flex flex-col items-end gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] p-[var(--space-4)] text-right text-[var(--brand-primary-foreground)] transition-colors hover:bg-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
        >
          <BracketLabel
            tone="primary"
            className="self-end inline-flex items-center gap-[var(--space-2)]"
          >
            {next.label ?? 'Next'}
            <ArrowRight aria-hidden="true" size={12} />
          </BracketLabel>
          <span className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]">
            {next.title}
          </span>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  )
}

export function SdkPageLayout({
  header,
  children,
  pager,
}: {
  header: ReactNode
  children: ReactNode
  pager?: ReactNode
}) {
  return (
    <div className="space-y-[var(--space-6)]">
      {header}
      <div className="space-y-[var(--space-5)]">{children}</div>
      {pager}
    </div>
  )
}
