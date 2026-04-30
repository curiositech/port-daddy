import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import {
  BracketLink,
  DocsNoteCard,
  PanelBody,
  PanelEyebrow,
  PanelList,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'
import { DocsCodeBlock as CodeBlock } from './DocsCodeBlock'
import { TerminalGif } from '@/components/site/TerminalGif'
import { CLI_REFERENCE_RECORDING } from '@/data/terminalRecordings'
import { CLI_REFERENCE_ITEMS, cliCommandHref, type CliReferenceItem } from '@/data/referenceCatalog'

type ApiSpecEntry = {
  label: string
  value: string
}

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
  apiSpec?: ApiSpecEntry[]
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

function normalizeRoute(route: string): string {
  const [path] = route.split(/[?#]/)
  return (path || '/').replace(/\/+$/, '') || '/'
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

function commandLooksEquivalent(a: string, b: string): boolean {
  const left = normalizeCommand(a)
  const right = normalizeCommand(b)
  return left === right || left.replace(/^pd\s+/, '') === right.replace(/^pd\s+/, '')
}

function findCatalogItem(command: string, pathname: string): CliReferenceItem | undefined {
  const route = normalizeRoute(pathname)
  return CLI_REFERENCE_ITEMS.find((item) => {
    if (normalizeRoute(item.href) === route) return true
    if (commandLooksEquivalent(item.name, command)) return true
    return item.aliasRoutes.some((alias) => normalizeRoute(alias.href) === route || commandLooksEquivalent(alias.name, command))
  })
}

function apiSpecFromCatalog(command: string, pathname: string, item: CliReferenceItem): ApiSpecEntry[] {
  const route = normalizeRoute(pathname)
  const matchedAlias = item.aliasRoutes.find(
    (alias) => normalizeRoute(alias.href) === route || commandLooksEquivalent(alias.name, command),
  )

  return [
    { label: 'Documented command', value: command },
    { label: 'Canonical command', value: item.name },
    { label: 'Reference route', value: matchedAlias?.href ?? cliCommandHref(item) },
    { label: 'Reference group', value: item.groupTitle },
    { label: 'Source', value: item.groupSource },
    { label: 'Aliases', value: item.aliasRoutes.length ? item.aliasRoutes.map((alias) => alias.name).join(', ') : 'none' },
    { label: 'Output mode', value: item.flags?.includes('--json') ? 'human display plus --json machine output' : 'human display with command-specific state changes' },
    { label: 'Page type', value: item.generated ? 'generated API spec from the source-backed catalog' : 'hand-authored detail page with catalog-backed API spec' },
  ]
}

function fallbackApiSpec(command: string, pathname: string): ApiSpecEntry[] {
  return [
    { label: 'Documented command', value: command },
    { label: 'Reference route', value: normalizeRoute(pathname) },
    { label: 'Reference group', value: 'Hand-authored CLI detail page' },
    { label: 'Source', value: 'website-v2/src/pages/docs/cli' },
    { label: 'Aliases', value: 'none listed in source-backed catalog' },
    { label: 'Output mode', value: 'human display with command-specific state changes' },
    { label: 'Page type', value: 'hand-authored detail page' },
  ]
}

export function CommandPage({
  command,
  shortFlag,
  description,
  version,
  syntax,
  examples,
  apiSpec,
  flags,
  subcommands,
  usagePatterns,
  seeAlso,
}: CommandPageProps) {
  const location = useLocation()
  const catalogItem = findCatalogItem(command, location.pathname)
  const resolvedApiSpec = apiSpec?.length
    ? apiSpec
    : catalogItem
      ? apiSpecFromCatalog(command, location.pathname, catalogItem)
      : fallbackApiSpec(command, location.pathname)

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

      {resolvedApiSpec.length ? (
        <DocsNoteCard
          label="API spec"
          title="Command contract"
          elevation="quiet"
          padding="compact"
          titleSize="nav"
        >
          <div className="grid gap-[var(--space-3)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)] md:grid-cols-2">
            {resolvedApiSpec.map((entry) => (
              <SurfacePanel key={entry.label} elevation="quiet" padding="compact" className="space-y-[var(--space-1)]">
                <PanelEyebrow className="max-w-none text-[var(--text-muted)]">
                  {entry.label}
                </PanelEyebrow>
                <PanelBody size="compact" className="max-w-none font-mono text-[var(--text-primary)]">
                  {entry.value}
                </PanelBody>
              </SurfacePanel>
            ))}
          </div>
        </DocsNoteCard>
      ) : null}

      <TerminalGif
        src={CLI_REFERENCE_RECORDING.gifSrc}
        title={CLI_REFERENCE_RECORDING.title}
        caption={`${CLI_REFERENCE_RECORDING.caption} Here it grounds the ${command} reference: daemon health, discovery, and message-loop patterns these pages keep pointing back to.`}
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
