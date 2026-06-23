import { Navigate, useLocation, useParams } from 'react-router-dom'
import { Footer } from '@/components/layout/Footer'
import { ExampleArtwork } from '@/components/examples/ExampleArtwork'
import {
  BracketAnchor,
  BracketLink,
  DocsCodeBlock,
  DocsHero,
  DocsNoteCard,
  PanelBody,
  PanelList,
  PanelTitle,
} from '@/components/site/primitives'
import { EXAMPLE_DOCS, findExampleDoc } from '@/data/examples'
import { TerminalGif } from '@/components/site/TerminalGif'
import { findTerminalRecording } from '@/data/terminalRecordings'

function sectionAnchor(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function exampleMetaLines(example: {
  lastReviewed: string
  time: string
  files: string[]
  commands: { title: string }[]
}) {
  return [
    `Last checked ${example.lastReviewed}. Plan on about ${example.time} the first time, reading the source included.`,
    `${example.files.length} source file${example.files.length === 1 ? '' : 's'}, ${example.commands.length} command${example.commands.length === 1 ? '' : 's'} to run. The program that sends the task stays short. The actual work happens in the agent terminal you already have open.`,
  ]
}

export function ExampleDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const location = useLocation()
  const example = findExampleDoc(slug)

  if (!example) {
    return <Navigate to="/examples" replace />
  }

  const sourceAnchors = example.sourceFiles.map((file) => ({
    id: sectionAnchor(file.path),
    title: file.path,
  }))
  const anchors = [
    ...(example.uiScreenshots?.length ? [{ id: 'ui-screenshots', title: 'UI screenshots' }] : []),
    ...example.sections.map((section) => ({ id: section.id, title: section.title })),
    { id: 'run', title: 'Run it' },
    { id: 'source', title: 'Full source' },
    { id: 'adapt', title: 'Adapt it' },
  ]
  const activeAnchor = location.hash ? location.hash.replace('#', '') : anchors[0]?.id
  const needsPortDaddy = example.prerequisites.some((item) => item.toLowerCase().includes('port daddy'))
  const recording = findTerminalRecording(`/examples/${example.slug}`)

  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content" className="mx-auto grid w-full max-w-[var(--layout-max-width-wide)] gap-[var(--space-6)] px-[var(--space-5)] py-[var(--space-6)] lg:px-[var(--space-6)]">
        <DocsHero
          eyebrow={example.eyebrow}
          title={example.title}
          summary={example.summary}
          paragraphs={exampleMetaLines(example)}
          aside={
            <DocsNoteCard label="Files in this example" elevation="quiet" padding="compact">
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
            </DocsNoteCard>
          }
        />

        <section aria-label={`${example.title} artwork`}>
          <ExampleArtwork example={example} priority variant="hero" />
        </section>

        <div className="grid gap-[var(--space-6)] xl:grid-cols-[minmax(0,1fr)_var(--docs-rail-width)]">
          <div className="space-y-[var(--space-5)]">
            <DocsNoteCard label="What this builds" title={example.builds} elevation="quiet">
              <div className="space-y-[var(--panel-gap-tight)]">
                <PanelBody className="max-w-[60rem]">{example.surveyPlain}</PanelBody>
                <PanelBody className="max-w-[60rem] text-[var(--text-secondary)]">{example.whyItMatters}</PanelBody>
              </div>
            </DocsNoteCard>

            {example.uiScreenshots?.length ? (
              <section id="ui-screenshots" className="scroll-mt-[calc(var(--space-10)+var(--space-6))]">
                <DocsNoteCard label="UI screenshots" title="What this looks like when it runs." elevation="quiet">
                  <div className="grid gap-[var(--panel-gap)]">
                    {example.uiScreenshots.map((screenshot) => (
                      <figure key={screenshot.src} className="m-0 grid gap-[var(--panel-gap-tight)]">
                        <img
                          src={screenshot.src}
                          alt={screenshot.alt}
                          loading="lazy"
                          decoding="async"
                          className="w-full border-2 border-[var(--border-strong)] bg-[var(--surface-inverse)] object-contain"
                        />
                        <figcaption className="grid gap-[var(--space-2)] border-l-2 border-[var(--border-strong)] pl-[var(--space-4)]">
                          <PanelTitle as="span" size="nav">
                            {screenshot.title}
                          </PanelTitle>
                          <PanelBody size="compact" className="max-w-[58rem] text-[var(--text-secondary)]">
                            {screenshot.caption}
                          </PanelBody>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </DocsNoteCard>
              </section>
            ) : null}

            {recording ? (
              <TerminalGif src={recording.gifSrc} title={recording.title} caption={recording.caption} />
            ) : null}

            <DocsNoteCard label="Prerequisites" title="Before you run it." elevation="quiet">
              <PanelList items={example.prerequisites} />
              {needsPortDaddy ? (
                <div className="grid gap-[var(--space-3)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
                  <PanelBody size="compact" className="max-w-[58rem]">
                    This example needs Port Daddy installed and its daemon running. If you do not have it yet, set that up first — the example will not work without it.
                  </PanelBody>
                  <div className="flex flex-wrap gap-[var(--panel-gap-tight)]">
                    <BracketLink to="/docs/get-started" tone="blue" side="left">
                      Install Port Daddy
                    </BracketLink>
                  </div>
                </div>
              ) : null}
            </DocsNoteCard>

            {example.sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-[calc(var(--space-10)+var(--space-6))]">
                <DocsNoteCard label={section.label} title={section.title}>
                  <div className="space-y-[var(--panel-gap-tight)]">
                    {section.paragraphs.map((paragraph) => (
                      <PanelBody key={paragraph} className="max-w-[60rem]">
                        {paragraph}
                      </PanelBody>
                    ))}
                  </div>
                </DocsNoteCard>
              </section>
            ))}

            <section id="run" className="scroll-mt-[calc(var(--space-10)+var(--space-6))] space-y-[var(--panel-gap)]">
              <PanelTitle as="h2" size="nav">
                Run it
              </PanelTitle>
              {example.commands.map((command) => (
                <DocsNoteCard key={command.title} label="Command" title={command.title} tone="blue">
                  <DocsCodeBlock code={command.command} language="cli" label={command.title} copyable={false} />
                  {command.notes?.length ? <PanelList items={command.notes} tone="primary" /> : null}
                </DocsNoteCard>
              ))}
            </section>

            <section id="source" className="scroll-mt-[calc(var(--space-10)+var(--space-6))] space-y-[var(--panel-gap)]">
              <PanelTitle as="h2" size="nav">
                Full source
              </PanelTitle>
              {example.sourceFiles.map((file) => (
                <article key={file.path} id={sectionAnchor(file.path)} className="scroll-mt-[calc(var(--space-10)+var(--space-6))]">
                  <DocsCodeBlock code={file.code} language={file.language} label={file.path} copyable={false} />
                </article>
              ))}
            </section>

            <section id="adapt" className="scroll-mt-[calc(var(--space-10)+var(--space-6))]">
              <DocsNoteCard label="Adapt it" title="Turn this demo into your own tool." tone="accent">
                <PanelList items={example.adapt} tone="accent" />
              </DocsNoteCard>
            </section>
          </div>

          <aside className="space-y-[var(--panel-gap)] xl:sticky xl:top-24 xl:self-start">
            <DocsNoteCard label="On this page" elevation="quiet" padding="compact">
              <div className="flex flex-col gap-[var(--space-2)]">
                {anchors.map((anchor, index) => (
                  <BracketAnchor
                    key={anchor.id}
                    href={`#${anchor.id}`}
                    side={index % 2 === 0 ? 'left' : 'right'}
                    tone={index % 2 === 0 ? 'blue' : 'accent'}
                    active={activeAnchor === anchor.id}
                  >
                    {anchor.title}
                  </BracketAnchor>
                ))}
              </div>
            </DocsNoteCard>

            <DocsNoteCard label="Source files" elevation="quiet" padding="compact">
              <div className="flex flex-col gap-[var(--space-2)]">
                {sourceAnchors.map((anchor, index) => (
                  <BracketAnchor
                    key={anchor.id}
                    href={`#${anchor.id}`}
                    side={index % 2 === 0 ? 'left' : 'right'}
                    tone={index % 2 === 0 ? 'accent' : 'blue'}
                  >
                    {anchor.title}
                  </BracketAnchor>
                ))}
              </div>
            </DocsNoteCard>

            <DocsNoteCard label="Related" elevation="quiet" padding="compact">
              <div className="flex flex-col gap-[var(--space-2)]">
                {example.related.map((link, index) => (
                  <BracketLink
                    key={link.href}
                    to={link.href}
                    side={index % 2 === 0 ? 'left' : 'right'}
                    tone={index % 2 === 0 ? 'blue' : 'accent'}
                  >
                    {link.title}
                  </BracketLink>
                ))}
              </div>
            </DocsNoteCard>

            <DocsNoteCard label="Catalogue" title="More examples" elevation="quiet" padding="compact" titleSize="nav">
              <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
                {EXAMPLE_DOCS.filter((item) => item.slug !== example.slug).map((item, index) => (
                  <BracketLink
                    key={item.slug}
                    to={`/examples/${item.slug}`}
                    side={index % 2 === 0 ? 'left' : 'right'}
                    tone={index % 2 === 0 ? 'blue' : 'accent'}
                  >
                    {item.title}
                  </BracketLink>
                ))}
              </div>
            </DocsNoteCard>
          </aside>
        </div>
      </main>

      <Footer />
    </div>
  )
}
