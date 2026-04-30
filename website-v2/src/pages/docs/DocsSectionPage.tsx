import { Navigate, useLocation, useParams } from 'react-router-dom'
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
} from '@/components/site/primitives'
import { findDocsFamily, findDocsRouteBySlug } from '@/data/publicSite'
import { findDocsContentPage, findDocsContentSection } from '@/docs-content'
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
    case 'callout':
      return block.tone === 'warning' ? 'Blocked or caution' : 'Note'
  }
}

function blockHeading(block: ContentBlock, index: number) {
  switch (block.type) {
    case 'paragraph':
      return block.title ?? `Overview ${String(index + 1).padStart(2, '0')}`
    case 'checklist':
      return `Checklist ${String(index + 1).padStart(2, '0')}`
    case 'command':
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

function renderContentBlock(block: ContentBlock, index: number) {
  const label = blockLabel(block)

  switch (block.type) {
    case 'paragraph': {
      const paragraphs = paragraphSet(block)
      return (
        <div
          key={`paragraph-${index}`}
          className="space-y-[var(--panel-gap)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]"
        >
          <BracketLabel>{label}</BracketLabel>
          <PanelTitle as="h2" size="nav" className="max-w-none">
            {blockHeading(block, index)}
          </PanelTitle>
          <div className="space-y-[var(--panel-gap-tight)]">
            {paragraphs.map((paragraph) => (
              <PanelBody key={paragraph} className="max-w-[58rem]">
                {paragraph}
              </PanelBody>
            ))}
          </div>
        </div>
      )
    }
    case 'checklist':
      return (
        <DocsNoteCard key={`checklist-${index}`} label={label} title={blockHeading(block, index)}>
          <PanelList items={block.items} className="border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)]" />
        </DocsNoteCard>
      )
    case 'command':
      return (
        <DocsNoteCard key={`command-${index}`} label={label} title={block.title} tone="blue">
          <DocsCodeBlock code={block.command} output={block.output} language="cli" label={block.title} />
          {block.notes?.length ? <PanelList items={block.notes} tone="primary" /> : null}
        </DocsNoteCard>
      )
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
            {block.body}
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

  if (contentSection && contentPage) {
    return (
      <div className="space-y-[var(--space-6)]">
        <DocsHero
          eyebrow={section.title}
          title={contentPage.title}
          summary={contentPage.summary}
          paragraphs={leadParagraphBlock ? paragraphSet(leadParagraphBlock) : []}
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
