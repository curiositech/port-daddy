import { Navigate, useLocation, useParams } from 'react-router-dom'
import { Footer } from '@/components/layout/Footer'
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

function sectionAnchor(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
    ...example.sections.map((section) => ({ id: section.id, title: section.title })),
    { id: 'run', title: 'Run it' },
    { id: 'source', title: 'Full source' },
    { id: 'adapt', title: 'Adapt it' },
  ]
  const activeAnchor = location.hash ? location.hash.replace('#', '') : anchors[0]?.id

  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content" className="mx-auto grid w-full max-w-[var(--layout-max-width-wide)] gap-[var(--space-6)] px-[var(--space-5)] py-[var(--space-6)] lg:px-[var(--space-6)]">
        <DocsHero
          eyebrow={example.eyebrow}
          title={example.title}
          summary={example.summary}
          paragraphs={[
            `Last reviewed ${example.lastReviewed}. Level: ${example.level}. Estimated time: ${example.time}.`,
            `Tags: ${example.tags.join(', ')}.`,
          ]}
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

        <div className="grid gap-[var(--space-6)] xl:grid-cols-[minmax(0,1fr)_var(--docs-rail-width)]">
          <div className="space-y-[var(--space-5)]">
            <DocsNoteCard label="Prerequisites" title="Before you run it." elevation="quiet">
              <PanelList items={example.prerequisites} />
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
                  <DocsCodeBlock code={command.command} language="cli" label={command.title} />
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
                  <DocsCodeBlock code={file.code} language={file.language} label={file.path} />
                </article>
              ))}
            </section>

            <section id="adapt" className="scroll-mt-[calc(var(--space-10)+var(--space-6))]">
              <DocsNoteCard label="Adapt it" title="How to turn this into product code." tone="accent">
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
