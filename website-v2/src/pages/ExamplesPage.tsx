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

export function ExamplesPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content" className="mx-auto grid w-full max-w-[var(--layout-max-width-wide)] gap-[var(--space-6)] px-[var(--space-5)] py-[var(--space-6)] lg:px-[var(--space-6)]">
        <DocsHero
          eyebrow="Examples"
          title="Build tools that can reach your local agent."
          summary="These are complete executable examples for the thing Port Daddy makes newly easy: a browser, test runner, editor command, or webhook can summon the agent session already running in your repo."
          paragraphs={[
            'PD Tube is the flagship primitive. It turns local events into a blocking CLI loop with threaded replies, so the publisher stays tiny and the agent runtime stays swappable.',
            'Pick the tool you want to build, run the source in /examples, then copy the publisher shape into your editor extension, test reporter, browser page, bot adapter, or local control panel.',
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

        <section className="grid gap-[var(--panel-gap)] lg:grid-cols-12" aria-labelledby="examples-list">
          <div className="lg:col-span-4">
            <DocsNoteCard label="Catalogue" title="More tools built from the same primitive." elevation="quiet" padding="compact" titleSize="nav">
              <PanelBody size="compact" className="max-w-none">
                The rest of the catalogue is deliberately narrow: publishers a developer would actually ship.
                Each page keeps the full source visible and explains how to turn it into product code.
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
