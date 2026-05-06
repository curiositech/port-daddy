export type ContentTruth = 'source-backed' | 'blocked'

export type ContentBlock =
  | {
      type: 'paragraph'
      title?: string
      text?: string
      paragraphs?: string[]
    }
  | {
      type: 'checklist'
      items: string[]
    }
  | {
      type: 'command'
      title: string
      command: string
      notes?: string[]
      output?: string
    }
  | {
      type: 'callout'
      tone: 'info' | 'warning'
      title: string
      body: string
    }

export interface SourceReference {
  path: string
  rationale: string
}

export interface DocsContentPage {
  slug: string
  title: string
  summary: string
  truth: ContentTruth
  goals: string[]
  blocks: ContentBlock[]
  sources: SourceReference[]
}

export interface DocsContentSection {
  slug: string
  title: string
  summary: string
  pages: DocsContentPage[]
}
