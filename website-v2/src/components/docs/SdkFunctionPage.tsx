import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import {
  BracketLink,
  DocsNoteCard,
  PanelBody,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'
import { DocsCodeBlock as CodeBlock } from './DocsCodeBlock'

interface SdkFunctionPageProps {
  function: string
  description: string
  module: string
  version: string
  signature: string
  params?: Array<{
    name: string
    type: string
    required?: boolean
    description: string
  }>
  returns?: {
    type: string
    description: string
  }
  examples: Array<{
    description: string
    code: string
    output?: string
  }>
  seeAlso?: Array<{
    name: string
    href: string
  }>
}

export function SdkFunctionPage({
  function: fn,
  description,
  module,
  version,
  signature,
  params,
  returns,
  examples,
  seeAlso,
}: SdkFunctionPageProps) {
  return (
    <div className="space-y-[var(--space-7)]">
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link to="/docs/sdk" className="hover:text-[var(--text-primary)]">
          SDK
        </Link>
        <span>/</span>
        <Link to={`/docs/sdk/${module.toLowerCase()}`} className="hover:text-[var(--text-primary)]">
          {module}
        </Link>
        <span>/</span>
        <span className="text-[var(--text-primary)]">{fn}()</span>
      </div>

      <div className="space-y-[var(--space-4)]">
        <div className="flex items-center gap-3">
          <Badge variant="teal">SDK</Badge>
          <Badge variant="default">v{version}</Badge>
        </div>

        <SectionIntro
          eyebrow={`${module} module`}
          title={`${fn}()`}
          description={description}
          titleAs="h1"
          titleSize="section"
          titleClassName="max-w-none font-mono"
          bodyClassName="max-w-[42rem]"
        />
      </div>

      <DocsNoteCard
        label="Signature"
        title="Function contract"
        elevation="quiet"
        padding="compact"
        titleSize="nav"
      >
        <CodeBlock code={signature} language="typescript" />
      </DocsNoteCard>

      {params?.length ? (
        <DocsNoteCard
          label="Parameters"
          title="Inputs this function expects"
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <div className="space-y-[var(--space-3)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            {params.map((param) => (
              <SurfacePanel key={param.name} elevation="quiet" padding="compact" className="space-y-[var(--space-2)]">
                <div className="flex flex-wrap items-center gap-2">
                  <PanelTitle as="p" size="nav" className="max-w-none font-mono text-[var(--brand-primary)]">
                    {param.name}
                  </PanelTitle>
                  {param.required ? <Badge variant="default" size="sm">required</Badge> : null}
                  <Badge variant="outline" size="sm">
                    {param.type}
                  </Badge>
                </div>
                <PanelBody size="compact" className="max-w-none">
                  {param.description}
                </PanelBody>
              </SurfacePanel>
            ))}
          </div>
        </DocsNoteCard>
      ) : null}

      {returns ? (
        <DocsNoteCard
          label="Returns"
          title="What comes back"
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            <PanelTitle as="p" size="nav" className="max-w-none font-mono text-[var(--brand-primary)]">
              {returns.type}
            </PanelTitle>
            <PanelBody size="compact" className="max-w-none">
              {returns.description}
            </PanelBody>
          </SurfacePanel>
        </DocsNoteCard>
      ) : null}

      <div className="space-y-[var(--space-4)]">
        <PanelTitle as="h2" size="nav" className="max-w-none">
          Examples
        </PanelTitle>
        <div className="space-y-[var(--space-4)]">
          {examples.map((example, index) => (
            <DocsNoteCard
              key={`${fn}-example-${index}`}
              label={`Example ${String(index + 1).padStart(2, '0')}`}
              title={example.description}
              elevation="quiet"
              padding="compact"
              titleSize="nav"
            >
              <CodeBlock code={example.code} output={example.output} language="typescript" />
            </DocsNoteCard>
          ))}
        </div>
      </div>

      {seeAlso?.length ? (
        <DocsNoteCard
          label="See also"
          title="Related SDK surfaces"
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <div className="flex flex-wrap gap-[var(--panel-gap-tight)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            {seeAlso.map((item, index) => (
              <BracketLink
                key={item.href}
                to={item.href}
                tone={index % 2 === 0 ? 'blue' : 'lime'}
                side={index % 2 === 0 ? 'left' : 'right'}
              >
                {item.name}
              </BracketLink>
            ))}
          </div>
        </DocsNoteCard>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)] border-t border-[var(--border-subtle)] pt-[var(--space-5)]">
        <Link
          to={`/docs/sdk/${module.toLowerCase()}`}
          className="flex items-center gap-2 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowLeft size={14} />
          {module} module
        </Link>
        <Link
          to="/docs/sdk"
          className="flex items-center gap-2 text-sm text-[var(--brand-primary)] transition-colors hover:text-[var(--brand-primary)]"
        >
          All SDK functions
          <ArrowLeft size={14} className="rotate-180" />
        </Link>
      </div>
    </div>
  )
}
