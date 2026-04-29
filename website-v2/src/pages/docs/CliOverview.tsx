import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Link } from 'react-router-dom'
import { ArrowRight, ExternalLink, Terminal } from 'lucide-react'
import { TerminalGif } from '@/components/site/TerminalGif'
import {
  CLI_ALIAS_TOTAL,
  CLI_COMMAND_TOTAL,
  CLI_REFERENCE_GROUPS,
  PORT_DADDY_VERSION,
  referenceAnchor,
} from '@/data/referenceCatalog'

function CommandRow({
  command,
}: {
  command: (typeof CLI_REFERENCE_GROUPS)[number]['items'][number]
}) {
  const anchor = referenceAnchor(command.name)
  const content = (
    <Surface
      depth="flat"
      radius="lg"
      padding="none"
      className="flex min-w-0 items-start gap-4 px-4 py-3 transition-all group-hover:shadow-[var(--shadow-sm)]"
    >
      <Terminal size={16} className="mt-0.5 shrink-0 text-[var(--brand-primary)]" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <code className="font-mono text-sm font-semibold text-[var(--brand-primary)]">{command.name}</code>
          {command.href ? (
            <Badge variant="success">detail page</Badge>
          ) : (
            <Badge variant="default">listed here</Badge>
          )}
        </div>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{command.description}</p>
        {command.aliases?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {command.aliases.map((alias) => (
              <code key={alias} className="rounded bg-[var(--code-bg)] px-2 py-1 font-mono text-xs text-[var(--text-muted)]">
                {alias}
              </code>
            ))}
          </div>
        ) : null}
        {command.flags?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {command.flags.map((flag) => (
              <span key={flag} className="rounded border border-[var(--border-subtle)] px-2 py-1 font-mono text-xs text-[var(--text-muted)]">
                {flag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {command.href ? (
        <ArrowRight size={14} className="mt-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-[var(--text-muted)]" />
      ) : (
        <ExternalLink size={14} className="mt-1 shrink-0 opacity-30 text-[var(--text-muted)]" />
      )}
    </Surface>
  )

  if (!command.href) {
    return (
      <div id={anchor} className="scroll-mt-24">
        {content}
      </div>
    )
  }

  return (
    <Link id={anchor} to={command.href} className="group block scroll-mt-24">
      {content}
    </Link>
  )
}

export default function CliOverview() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="teal">CLI</Badge>
          <Badge variant="default">v{PORT_DADDY_VERSION}</Badge>
          <Badge variant="gold">source-backed</Badge>
        </div>
        <h1 className="font-display text-4xl font-bold tracking-tight text-[var(--text-primary)]">
          Command Line Interface
        </h1>
        <p className="max-w-3xl text-lg leading-relaxed text-[var(--text-secondary)]">
          Complete lookup for the routed <code>pd</code> surface in this checkout. Detail pages cover
          the mature commands; this index still lists the newer and specialist commands so they are not
          invisible while deeper pages catch up.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Surface depth="raised" radius="lg" padding="md">
          <div className="text-2xl font-semibold text-[var(--text-primary)]">{CLI_COMMAND_TOTAL}</div>
          <div className="text-sm text-[var(--text-muted)]">command surfaces listed</div>
        </Surface>
        <Surface depth="raised" radius="lg" padding="md">
          <div className="text-2xl font-semibold text-[var(--text-primary)]">{CLI_ALIAS_TOTAL}</div>
          <div className="text-sm text-[var(--text-muted)]">aliases called out</div>
        </Surface>
        <Surface depth="raised" radius="lg" padding="md">
          <div className="text-2xl font-semibold text-[var(--text-primary)]">6</div>
          <div className="text-sm text-[var(--text-muted)]">reference groups</div>
        </Surface>
      </div>

      <Surface depth="raised" radius="lg" padding="md" className="space-y-2">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Source Of Truth</h2>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          Audited from <code>bin/port-daddy-cli.ts</code>, <code>cli/commands/*.ts</code>, and
          package version <code>{PORT_DADDY_VERSION}</code>. Commands like <code>pd tube</code>,
          <code>pd wallet</code>, <code>pd guard</code>, <code>pd roadmap</code>, and
          <code>pd actor</code> are first-class here even when they do not yet have individual pages.
          Roadmap feedback has a dedicated detail page at <Link to="/docs/cli/roadmap">/docs/cli/roadmap</Link>.
        </p>
      </Surface>

      <TerminalGif
        src="/gifs/docs/cli-overview.gif"
        title="See the command surfaces this reference keeps in play"
        caption="This clip shows the daemon health check, command discovery, and message-loop patterns that recur across the CLI reference."
      />

      {CLI_REFERENCE_GROUPS.map((group) => (
        <section key={group.title} className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">{group.title}</h2>
            <p className="max-w-3xl text-sm leading-relaxed text-[var(--text-muted)]">{group.description}</p>
            <p className="text-xs text-[var(--text-muted)]">
              Source: <code>{group.source}</code>
            </p>
          </div>

          <div className="grid gap-2">
            {group.items.map((command) => (
              <CommandRow key={command.name} command={command} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
