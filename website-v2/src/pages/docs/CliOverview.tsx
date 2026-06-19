import { Link } from 'react-router-dom'
import { TerminalGif } from '@/components/site/TerminalGif'
import {
  BracketLabel,
  BracketLink,
  DocsNoteCard,
  PanelBody,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'
import {
  CLI_ALIAS_TOTAL,
  CLI_COMMAND_TOTAL,
  CLI_REFERENCE_GROUPS,
  PORT_DADDY_VERSION,
  cliCommandHref,
  referenceAnchor,
} from '@/data/referenceCatalog'

function CommandRow({
  command,
}: {
  command: (typeof CLI_REFERENCE_GROUPS)[number]['items'][number]
}) {
  const anchor = referenceAnchor(command.name)
  const href = cliCommandHref(command)

  return (
    <Link id={anchor} to={href} className="group block scroll-mt-24">
      <SurfacePanel
        elevation="quiet"
        padding="compact"
        className="grid min-w-0 gap-[var(--space-3)] transition-colors group-hover:border-[var(--border-strong)] md:grid-cols-[minmax(10rem,0.38fr)_minmax(0,1fr)_auto]"
      >
        <code className="font-mono text-[length:var(--type-panel-body-compact-size)] font-semibold text-[var(--brand-primary)]">
          {command.name}
        </code>
        <div className="min-w-0 space-y-[var(--space-2)]">
          <BracketLabel>API spec</BracketLabel>
          <PanelBody size="compact" className="max-w-none">{command.description}</PanelBody>
          {command.aliases?.length ? (
            <div className="flex flex-wrap gap-[var(--panel-gap-tight)]">
              {command.aliases.map((alias) => (
                <Link
                  key={alias}
                  to={cliCommandHref(alias)}
                  className="border border-[var(--border-default)] bg-[var(--surface-base)] px-[var(--space-2)] py-[var(--space-1)] font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--brand-primary)]"
                >
                  {alias}
                </Link>
              ))}
            </div>
          ) : null}
          {command.flags?.length ? (
            <div className="flex flex-wrap gap-[var(--panel-gap-tight)]">
              {command.flags.map((flag) => (
                <span key={flag} className="border border-[var(--border-default)] px-[var(--space-2)] py-[var(--space-1)] font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                  {flag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <span className="self-start font-mono text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true">→</span>
      </SurfacePanel>
    </Link>
  )
}

export default function CliOverview() {
  return (
    <div className="space-y-[var(--space-7)]">
      <div className="space-y-[var(--space-4)]">
        <div className="flex flex-wrap items-center gap-[var(--panel-gap-tight)]">
          <BracketLabel>CLI</BracketLabel>
          <BracketLabel>v{PORT_DADDY_VERSION}</BracketLabel>
          <BracketLabel>source-backed</BracketLabel>
        </div>
        <SectionIntro
          eyebrow="Command line reference"
          title="Every command should show what happens next."
          description={
            <>
              The routed <code>pd</code> surface in this checkout. Each command links to a detail page with syntax,
              options, examples, aliases, source provenance, and the output contract agents and humans can verify.
            </>
          }
          titleAs="h1"
          titleSize="section"
          titleClassName="max-w-[17ch]"
          bodyClassName="max-w-[50rem]"
        />
      </div>

      <div className="grid gap-[var(--panel-gap)] sm:grid-cols-3">
        {[
          [CLI_COMMAND_TOTAL, 'command surfaces listed'],
          [CLI_ALIAS_TOTAL, 'aliases called out'],
          [6, 'reference groups'],
        ].map(([value, label]) => (
          <SurfacePanel key={label} elevation="quiet" padding="compact">
            <PanelTitle as="p" size="card" className="max-w-none">{value}</PanelTitle>
            <PanelBody size="compact" className="max-w-none">{label}</PanelBody>
          </SurfacePanel>
        ))}
      </div>

      <DocsNoteCard label="Source of truth" title="This is generated from the live command catalog." elevation="quiet" padding="compact" titleSize="nav">
        <PanelBody size="compact" className="max-w-none">
          Audited from <code>bin/port-daddy-cli.ts</code>, <code>cli/commands/*.ts</code>, and
          package version <code>{PORT_DADDY_VERSION}</code>. Commands like <code>pd tube</code>,
          <code>pd wallet</code>, <code>pd guard</code>, <code>pd roadmap</code>, and
          <code>pd actor</code> are first-class documentation surfaces, not index-only mentions.
          Roadmap feedback has a dedicated detail page at <Link to="/docs/cli/roadmap">/docs/cli/roadmap</Link>.
        </PanelBody>
      </DocsNoteCard>

      <TerminalGif
        src="/gifs/docs/cli-overview.gif"
        title="See the command surfaces this reference keeps in play"
        caption="This clip shows the daemon health check, command discovery, and message-loop patterns that recur across the CLI reference."
      />

      {CLI_REFERENCE_GROUPS.map((group) => (
        <section key={group.title} className="space-y-[var(--space-4)]">
          <div className="space-y-[var(--space-2)]">
            <PanelTitle as="h2" size="card" className="max-w-none">{group.title}</PanelTitle>
            <PanelBody size="compact" className="max-w-[50rem]">{group.description}</PanelBody>
            <PanelBody size="compact" className="max-w-none text-[var(--text-muted)]">
              Source: <code>{group.source}</code>
            </PanelBody>
          </div>

          <div className="grid gap-[var(--space-2)]">
            {group.items.map((command) => (
              <CommandRow key={command.name} command={command} />
            ))}
          </div>
        </section>
      ))}

      <DocsNoteCard label="Next" title="Read the system around the command." elevation="quiet" padding="compact" titleSize="nav">
        <div className="flex flex-wrap gap-[var(--panel-gap-tight)]">
          <BracketLink to="/docs/get-started" tone="blue">Get started</BracketLink>
          <BracketLink to="/docs/sdk" tone="accent">SDK reference</BracketLink>
          <BracketLink to="/docs/mcp" tone="blue">MCP tools</BracketLink>
        </div>
      </DocsNoteCard>
    </div>
  )
}
