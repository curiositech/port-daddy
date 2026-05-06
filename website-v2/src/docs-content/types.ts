export type ContentTruth = 'source-backed' | 'blocked'

export interface InlineLink {
  label: string
  href: string
}

export interface PrimitiveFamily {
  family: string
  question: string
  summary: string
  tone: 'ink' | 'blue' | 'green' | 'amber' | 'red'
  links: InlineLink[]
}

export interface PrimitiveLayer {
  layer: string
  encodes: string
  reason: string
  links: InlineLink[]
  example: {
    command: string
    output: string
  }
}

export interface PrimitiveChoice {
  need: string
  use: InlineLink[]
  avoid: string
}

export interface PrimitiveCitationGroup {
  title: string
  summary: string
  websiteDocs: InlineLink[]
  runtimeCode: InlineLink[]
  skillDossiers: InlineLink[]
}

export interface PrimitiveMapContent {
  eyebrow: string
  title: string
  deck: string
  thesis: string
  operatorQuestions: string[]
  families: PrimitiveFamily[]
  layers: PrimitiveLayer[]
  choices: PrimitiveChoice[]
  citations: PrimitiveCitationGroup[]
  skillTrail: InlineLink[]
}

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
  variant?: 'primitive-map'
  primitiveMap?: PrimitiveMapContent
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
