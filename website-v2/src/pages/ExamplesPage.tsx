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
          title="Executable examples, documented like source code."
          summary="Each example is a real file in the repository with a dedicated page: prerequisites, commands, full source, explanation, and adaptation notes."
          paragraphs={[
            'The examples route is not a gallery and not marketing copy. It is the north-star corpus for how Port Daddy is supposed to work in real local agent systems.',
            'Start from the table of contents, open the example that matches your workflow, run the command, inspect the daemon state, then copy the pattern into a tool, hook, extension, or agent prompt.',
          ]}
          aside={
            <DocsNoteCard label="Model" title="Cloudflare-style examples." elevation="quiet" padding="compact" titleSize="nav">
              <PanelBody size="compact" className="max-w-none">
                One page per executable pattern. Full source stays visible. The guide explains why the code is shaped
                that way instead of hiding the important parts behind a teaser card.
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
            <DocsNoteCard label="Catalogue" title="Choose by primitive." elevation="quiet" padding="compact" titleSize="nav">
              <PanelBody size="compact" className="max-w-none">
                These are the pages that should set the quality bar for new examples. If a future example cannot name
                its files, commands, observable state, and adaptation path, it does not belong here.
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
                <PanelBody className="max-w-[58rem]">{example.summary}</PanelBody>

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
