import { Footer } from '@/components/layout/Footer'
import { ExampleArtwork } from '@/components/examples/ExampleArtwork'
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
          title="Executable local loops for agent products."
          summary="These complete examples show the product surface Port Daddy unlocks: a browser, test runner, editor command, or webhook can hand structured work to the agent session already running in the repo."
          paragraphs={[
            'PD Tube is the flagship primitive. It turns local events into a blocking CLI loop with threaded replies, so publishers stay tiny and the agent runtime stays swappable.',
            'Pick the tool you want to build, run the source in /examples, then copy the publisher shape into an editor extension, test reporter, browser page, bot adapter, or local control panel.',
          ]}
          aside={
            <div className="grid gap-[var(--panel-gap)]">
              <ExampleArtwork example={FEATURED_EXAMPLE} priority variant="hero" />
              <DocsNoteCard label="Start" title="Start with the phone line." elevation="quiet" padding="compact" titleSize="nav">
                <PanelBody size="compact" className="max-w-none">
                  If you only read one example, read PD Tube. It is the minimal shape an AI tooling team can copy:
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
            </div>
          }
        />

        <section aria-label="Featured PD Tube example" className="grid gap-[var(--panel-gap)] xl:grid-cols-[minmax(20rem,0.42fr)_minmax(0,1fr)]">
          <ExampleArtwork example={FEATURED_EXAMPLE} className="xl:h-full xl:[&_img]:h-full xl:[&_img]:aspect-auto" />
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
            <DocsNoteCard label="Executable catalogue" title="Source-backed examples you can run today." elevation="quiet" padding="compact" titleSize="nav">
              <PanelBody size="compact" className="max-w-none">
                These are executable source packages, not reference teasers. Each card opens a page with runnable
                commands, full source files, and the product shape an agent-facing tool can adopt.
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
                <div className="grid gap-[var(--panel-gap)] md:grid-cols-[minmax(13rem,0.36fr)_minmax(0,1fr)]">
                  <ExampleArtwork example={example} />
                  <div className="space-y-[var(--space-2)]">
                    <PanelBody className="max-w-[58rem]">{example.summary}</PanelBody>
                    <PanelBody className="max-w-[58rem] text-[var(--text-secondary)]">{example.surveyPlain}</PanelBody>
                    <PanelBody size="compact" className="max-w-[58rem] text-[var(--text-secondary)]">
                      Builds: {example.builds}
                    </PanelBody>
                  </div>
                </div>

                <div className="grid gap-[var(--panel-gap)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)] md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.42fr)]">
                  <div className="space-y-[var(--panel-gap-tight)]">
                    <BracketLabel side={index % 2 === 0 ? 'left' : 'right'}>Files</BracketLabel>
                    <div className="grid gap-[var(--space-2)]">
                      {example.files.map((file) => (
                        <code
                          key={file}
                          className="!block min-w-0 break-all !whitespace-normal border border-[var(--border-default)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[length:var(--type-meta-size)] text-[var(--text-primary)]"
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
