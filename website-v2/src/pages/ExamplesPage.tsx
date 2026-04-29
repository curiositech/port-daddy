import { Footer } from '@/components/layout/Footer'
import {
  BracketLink,
  BracketLabel,
  DocsHero,
  DocsNoteCard,
  PanelBody,
  PanelList,
} from '@/components/site/primitives'
import { EXAMPLE_DOCS } from '@/data/examples'

export function ExamplesPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content" className="mx-auto grid w-full max-w-[var(--layout-max-width-wide)] gap-[var(--space-6)] px-[var(--space-5)] py-[var(--space-6)] lg:px-[var(--space-6)]">
        <DocsHero
          eyebrow="Examples"
          title="Build local tools that talk to your agents."
          summary="Run complete Port Daddy examples for browser buttons, incident rooms, handoff inboxes, edit guards, migration runners, service discovery, and recoverable work logs."
          paragraphs={[
            'Port Daddy gives local scripts, web pages, and coding agents the same shared substrate: messages, locks, sessions, notes, service names, and file claims.',
            'Pick the tool you want to build, run its example, then copy the pattern into an editor extension, test reporter, browser page, CI hook, or agent prompt.',
          ]}
          aside={
            <DocsNoteCard label="Start" title="Pick the tool you need." elevation="quiet" padding="compact" titleSize="nav">
              <PanelBody size="compact" className="max-w-none">
                Want a button that reaches Claude Code or ChatGPT? Start with PD Tube. Want fewer file collisions?
                Start with the edit guard. Want safe database changes? Start with the migration runner.
              </PanelBody>
              <div className="flex flex-wrap gap-[var(--panel-gap-tight)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
                <BracketLink to="/docs/examples" tone="blue" side="left">
                  Read docs/examples
                </BracketLink>
                <BracketLink to="/docs/cli" tone="accent" side="right">
                  CLI reference
                </BracketLink>
              </div>
            </DocsNoteCard>
          }
        />

        <section className="grid gap-[var(--panel-gap)] lg:grid-cols-12" aria-labelledby="examples-list">
          <div className="lg:col-span-4">
            <DocsNoteCard label="Catalogue" title="Choose by what you want to build." elevation="quiet" padding="compact" titleSize="nav">
              <PanelBody size="compact" className="max-w-none">
                Each page shows the command to run, the files involved, the daemon state it creates, the full source,
                and the product pattern you can reuse in your own tool.
              </PanelBody>
            </DocsNoteCard>
          </div>

          <div className="grid gap-[var(--panel-gap)] lg:col-span-8">
            <h2 id="examples-list" className="sr-only">
              Example catalogue
            </h2>
            {EXAMPLE_DOCS.map((example, index) => (
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
