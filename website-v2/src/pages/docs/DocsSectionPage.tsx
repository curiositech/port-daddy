import { Fragment, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import {
  BracketAnchor,
  BracketLabel,
  BracketNavLink,
  DocsCard,
  DocsCodeBlock,
  DocsHero,
  DocsModulePanel,
  DocsNoteCard,
  PanelBody,
  PanelList,
  PanelTitle,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'
import { Mermaid } from '@/components/ui/Mermaid'
import { findDocsFamily, findDocsRouteBySlug } from '@/data/publicSite'
import { findDocsContentPage, findDocsContentSection } from '@/docs-content'
import { withChartPalette } from '@/docs-content/chartTokens'
import { cn } from '@/lib/utils'
import type { ContentBlock, DocsContentPage } from '@/docs-content'

function pageTone(page: DocsContentPage) {
  return page.truth === 'source-backed' ? 'blue' : 'accent'
}

function blockLabel(block: ContentBlock) {
  switch (block.type) {
    case 'paragraph':
      return 'Overview'
    case 'checklist':
      return 'Checklist'
    case 'command':
      return 'Command'
    case 'mermaid':
      return 'Diagram'
    case 'callout':
      return block.tone === 'warning' ? 'Blocked or caution' : 'Note'
  }
}

function blockHeading(block: ContentBlock, index: number) {
  switch (block.type) {
    case 'paragraph':
      return block.title ?? `Overview ${String(index + 1).padStart(2, '0')}`
    case 'checklist':
      return block.title ?? `Checklist ${String(index + 1).padStart(2, '0')}`
    case 'command':
      return block.title
    case 'mermaid':
      return block.title
    case 'callout':
      return block.title
  }
}

function paragraphSet(block: Extract<ContentBlock, { type: 'paragraph' }>) {
  return block.paragraphs?.length ? block.paragraphs : block.text ? [block.text] : []
}

function toAnchorId(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildAnchoredBlocks(blocks: ContentBlock[]) {
  return blocks.map((block, index) => {
    const heading = blockHeading(block, index)
    return {
      block,
      heading,
      label: blockLabel(block),
      id: toAnchorId(heading),
    }
  })
}

const inlineLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g
const primitiveToneClass = {
  ink: 'border-[var(--border-strong)] bg-[var(--text-primary)] text-[var(--text-inverse)]',
  blue: 'border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
  green: 'border-[var(--border-strong)] bg-[var(--status-success)] text-[var(--text-inverse)]',
  amber: 'border-[var(--border-strong)] bg-[var(--status-warning)] text-[var(--text-primary)]',
  red: 'border-[var(--border-strong)] bg-[var(--status-error)] text-[var(--text-inverse)]',
} as const
const checklistBodyTone = {
  paper: 'default',
  blue: 'primary',
  accent: 'accent',
} as const
type DocsSurfaceTone = keyof typeof checklistBodyTone

function surfaceToneForBlock(block: ContentBlock, index: number): DocsSurfaceTone {
  if (block.type === 'mermaid') {
    return index % 2 === 0 ? 'paper' : 'blue'
  }

  if (block.type === 'paragraph') {
    const tones: DocsSurfaceTone[] = ['paper', 'blue', 'accent']
    return tones[index % tones.length]
  }

  return 'paper'
}

function panelToneForSurface(tone: DocsSurfaceTone) {
  return checklistBodyTone[tone]
}

function renderInlineLinks(text: string) {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = inlineLinkPattern.exec(text))) {
    const [source, label, href] = match

    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const className =
      'font-semibold text-[var(--brand-primary)] underline decoration-[var(--border-strong)] underline-offset-4 transition-colors hover:text-[var(--text-primary)]'
    const key = `${href}-${match.index}`

    nodes.push(
      href.startsWith('/') ? (
        <Link key={key} to={href} className={className}>
          {label}
        </Link>
      ) : (
        <a key={key} href={href} className={className}>
          {label}
        </a>
      ),
    )

    lastIndex = match.index + source.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes.length ? nodes : text
}

function renderStructuredLink(
  link: { label: string; href: string },
  className =
    'font-semibold text-[var(--brand-primary)] underline decoration-[var(--border-strong)] underline-offset-4 transition-colors hover:text-[var(--text-primary)]',
) {
  return link.href.startsWith('/') ? (
    <Link key={link.href} to={link.href} className={className}>
      {link.label}
    </Link>
  ) : (
    <a key={link.href} href={link.href} className={className} target="_blank" rel="noreferrer">
      {link.label}
    </a>
  )
}

function StructuredLinkList({
  links,
  className,
}: {
  links: Array<{ label: string; href: string }>
  className?: string
}) {
  return (
    <div className={`flex flex-wrap gap-[var(--space-2)] ${className ?? ''}`}>
      {links.map((link) =>
        renderStructuredLink(
          link,
          'inline-flex border border-[var(--border-default)] bg-[var(--surface-base)] px-[var(--space-2)] py-[var(--space-1)] font-mono text-[length:var(--type-meta-size)] font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-strong)]',
        ),
      )}
    </div>
  )
}

function PrimitiveMapPage({ page }: { page: DocsContentPage }) {
  const map = page.primitiveMap

  if (!map) {
    return null
  }

  return (
    <div className="space-y-[var(--space-7)]">
      <SurfacePanel className="grid gap-[var(--panel-gap-loose)] lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)]">
        <div className="space-y-[var(--panel-gap)]">
          <BracketLabel>{map.eyebrow}</BracketLabel>
          <PanelTitle as="h1" size="section" className="max-w-[10ch]">
            {map.title}
          </PanelTitle>
          <PanelBody className="max-w-[50rem] text-[length:var(--type-panel-body-large-size)] leading-[var(--leading-body-large)]">
            {map.deck}
          </PanelBody>
          <PanelBody className="max-w-[54rem]">{map.thesis}</PanelBody>
        </div>
        <div className="grid content-start gap-[var(--space-2)]">
          {map.operatorQuestions.map((question, index) => (
            <div
              key={question}
              className={`border-2 px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] ${
                index % 2 === 0
                  ? 'border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                  : 'border-[var(--border-default)] bg-[var(--surface-base)] text-[var(--text-primary)]'
              }`}
            >
              {question}
            </div>
          ))}
        </div>
      </SurfacePanel>

      <section className="space-y-[var(--panel-gap)]">
        <div className="grid gap-[var(--panel-gap)] lg:grid-cols-[0.36fr_1fr]">
          <div>
            <BracketLabel>Primitive families</BracketLabel>
          </div>
          <PanelTitle as="h2" size="card" className="max-w-[16ch]">
            Six families, six kinds of runtime truth.
          </PanelTitle>
        </div>
        <SwissGrid>
          {map.families.map((family) => (
            <SwissGridItem key={family.family} span="half">
              <SurfacePanel padding="compact" className="grid h-full gap-[var(--panel-gap-tight)]">
                <div className={`inline-flex w-max border-2 px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] ${primitiveToneClass[family.tone]}`}>
                  {family.family}
                </div>
                <PanelTitle as="h3" size="nav">
                  {family.question}
                </PanelTitle>
                <PanelBody size="compact" className="max-w-none">
                  {family.summary}
                </PanelBody>
                <StructuredLinkList links={family.links} />
              </SurfacePanel>
            </SwissGridItem>
          ))}
        </SwissGrid>
      </section>

      <section className="space-y-[var(--panel-gap)]">
        <div className="grid gap-[var(--panel-gap)] lg:grid-cols-[0.36fr_1fr]">
          <div>
            <BracketLabel>Runtime stack</BracketLabel>
          </div>
          <PanelTitle as="h2" size="card" className="max-w-[14ch]">
            Use the primitive whose lifetime matches the fact.
          </PanelTitle>
        </div>
        <SurfacePanel padding="compact">
          <div className="hidden border-2 border-[var(--border-strong)] lg:grid lg:grid-cols-[0.22fr_0.22fr_0.22fr_0.34fr]">
            {['Layer', 'Encodes', 'Why it exists', 'Example'].map((heading) => (
              <div key={heading} className="border-b-2 border-[var(--border-strong)] bg-[var(--text-primary)] p-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] md:border-r-2 md:last:border-r-0">
                {heading}
              </div>
            ))}
            {map.layers.map((layer) => (
              <Fragment key={layer.layer}>
                <div key={`${layer.layer}-name`} className="border-b border-[var(--border-default)] p-[var(--space-3)] md:border-r">
                  <PanelTitle as="h3" size="nav">
                    {layer.layer}
                  </PanelTitle>
                  <StructuredLinkList links={layer.links} className="mt-[var(--space-2)]" />
                </div>
                <PanelBody key={`${layer.layer}-encodes`} as="div" className="max-w-none border-b border-[var(--border-default)] p-[var(--space-3)] md:border-r">
                  {layer.encodes}
                </PanelBody>
                <PanelBody key={`${layer.layer}-reason`} as="div" className="max-w-none border-b border-[var(--border-default)] p-[var(--space-3)]">
                  {layer.reason}
                </PanelBody>
                <div key={`${layer.layer}-example`} className="border-b border-[var(--border-default)] p-[var(--space-3)]">
                  <DocsCodeBlock
                    code={`${layer.example.command}\n\n${layer.example.output}`}
                    language="text"
                    label={`${layer.layer} example`}
                  />
                </div>
              </Fragment>
            ))}
          </div>
          <div className="grid gap-[var(--space-3)] lg:hidden">
            {map.layers.map((layer) => (
              <SurfacePanel key={layer.layer} elevation="quiet" padding="compact" className="space-y-[var(--space-3)]">
                <div className="space-y-[var(--space-2)]">
                  <PanelTitle as="h3" size="nav">
                    {layer.layer}
                  </PanelTitle>
                  <StructuredLinkList links={layer.links} />
                </div>
                <div className="grid gap-[var(--space-2)]">
                  <BracketLabel>Encodes</BracketLabel>
                  <PanelBody size="compact" className="max-w-none">
                    {layer.encodes}
                  </PanelBody>
                </div>
                <div className="grid gap-[var(--space-2)]">
                  <BracketLabel>Why it exists</BracketLabel>
                  <PanelBody size="compact" className="max-w-none">
                    {layer.reason}
                  </PanelBody>
                </div>
                <DocsCodeBlock
                  code={`${layer.example.command}\n\n${layer.example.output}`}
                  language="text"
                  label={`${layer.layer} example`}
                />
              </SurfacePanel>
            ))}
          </div>
        </SurfacePanel>
      </section>

      <section className="space-y-[var(--panel-gap)]">
        <div className="grid gap-[var(--panel-gap)] lg:grid-cols-[0.36fr_1fr]">
          <div>
            <BracketLabel>Choosing</BracketLabel>
          </div>
          <PanelTitle as="h2" size="card" className="max-w-[14ch]">
            Pick by need, not by slogan.
          </PanelTitle>
        </div>
        <div className="grid gap-[var(--panel-gap)] md:grid-cols-2">
          {map.choices.map((choice) => (
            <SurfacePanel key={choice.need} padding="compact" className="space-y-[var(--panel-gap-tight)]">
              <PanelTitle as="h3" size="nav">
                {choice.need}
              </PanelTitle>
              <StructuredLinkList links={choice.use} />
              <PanelBody size="compact" className="max-w-none">
                Avoid: {choice.avoid}
              </PanelBody>
            </SurfacePanel>
          ))}
        </div>
      </section>

      <section className="space-y-[var(--panel-gap)]">
        <div className="grid gap-[var(--panel-gap)] lg:grid-cols-[0.36fr_1fr]">
          <div>
            <BracketLabel>Citations</BracketLabel>
          </div>
          <PanelTitle as="h2" size="card" className="max-w-[18ch]">
            Source evidence for the runtime map.
          </PanelTitle>
        </div>
        <div className="grid gap-[var(--panel-gap)] xl:grid-cols-2">
          {map.citations.map((citation) => (
            <SurfacePanel key={citation.title} padding="compact" className="space-y-[var(--panel-gap)]">
              <div className="space-y-[var(--space-2)]">
                <PanelTitle as="h3" size="nav">
                  {citation.title}
                </PanelTitle>
                <PanelBody size="compact" className="max-w-none">
                  {citation.summary}
                </PanelBody>
              </div>
              <div className="grid gap-[var(--space-3)]">
                <div className="space-y-[var(--space-2)]">
                  <BracketLabel side="left">Website pages</BracketLabel>
                  <StructuredLinkList links={citation.websiteDocs} />
                </div>
                <div className="space-y-[var(--space-2)]">
                  <BracketLabel side="left">Runtime code</BracketLabel>
                  <StructuredLinkList links={citation.runtimeCode} />
                </div>
                <div className="space-y-[var(--space-2)]">
                  <BracketLabel side="left">Skill dossiers</BracketLabel>
                  <StructuredLinkList links={citation.skillDossiers} />
                </div>
              </div>
            </SurfacePanel>
          ))}
        </div>
      </section>

      <SurfacePanel tone="blue" className="space-y-[var(--panel-gap)]">
        <BracketLabel surface="blue">Jury-rig dossier trail</BracketLabel>
        <PanelTitle as="h2" size="card" tone="primary" className="max-w-[18ch]">
          Jury-rig skill dossiers.
        </PanelTitle>
        <PanelBody tone="primary" className="max-w-[58rem]">
          External coordination references for the primitive map.
        </PanelBody>
        <StructuredLinkList links={map.skillTrail} />
      </SurfacePanel>
    </div>
  )
}

function InlinePanelList({
  items,
  className,
  tone = 'default',
}: {
  items: string[]
  className?: string
  tone?: 'default' | 'primary' | 'accent'
}) {
  return (
    <div data-slot="panel-list" className={`space-y-[var(--panel-gap-tight)] ${className ?? ''}`}>
      {items.map((item) => (
        <PanelBody key={item} as="p" size="compact" tone={tone} className="max-w-none">
          {renderInlineLinks(item)}
        </PanelBody>
      ))}
    </div>
  )
}

function checklistTone(block: Extract<ContentBlock, { type: 'checklist' }>, index: number) {
  return block.tone ?? (index % 2 === 0 ? 'blue' : 'accent')
}

function ChecklistRows({
  items,
  tone,
}: {
  items: string[]
  tone: 'paper' | 'blue' | 'accent'
}) {
  const bodyTone = checklistBodyTone[tone]

  return (
    <ul className="grid gap-[var(--space-2)] border-t-2 border-[color:var(--border-strong)]/20 pt-[var(--panel-gap)]">
      {items.map((item, itemIndex) => (
        <li
          key={item}
          className={cn(
            'grid gap-[var(--space-3)] border-2 p-[var(--space-3)] md:grid-cols-[3rem_minmax(0,1fr)]',
            tone === 'paper'
              ? 'border-[var(--border-default)] bg-[var(--surface-base)]'
              : 'border-[color:var(--brand-primary-foreground-subtle)] bg-[color:rgba(255,255,255,0.08)]',
          )}
        >
          <div
            className={cn(
              'flex h-11 w-11 items-center justify-center border-2',
              tone === 'paper'
                ? itemIndex % 2 === 0
                  ? 'border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                  : 'border-[var(--border-strong)] bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]'
                : 'border-[color:var(--brand-primary-foreground-subtle)] text-[var(--brand-primary-foreground)]',
            )}
          >
            <Check aria-hidden="true" className="h-5 w-5" strokeWidth={3} />
          </div>
          <PanelBody tone={bodyTone} className="max-w-none self-center">
            {renderInlineLinks(item)}
          </PanelBody>
        </li>
      ))}
    </ul>
  )
}

function sourceHref(path: string) {
  return `https://github.com/curiositech/port-daddy/blob/main/${path}`
}

function SourceTrail({ page }: { page: DocsContentPage }) {
  if (!page.sources.length) {
    return null
  }

  return (
    <DocsNoteCard label="Source trail" elevation="quiet" padding="compact">
      <div className="space-y-[var(--panel-gap-tight)]">
        {page.sources.map((source) => (
          <div
            key={source.path}
            className="border-t border-[var(--border-default)] pt-[var(--space-2)] first:border-t-0 first:pt-0"
          >
            <a
              href={sourceHref(source.path)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[length:var(--type-meta-size)] font-semibold text-[var(--brand-primary)] underline decoration-[var(--border-strong)] underline-offset-4"
            >
              {source.path}
            </a>
            <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
              {source.rationale}
            </PanelBody>
          </div>
        ))}
      </div>
    </DocsNoteCard>
  )
}

function renderContentBlock(block: ContentBlock, index: number) {
  const label = blockLabel(block)

  switch (block.type) {
    case 'paragraph': {
      const paragraphs = paragraphSet(block)
      const tone = surfaceToneForBlock(block, index)
      const textTone = panelToneForSurface(tone)
      return (
        <SurfacePanel
          key={`paragraph-${index}`}
          tone={tone}
          className={cn('pd-docs-section-block space-y-[var(--panel-gap)]', `pd-docs-section-block--${tone}`)}
        >
          <BracketLabel tone={textTone} surface={tone}>
            {label}
          </BracketLabel>
          <PanelTitle as="h2" size="nav" tone={textTone} className="max-w-none">
            {blockHeading(block, index)}
          </PanelTitle>
          <div className="pd-docs-paragraph-stack">
            {paragraphs.map((paragraph) => (
              <PanelBody key={paragraph} tone={textTone} className="pd-docs-body-copy max-w-[58rem]">
                {renderInlineLinks(paragraph)}
              </PanelBody>
            ))}
          </div>
        </SurfacePanel>
      )
    }
    case 'checklist':
      return (
        <DocsNoteCard
          key={`checklist-${index}`}
          label={label}
          title={blockHeading(block, index)}
          tone={checklistTone(block, index)}
        >
          <ChecklistRows items={block.items} tone={checklistTone(block, index)} />
        </DocsNoteCard>
      )
    case 'command':
      return (
        <DocsNoteCard key={`command-${index}`} label={label} title={block.title} tone="blue">
          <DocsCodeBlock code={block.command} language="cli" label={block.title} />
          {block.output ? (
            <DocsCodeBlock
              code={block.output}
              language="text"
              label={`${block.title} output`}
            />
          ) : null}
          {block.notes?.length ? <InlinePanelList items={block.notes} tone="primary" /> : null}
        </DocsNoteCard>
      )
    case 'mermaid':
      {
        const tone = surfaceToneForBlock(block, index)
        const textTone = panelToneForSurface(tone)
        return (
          <SurfacePanel
            key={`mermaid-${index}`}
            tone={tone}
            className={cn(
              'pd-docs-section-block pd-docs-diagram-block space-y-[var(--panel-gap)]',
              `pd-docs-section-block--${tone}`,
            )}
          >
            <BracketLabel tone={textTone} surface={tone}>
              {label}
            </BracketLabel>
            <PanelTitle as="h2" size="nav" tone={textTone} className="max-w-none">
              {block.title}
            </PanelTitle>
            <Mermaid chart={withChartPalette(block.chart)} />
            {block.caption ? (
              <PanelBody size="compact" tone={textTone} className="max-w-[58rem]">
                {renderInlineLinks(block.caption)}
              </PanelBody>
            ) : null}
          </SurfacePanel>
        )
      }
    case 'callout':
      return (
        <DocsNoteCard
          key={`callout-${index}`}
          tone={block.tone === 'warning' ? 'accent' : 'paper'}
          label={label}
          title={block.title}
        >
          <PanelBody
            tone={block.tone === 'warning' ? 'accent' : 'default'}
            className="max-w-none"
          >
            {renderInlineLinks(block.body)}
          </PanelBody>
        </DocsNoteCard>
      )
  }
}

export default function DocsSectionPage() {
  const location = useLocation()
  const params = useParams<{ sectionSlug: string; '*': string }>()
  const sectionSlug = params.sectionSlug
  const pageSlug = params['*']?.split('/').filter(Boolean)[0]
  const route = sectionSlug ? findDocsRouteBySlug(sectionSlug) : undefined
  const section = sectionSlug ? findDocsFamily(sectionSlug) : undefined
  const contentSection = route ? findDocsContentSection(route.slug) : undefined
  const contentPage = route && pageSlug ? findDocsContentPage(route.slug, pageSlug) : undefined
  const leadParagraphBlock =
    contentPage?.blocks[0]?.type === 'paragraph' ? contentPage.blocks[0] : undefined
  const bodyBlocks = contentPage
    ? leadParagraphBlock
      ? contentPage.blocks.slice(1)
      : contentPage.blocks
    : []
  const anchoredBlocks = contentPage ? buildAnchoredBlocks(bodyBlocks) : []
  const activeAnchor = location.hash ? location.hash.replace('#', '') : anchoredBlocks[0]?.id
  const sectionPages = contentSection?.pages ?? []

  if (!sectionSlug || !route || !section) {
    return <Navigate to="/docs" replace />
  }

  if (route.slug !== sectionSlug) {
    return <Navigate to={route.path} replace />
  }

  if (pageSlug && !contentPage) {
    return <Navigate to={route.path} replace />
  }

  if (contentSection && contentPage?.variant === 'primitive-map') {
    return <PrimitiveMapPage page={contentPage} />
  }

  if (contentSection && contentPage) {
    return (
      <div className="space-y-[var(--space-6)]">
        <DocsHero
          eyebrow={section.title}
          title={contentPage.title}
          summary={contentPage.summary}
          paragraphs={leadParagraphBlock ? paragraphSet(leadParagraphBlock).map(renderInlineLinks) : []}
        />

        <div className="grid gap-[var(--space-6)] xl:grid-cols-[minmax(0,1fr)_var(--docs-rail-width)]">
          <div className="space-y-[var(--space-5)]">
            <div className="space-y-[var(--panel-gap)]">
              {anchoredBlocks.map(({ block, id }, index) => (
                <section
                  key={id}
                  id={id}
                  className="scroll-mt-[calc(var(--space-10)+var(--space-6))]"
                >
                  {renderContentBlock(block, index)}
                </section>
              ))}
            </div>
          </div>

          <aside className="space-y-[var(--panel-gap)] xl:sticky xl:top-24 xl:self-start">
            {contentPage.truth === 'blocked' ? (
              <DocsNoteCard
                label="In progress"
                title="Important topic, still being tightened"
                tone={pageTone(contentPage)}
                elevation="quiet"
                padding="compact"
                titleSize="nav"
              >
                <PanelBody tone="accent" size="compact" className="max-w-none">
                  The commands and constraints here are real. The polished end-to-end workflow around them is still
                  being tightened.
                </PanelBody>
              </DocsNoteCard>
            ) : null}

            <DocsNoteCard label="What this page answers" elevation="quiet" padding="compact">
              <PanelList items={contentPage.goals} />
            </DocsNoteCard>

            <SourceTrail page={contentPage} />

            <DocsNoteCard label="On this page" elevation="quiet" padding="compact">
              <div className="flex flex-col gap-[var(--space-2)]">
                {anchoredBlocks.map(({ id, heading }, index) => (
                  <BracketAnchor
                    key={id}
                    href={`#${id}`}
                    side={index % 2 === 0 ? 'left' : 'right'}
                    tone={index % 2 === 0 ? 'blue' : 'accent'}
                    active={activeAnchor === id}
                  >
                    {heading}
                  </BracketAnchor>
                ))}
              </div>
            </DocsNoteCard>

            {sectionPages.length > 1 ? (
              <DocsNoteCard
                label={`${section.title} pages`}
                title="Stay in the same thread."
                elevation="quiet"
                padding="compact"
                titleSize="nav"
              >
                <PanelBody size="compact" className="max-w-none">
                  Move laterally inside this topic before jumping back out to the full docs index.
                </PanelBody>
                <div className="flex flex-col gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]">
                  {sectionPages.map((page, index) => (
                    <BracketNavLink
                      key={page.slug}
                      to={`${route.path}/${page.slug}`}
                      tone={index % 2 === 0 ? 'blue' : 'accent'}
                      side={index % 2 === 0 ? 'left' : 'right'}
                    >
                      {page.title}
                    </BracketNavLink>
                  ))}
                </div>
              </DocsNoteCard>
            ) : null}
          </aside>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-[var(--space-6)]">
      <DocsHero
        eyebrow={section.title}
        title={section.title}
        summary={section.summary}
        paragraphs={section.intro}
      />

      {contentSection ? (
        <div className="space-y-[var(--panel-gap)]">
          <DocsNoteCard
            label="Section map"
            title="Start with the question in front of you."
            elevation="quiet"
            padding="compact"
            titleSize="nav"
          >
            <PanelBody size="compact" className="max-w-none">
              These pages are a focused thread. Pick the entry point that matches the question, command, or
              integration task you are working through now.
            </PanelBody>
          </DocsNoteCard>

          <div className="grid gap-[var(--panel-gap)] md:grid-cols-2">
            {contentSection.pages.map((page, index) => (
              <DocsCard
                key={page.slug}
                kicker={String(index + 1).padStart(2, '0')}
                title={page.title}
                summary={page.summary}
                href={`${route.path}/${page.slug}`}
                tone={pageTone(page)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {section.modules[0] ? (
        <DocsModulePanel
          truth={section.modules[0].truth}
          title={section.modules[0].title}
          body={section.modules[0].body}
          bullets={section.modules[0].bullets}
          code={section.modules[0].code}
          tone={section.modules[0].truth === 'Roadmap' ? 'accent' : section.tone}
          featured
        />
      ) : null}

      <div className="grid gap-[var(--panel-gap)] xl:grid-cols-2">
        {section.modules.slice(1).map((module, index) => (
          <DocsModulePanel
            key={`${section.slug}-${module.title}`}
            truth={module.truth}
            title={module.title}
            body={module.body}
            bullets={module.bullets}
            code={module.code}
            tone={module.truth === 'Roadmap' ? 'accent' : index % 2 === 0 ? 'paper' : 'blue'}
          />
        ))}
      </div>
    </div>
  )
}
