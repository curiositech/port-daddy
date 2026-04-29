import { Footer } from '@/components/layout/Footer'
import {
  BracketLink,
  BracketLabel,
  DocsHero,
  DocsNoteCard,
  PanelBody,
  PanelList,
  PanelTitle,
} from '@/components/site/primitives'
import { FEATURED_EXAMPLE, SECONDARY_EXAMPLES } from '@/data/examples'

const broaderBuildIdeas = [
  {
    label: 'Edit guard',
    title: 'Build a file and symbol collision guard',
    body: 'Use sessions, file claims, and locks so agents can check ownership before editing hot files or generated artifacts.',
    href: '/docs/features/sessions',
    cta: 'Sessions and claims',
  },
  {
    label: 'Inbox',
    title: 'Build a durable handoff queue',
    body: 'Give agents unread work items, direct messages, owner-specific queues, and a trail that survives closed terminals.',
    href: '/tutorials/inbox',
    cta: 'Inbox tutorial',
  },
  {
    label: 'Service discovery',
    title: 'Build semantic lookup for local stacks',
    body: 'Let agents resolve names like myapp:api or docs:preview instead of guessing which localhost port is live today.',
    href: '/tutorials/dns',
    cta: 'DNS tutorial',
  },
  {
    label: 'Readiness',
    title: 'Build a backend readiness cockpit',
    body: 'Show which agent backends are actually launchable: keys, SDKs, model rates, budgets, and daemon target all in one place.',
    href: '/docs/get-started',
    cta: 'Get started',
  },
  {
    label: 'Lockbox',
    title: 'Build a one-at-a-time promotion runner',
    body: 'Wrap migrations, deploys, notarization, generated files, and release promotion so only one agent can enter the critical section.',
    href: '/docs/cli/with-lock',
    cta: 'with-lock',
  },
  {
    label: 'Fleet cockpit',
    title: 'Build an eval and agent-run control plane',
    body: 'Track launches, evidence, touched files, costs, failures, handoffs, and recovery state across a local fleet of coding agents.',
    href: '/agents',
    cta: 'Agents surface',
  },
]

export function ExamplesPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content" className="mx-auto grid w-full max-w-[var(--layout-max-width-wide)] gap-[var(--space-6)] px-[var(--space-5)] py-[var(--space-6)] lg:px-[var(--space-6)]">
        <DocsHero
          eyebrow="Examples"
          title="Build tools that can reach your local agent."
          summary="These are complete executable examples for the things Port Daddy makes newly easy: local tools can summon agents, agents can coordinate through shared primitives, and support services can stop colliding."
          paragraphs={[
            'PD Tube is the flagship primitive. It turns local events into a blocking CLI loop with threaded replies, so the publisher stays tiny and the agent runtime stays swappable.',
            'Pick the system you want to build, run the source in /examples, then copy the shape into your editor extension, test reporter, browser page, bot adapter, CI harness, swarm runner, or local control panel.',
          ]}
          aside={
            <DocsNoteCard label="Start" title="Start with the phone line." elevation="quiet" padding="compact" titleSize="nav">
              <PanelBody size="compact" className="max-w-none">
                If you only read one example, read PD Tube. It is the shape the other examples copy:
                publish one local event, let the agent act, then render the threaded reply.
              </PanelBody>
              <div className="flex flex-wrap gap-[var(--panel-gap-tight)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
                <BracketLink to={`/examples/${FEATURED_EXAMPLE.slug}`} tone="blue" side="left">
                  Open PD Tube
                </BracketLink>
                <BracketLink to="/docs/cli" tone="accent" side="right">
                  CLI reference
                </BracketLink>
              </div>
            </DocsNoteCard>
          }
        />

        <section aria-label="Featured PD Tube example">
          <DocsNoteCard
            label={`${FEATURED_EXAMPLE.eyebrow} / flagship`}
            title={FEATURED_EXAMPLE.title}
            elevation="quiet"
          >
            <div className="grid gap-[var(--panel-gap)] lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)]">
              <div className="space-y-[var(--space-3)]">
                <PanelTitle as="h2" size="card">
                  {FEATURED_EXAMPLE.summary}
                </PanelTitle>
                <PanelBody className="max-w-[64rem] text-[var(--text-secondary)]">
                  {FEATURED_EXAMPLE.whyItMatters}
                </PanelBody>
                <div className="flex flex-wrap gap-[var(--panel-gap-tight)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
                  <BracketLink to={`/examples/${FEATURED_EXAMPLE.slug}`} tone="blue" side="left">
                    Open full source
                  </BracketLink>
                  <BracketLink to={`/examples/${FEATURED_EXAMPLE.slug}#source`} tone="accent" side="right">
                    Jump to source
                  </BracketLink>
                </div>
              </div>

              <div className="space-y-[var(--panel-gap-tight)]">
                <BracketLabel side="right">What it builds</BracketLabel>
                <PanelBody size="compact" className="max-w-none">
                  {FEATURED_EXAMPLE.builds}
                </PanelBody>
                <PanelList
                  items={[
                    `${FEATURED_EXAMPLE.time} guided read`,
                    `${FEATURED_EXAMPLE.sourceFiles.length} full source files`,
                    `${FEATURED_EXAMPLE.commands.length} runnable commands`,
                  ]}
                />
              </div>
            </div>
          </DocsNoteCard>
        </section>

        <section aria-label="More Port Daddy build ideas" className="grid gap-[var(--panel-gap)] lg:grid-cols-12">
          <div className="lg:col-span-5">
            <DocsNoteCard
              label="Beyond PD Tube"
              title="Port Daddy is also a substrate for agent infrastructure."
              elevation="quiet"
            >
              <PanelTitle as="h2" size="card">
                More things AI engineers can build.
              </PanelTitle>
              <PanelBody className="max-w-[42rem] text-[var(--text-secondary)]">
                Tube is the best first demo because it makes agent contact obvious. The rest of Port Daddy is for the
                local infrastructure around serious agent work: ownership, readiness, service identity, recovery, and
                operator proof.
              </PanelBody>
            </DocsNoteCard>
          </div>

          <div className="grid gap-[var(--panel-gap)] md:grid-cols-2 lg:col-span-7">
            {broaderBuildIdeas.map((idea, index) => (
              <DocsNoteCard
                key={idea.title}
                label={idea.label}
                title={idea.title}
                titleSize="nav"
                elevation="quiet"
                padding="compact"
              >
                <PanelBody size="compact" className="max-w-none">
                  {idea.body}
                </PanelBody>
                <div className="border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap-tight)]">
                  <BracketLink
                    to={idea.href}
                    tone={index % 2 === 0 ? 'blue' : 'accent'}
                    side={index % 2 === 0 ? 'left' : 'right'}
                  >
                    {idea.cta}
                  </BracketLink>
                </div>
              </DocsNoteCard>
            ))}
          </div>
        </section>

        <section className="grid gap-[var(--panel-gap)] lg:grid-cols-12" aria-labelledby="examples-list">
          <div className="lg:col-span-4">
            <DocsNoteCard label="Executable catalogue" title="Source-backed examples you can run today." elevation="quiet" padding="compact" titleSize="nav">
              <PanelBody size="compact" className="max-w-none">
                The runnable source is the product: each page keeps the full code visible and explains how to turn it
                into product code.
              </PanelBody>
            </DocsNoteCard>
          </div>

          <div className="grid gap-[var(--panel-gap)] lg:col-span-8">
            <h2 id="examples-list" className="sr-only">
              Example catalogue
            </h2>
            {SECONDARY_EXAMPLES.map((example, index) => (
              <DocsNoteCard
                key={example.slug}
                label={`${example.eyebrow} / ${example.level}`}
                title={example.title}
                titleSize="card"
                elevation="quiet"
                padding="compact"
              >
                <div className="space-y-[var(--space-2)]">
                  <PanelBody className="max-w-[58rem]">{example.summary}</PanelBody>
                  <PanelBody className="max-w-[58rem] text-[var(--text-secondary)]">{example.surveyPlain}</PanelBody>
                  <PanelBody size="compact" className="max-w-[58rem] text-[var(--text-secondary)]">
                    Builds: {example.builds}
                  </PanelBody>
                </div>

                <div className="grid gap-[var(--panel-gap)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)] md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.42fr)]">
                  <div className="space-y-[var(--panel-gap-tight)]">
                    <BracketLabel side={index % 2 === 0 ? 'left' : 'right'}>Files</BracketLabel>
                    <div className="grid gap-[var(--space-2)]">
                      {example.files.map((file) => (
                        <code
                          key={file}
                          className="block min-w-0 border border-[var(--border-default)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[length:var(--type-meta-size)] text-[var(--text-primary)]"
                        >
                          {file}
                        </code>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-[var(--panel-gap-tight)]">
                    <BracketLabel side={index % 2 === 0 ? 'right' : 'left'}>What you get</BracketLabel>
                    <PanelList
                      items={[
                        `${example.time} guided read`,
                        `${example.sourceFiles.length} full source file${example.sourceFiles.length === 1 ? '' : 's'}`,
                        `${example.commands.length} runnable command${example.commands.length === 1 ? '' : 's'}`,
                      ]}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-[var(--panel-gap-tight)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
                  <BracketLink to={`/examples/${example.slug}`} tone={index % 2 === 0 ? 'blue' : 'accent'} side="left">
                    Open full example
                  </BracketLink>
                </div>
              </DocsNoteCard>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
