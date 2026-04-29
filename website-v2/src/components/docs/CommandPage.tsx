import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import {
  BracketLink,
  DocsNoteCard,
  PanelBody,
  PanelList,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'
import { DocsCodeBlock as CodeBlock } from './DocsCodeBlock'
import { TerminalGif } from '@/components/site/TerminalGif'
import { CLI_REFERENCE_RECORDING } from '@/data/terminalRecordings'

interface CommandPageProps {
  command: string
  shortFlag?: string
  description: string
  version: string
  syntax: string
  examples: Array<{
    description: string
    code: string
    output?: string
  }>
  flags?: Array<{
    flag: string
    description: string
  }>
  subcommands?: Array<{
    name: string
    description: string
    href: string
  }>
  usagePatterns?: string[]
  seeAlso?: Array<{
    name: string
    href: string
  }>
}

export function CommandPage({
  command,
  shortFlag,
  description,
  version,
  syntax,
  examples,
  flags,
  subcommands,
  usagePatterns,
  seeAlso,
}: CommandPageProps) {
  return (
    <div className="space-y-[var(--space-7)]">
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link to="/docs/cli" className="hover:text-[var(--text-primary)]">
          CLI
        </Link>
        <span>/</span>
        <span className="text-[var(--text-primary)]">{command}</span>
      </div>

      <div className="space-y-[var(--space-4)]">
        <div className="flex items-center gap-3">
          <Badge variant="teal">CLI</Badge>
          <Badge variant="default">v{version}</Badge>
        </div>

        <SectionIntro
          eyebrow="CLI command"
          title={
            <>
              {command}
              {shortFlag ? (
                <span className="ml-[var(--space-2)] text-[var(--text-muted)] text-[0.66em]">({shortFlag})</span>
              ) : null}
            </>
          }
          description={description}
          titleAs="h1"
          titleSize="section"
          titleClassName="max-w-none font-mono"
          bodyClassName="max-w-[42rem]"
        />
      </div>

      <DocsNoteCard
        label="Syntax"
        title={`Run ${command} like this`}
        elevation="quiet"
        padding="compact"
        titleSize="nav"
      >
        <CodeBlock code={syntax} />
      </DocsNoteCard>

      <TerminalGif
        src={CLI_REFERENCE_RECORDING.gifSrc}
        title={CLI_REFERENCE_RECORDING.title}
        caption="This clip gives the command page context, not just syntax: it shows the daemon health check, command discovery, and message-loop patterns these reference pages keep pointing back to."
      />

      {usagePatterns?.length ? (
        <DocsNoteCard
          label="Usage patterns"
          title="Common ways this command shows up in practice"
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <PanelList items={usagePatterns} className="border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]" />
        </DocsNoteCard>
      ) : null}

      {flags?.length ? (
        <DocsNoteCard
          label="Flags"
          title="Options that change command behavior"
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <div className="space-y-[var(--space-3)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            {flags.map((flag) => (
              <SurfacePanel key={flag.flag} elevation="quiet" padding="compact" className="space-y-[var(--space-2)]">
                <PanelTitle as="p" size="nav" className="max-w-none font-mono text-[var(--brand-primary)]">
                  {flag.flag}
                </PanelTitle>
                <PanelBody size="compact" className="max-w-none">
                  {flag.description}
                </PanelBody>
              </SurfacePanel>
            ))}
          </div>
        </DocsNoteCard>
      ) : null}

      {subcommands?.length ? (
        <DocsNoteCard
          label="Subcommands"
          title="Related command surfaces"
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <div className="flex flex-wrap gap-[var(--panel-gap-tight)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            {subcommands.map((subcommand, index) => (
              <BracketLink
                key={subcommand.href}
                to={subcommand.href}
                tone={index % 2 === 0 ? 'blue' : 'accent'}
                side={index % 2 === 0 ? 'left' : 'right'}
              >
                {subcommand.name}
              </BracketLink>
            ))}
          </div>
          <div className="space-y-[var(--space-3)]">
            {subcommands.map((subcommand) => (
              <PanelBody key={subcommand.href} size="compact" className="max-w-none">
                <span className="font-semibold text-[var(--text-primary)]">{subcommand.name}</span>: {subcommand.description}
              </PanelBody>
            ))}
          </div>
        </DocsNoteCard>
      ) : null}

      <div className="space-y-[var(--space-4)]">
        <PanelTitle as="h2" size="nav" className="max-w-none">
          Examples
        </PanelTitle>
        <div className="space-y-[var(--space-4)]">
          {examples.map((example, index) => (
            <DocsNoteCard
              key={`${command}-example-${index}`}
              label={`Example ${String(index + 1).padStart(2, '0')}`}
              title={example.description}
              elevation="quiet"
              padding="compact"
              titleSize="nav"
            >
              <CodeBlock code={example.code} output={example.output} />
            </DocsNoteCard>
          ))}
        </div>
      </div>

      {seeAlso?.length ? (
        <DocsNoteCard
          label="See also"
          title="Nearby command surfaces"
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <div className="flex flex-wrap gap-[var(--panel-gap-tight)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
            {seeAlso.map((item, index) => (
              <BracketLink
                key={item.href}
                to={item.href}
                tone={index % 2 === 0 ? 'blue' : 'accent'}
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
          to="/docs/cli"
          className="flex items-center gap-2 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowLeft size={14} />
          All commands
        </Link>
        <Link
          to="/docs/sdk"
          className="flex items-center gap-2 text-sm text-[var(--brand-primary)] transition-colors hover:text-[var(--brand-primary)]"
        >
          SDK reference
          <ArrowLeft size={14} className="rotate-180" />
        </Link>
      </div>
    </div>
  )
}
