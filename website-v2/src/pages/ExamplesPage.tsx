import { Footer } from '@/components/layout/Footer'
import { ExampleArtwork } from '@/components/examples/ExampleArtwork'
import {
  BracketLink,
  DocsHero,
  DocsNoteCard,
  PanelBody,
  PanelEyebrow,
  PanelList,
  PanelTitle,
} from '@/components/site/primitives'
import { EXAMPLE_GROUPS, FEATURED_EXAMPLE, examplesForGroup } from '@/data/examples'

export function ExamplesPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content" className="mx-auto grid w-full max-w-[var(--layout-max-width-wide)] gap-[var(--space-6)] px-[var(--space-5)] py-[var(--space-6)] lg:px-[var(--space-6)]">
        <DocsHero
          eyebrow="Examples"
          title="Small programs that hand work to your coding agent."
          summary="You already have a coding agent running in a repo terminal — Claude Code, Codex, Cursor. Each example is a short program that sends it a task and shows the reply. A button click, a failing test, an editor command, or an incoming webhook becomes a job the agent picks up."
          paragraphs={[
            'They all use the same trick. The program posts a small message to the Port Daddy daemon on your machine. The agent in your terminal reads the message, does the work, and replies. No hosted service, no extra account.',
            'Start with the example closest to what you want to build. Run the source from the examples folder, then move the few lines that publish the message into your own editor extension, test reporter, bot, or web page. The agent side never changes.',
          ]}
          aside={
            <div className="grid gap-[var(--panel-gap)]">
              <ExampleArtwork example={FEATURED_EXAMPLE} priority variant="hero" />
              <DocsNoteCard label="Start here" title="Read PD Tube first." elevation="quiet" padding="compact" titleSize="nav">
                <PanelBody size="compact" className="max-w-none">
                  PD Tube is the smallest version of the idea. A web page sends one task, the agent acts, and the threaded reply shows up inline. Every other example is a variation on that one exchange.
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
            label={FEATURED_EXAMPLE.eyebrow}
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
                <PanelEyebrow>What it builds</PanelEyebrow>
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

        {EXAMPLE_GROUPS.map((group) => {
          const groupExamples = examplesForGroup(group)
          if (groupExamples.length === 0) return null
          const headingId = `examples-group-${group.id}`
          return (
            <section
              key={group.id}
              className="grid gap-[var(--panel-gap)] lg:grid-cols-12"
              aria-labelledby={headingId}
            >
              <div className="lg:col-span-4">
                <DocsNoteCard
                  label={group.label}
                  title={group.title}
                  titleId={headingId}
                  elevation="quiet"
                  padding="compact"
                  titleSize="nav"
                >
                  <PanelBody size="compact" className="max-w-none">
                    {group.blurb}
                  </PanelBody>
                  <div className="pt-[var(--panel-gap-tight)]">
                    <PanelEyebrow>
                      {groupExamples.length} example{groupExamples.length === 1 ? '' : 's'}
                    </PanelEyebrow>
                  </div>
                </DocsNoteCard>
              </div>

              <div className="grid gap-[var(--panel-gap)] lg:col-span-8">
                {groupExamples.map((example, index) => (
                  <DocsNoteCard
                    key={example.slug}
                    label={example.eyebrow}
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
                        <div className="space-y-[var(--space-1)] pt-[var(--space-1)]">
                          <PanelEyebrow>What it builds</PanelEyebrow>
                          <PanelBody size="compact" className="max-w-[58rem] text-[var(--text-secondary)]">
                            {example.builds}
                          </PanelBody>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-[var(--panel-gap)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)] md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.42fr)]">
                      <div className="space-y-[var(--panel-gap-tight)]">
                        <PanelEyebrow>Files</PanelEyebrow>
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
                        <PanelEyebrow>What you get</PanelEyebrow>
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
          )
        })}
      </main>

      <Footer />
    </div>
  )
}
