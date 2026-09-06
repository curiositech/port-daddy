import {
  docsFamilyRoutes,
  docsOverviewRoute,
  type DocsFamilyRoute,
  findDocsRouteByPath,
  findDocsRouteBySlug,
} from './docs-routes'

export type TruthState = 'Live' | 'Roadmap'

export type AccentTone = 'paper' | 'blue' | 'accent'

export interface DocModule {
  truth: TruthState
  title: string
  body?: string[]
  bullets?: string[]
  code?: string
}

export type PublicDocFamily = DocsFamilyRoute

export interface ProofPanel {
  id: string
  tool: string
  subtitle: string
  command: string
  output: string[]
  result: string
  checks: Array<{ label: string; value: string }>
}

export interface CommercialTrack {
  id: string
  name: string
  subtitle: string
  description: string
  tone: AccentTone
  badge: string
  bullets: string[]
}

export const heroInstall = {
  label: 'Install',
  command: 'brew install curiositech/tap/port-daddy && pd setup',
  note: '',
}

export const heroSellingPoints = [
  'Keep shared notes, locks, sessions, harbors, and recovery state in one local service.',
  'Replace invisible shell state with a dashboard and CLI that show what agents are doing.',
  'Use the whitepaper when you need the deeper security model behind signed harbor access.',
] as const

export const proofPanels: ProofPanel[] = [
  {
    id: '01',
    tool: 'ProVerif',
    subtitle: 'Protocol analysis',
    command: 'proverif analyses/harbor_card_v3_delegation.pv',
    output: [
      'Unbounded-session symbolic analysis',
      'Injective agreement checked',
      'Delegation attenuation preserved',
      'Forgery and replay traces exhausted',
    ],
    result: 'Protocol claims modeled against an active adversary, not asserted by hand.',
    checks: [
      { label: 'Authentication', value: 'checked' },
      { label: 'Delegation', value: 'checked' },
      { label: 'Algorithm pinning', value: 'checked' },
    ],
  },
  {
    id: '02',
    tool: 'Kani',
    subtitle: 'Rust model checking',
    command: 'cargo kani --harness proof_verify_logic_only',
    output: [
      'Adversarial token parsing explored',
      'No-panic properties checked within the harness bound',
      'Malformed input paths bounded',
      'Constant-time comparison harnesses included',
    ],
    result: 'The deployed Rust core is treated like production software, not a paper appendix.',
    checks: [
      { label: 'Memory safety', value: 'checked' },
      { label: 'Panic freedom', value: 'checked' },
      { label: 'Verifier logic', value: 'bounded' },
    ],
  },
] as const

export const proofStats = [
  { value: 'Ed25519', label: 'active harbor issuance', tone: 'paper' as const },
  { value: 'Explicit', label: 'legacy HS256 path', tone: 'blue' as const },
  { value: 'Open core', label: 'runtime business model', tone: 'accent' as const },
] as const

export const architectureNarrative = [
  {
    label: 'Agent layer',
    text: 'Agents execute tasks. They are not trusted to own shared coordination state by themselves.',
  },
  {
    label: 'Local service',
    text: 'The daemon stores identity, locks, sessions, harbors, and the shared state that keeps multi-agent work visible.',
  },
  {
    label: 'Verified core',
    text: 'The cryptographic core sits underneath the daemon and supports signed, scoped harbor access.',
  },
] as const

export const commercialTracks: CommercialTrack[] = [
  {
    id: '01',
    name: 'Open Core',
    subtitle: 'Local daemon + verified runtime',
    description:
      'Install the daemon locally, coordinate agent work, and keep the core security model transparent. This is the adoption path.',
    tone: 'blue',
    badge: 'Free',
    bullets: [
      'Daemon, CLI, and core coordination primitives',
      'Local sessions, locks, notes, and harbor flows',
      'Verification-backed security story',
    ],
  },
  {
    id: '02',
    name: 'Team Coordination',
    subtitle: 'Shared visibility',
    description:
      'The commercial layer is about visibility, policy, and shared operations for teams running agent workflows together.',
    tone: 'paper',
    badge: 'Teams',
    bullets: [
      'Fleet history and cross-machine visibility',
      'Violation context, telemetry, and reviewable evidence',
      'A shared dashboard built for more than one laptop',
    ],
  },
  {
    id: '03',
    name: 'Enterprise Controls',
    subtitle: 'Audit, key custody, and policy',
    description:
      'For organizations with compliance, security, or procurement pressure, the value is stronger control, stronger custody, and better evidence.',
    tone: 'accent',
    badge: 'Enterprise',
    bullets: [
      'Audit export and policy enforcement',
      'Hardware-backed key management options',
      'Commercial support around serious agent operations',
    ],
  },
] as const

function cloneDocFamily(route: DocsFamilyRoute): PublicDocFamily {
  return {
    ...route,
    intro: [...route.intro],
    modules: route.modules.map((module) => ({
      truth: module.truth,
      title: module.title,
      body: module.body ? [...module.body] : undefined,
      bullets: module.bullets ? [...module.bullets] : undefined,
      code: module.code,
    })),
  }
}

export const docsRouteFamilies = [docsOverviewRoute, ...docsFamilyRoutes] as const

const docsHomepageOrder = [
  'get-started',
  'concepts',
  'best-practices',
  'tutorials',
  'reference-architectures',
  'reference',
] as const

export const docsFamilies = docsHomepageOrder
  .map((slug) => findDocsRouteBySlug(slug))
  .filter((route): route is DocsFamilyRoute => Boolean(route))
  .map(cloneDocFamily)

export const docsSidebarFamilies = docsFamilies

export const docsHomepageFamilies = docsFamilies

export function findDocsFamily(slug: string) {
  const route = findDocsRouteBySlug(slug)
  if (!route || route.slug === 'overview') {
    return undefined
  }
  return cloneDocFamily(route)
}

export { findDocsRouteByPath, findDocsRouteBySlug }
