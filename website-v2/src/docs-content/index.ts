import { getStartedSection } from './getStarted'
import { bestPracticesSection } from './bestPractices'
import { conceptsSection } from './concepts'
import { examplesSection } from './examples'
import { tutorialsSection } from './tutorials'
import { referenceArchitecturesSection } from './referenceArchitectures'
import { referenceSection } from './reference'

export {
  getStartedSection,
  bestPracticesSection,
  conceptsSection,
  examplesSection,
  tutorialsSection,
  referenceArchitecturesSection,
  referenceSection,
}
export type {
  ContentBlock,
  ContentTruth,
  DocsContentPage,
  DocsContentSection,
  SourceReference,
} from './types'

export const docsContentSections = [
  getStartedSection,
  conceptsSection,
  bestPracticesSection,
  examplesSection,
  tutorialsSection,
  referenceArchitecturesSection,
  referenceSection,
]

export function findDocsContentSection(slug: string) {
  return docsContentSections.find((section) => section.slug === slug)
}

export function findDocsContentPage(sectionSlug: string, pageSlug: string) {
  const section = findDocsContentSection(sectionSlug)
  return section?.pages.find((page) => page.slug === pageSlug)
}
