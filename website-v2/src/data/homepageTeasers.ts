import { blogPostMetas } from './blogMetaData'
import { TUTORIALS } from './tutorials'

export type HomepageTeaserKind = 'Article' | 'Guide' | 'Example'
export type HomepageTeaserAccent = 'blue' | 'green' | 'amber'

export interface HomepageTeaser {
  kind: HomepageTeaserKind
  accent: HomepageTeaserAccent
  href: string
  title: string
  summary: string
  imageSrc?: string
  imageWebpSrc?: string
  imageAlt?: string
  eyebrow: string
  meta: string
  proof: string
  featured?: boolean
}

function requireBlogPost(id: string) {
  const post = blogPostMetas.find((item) => item.id === id)

  if (!post) {
    throw new Error(`Missing homepage blog teaser source: ${id}`)
  }

  return post
}

function requireTutorial(slug: string) {
  const tutorial = TUTORIALS.find((item) => item.slug === slug)

  if (!tutorial) {
    throw new Error(`Missing homepage tutorial teaser source: ${slug}`)
  }

  return tutorial
}

const controlPlane = requireBlogPost('control-plane-product')
const pdTubeBlog = requireBlogPost('pd-tube-event-reply-loop')
const multiAgentGuide = requireTutorial('multi-agent')
const primitivesGuide = requireTutorial('primitives')

export const homepageTeaserStats = [
  { value: blogPostMetas.length.toString().padStart(2, '0'), label: 'field notes' },
  { value: TUTORIALS.length.toString().padStart(2, '0'), label: 'guides' },
  { value: '08', label: 'examples' },
] as const

export const homepageTeasers: HomepageTeaser[] = [
  {
    kind: 'Article',
    accent: 'blue',
    href: `/blog/${controlPlane.slug}`,
    title: controlPlane.title,
    summary:
      'The acquisition-grade thesis: agent orchestration becomes valuable when runtime truth, file ownership, readiness, cost, and recovery are one inspectable product surface.',
    imageSrc: controlPlane.heroImage,
    imageAlt: controlPlane.heroAlt,
    eyebrow: 'Product thesis',
    meta: 'Architecture note',
    proof: 'Why the control plane matters',
    featured: true,
  },
  {
    kind: 'Example',
    accent: 'green',
    href: '/examples/pd-tube-button-to-agent',
    title: 'Build a button-to-agent loop with PD Tube',
    summary:
      'A plain local HTML button publishes an event, the terminal agent does the work, and the browser renders the threaded reply.',
    imageSrc: '/img/generated/example-pd-tube-button-to-agent.jpg',
    imageWebpSrc: '/img/generated/example-pd-tube-button-to-agent.webp',
    imageAlt: 'A physical green button connected by a glowing message tube to a local terminal.',
    eyebrow: 'Executable example',
    meta: '18 min',
    proof: 'Browser to live agent',
  },
  {
    kind: 'Guide',
    accent: 'amber',
    href: multiAgentGuide.href,
    title: multiAgentGuide.title,
    summary: multiAgentGuide.description,
    eyebrow: 'Operator guide',
    meta: multiAgentGuide.time,
    proof: 'File claims and notes',
  },
  {
    kind: 'Article',
    accent: 'blue',
    href: `/blog/${pdTubeBlog.slug}`,
    title: pdTubeBlog.title,
    summary: pdTubeBlog.excerpt,
    imageSrc: pdTubeBlog.heroImage,
    imageAlt: pdTubeBlog.heroAlt,
    eyebrow: 'Event loop',
    meta: 'Examples essay',
    proof: 'UI events become work',
  },
  {
    kind: 'Example',
    accent: 'green',
    href: '/examples/test-failure-to-agent',
    title: 'Build a test reporter that asks the agent for help',
    summary:
      'Wrap red test output, publish the failure to the local agent, and print the diagnosis back in the terminal.',
    imageSrc: '/img/generated/example-test-failure-to-agent.jpg',
    imageWebpSrc: '/img/generated/example-test-failure-to-agent.webp',
    imageAlt: 'A red failed-test signal and diagnostic cable feeding a local agent terminal.',
    eyebrow: 'Executable example',
    meta: '20 min',
    proof: 'Tests to diagnosis',
  },
  {
    kind: 'Guide',
    accent: 'amber',
    href: primitivesGuide.href,
    title: primitivesGuide.title,
    summary: primitivesGuide.description,
    eyebrow: 'Product map',
    meta: primitivesGuide.time,
    proof: 'Where each primitive lives',
  },
]
