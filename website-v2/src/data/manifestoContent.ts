// The manifesto is authored as a single markdown document under docs/ and
// imported here verbatim. Keeping a thin metadata layer next to the raw import
// mirrors the blogData.ts pattern so the page can render through the same
// .blog-article typography pipeline used by every other long-form surface.
import manifestoMarkdown from '../../../docs/manifesto-why-agent-economies.md?raw'

export interface ManifestoMeta {
  /** H1 / page title, also used for <title> and OG. */
  title: string
  /** Dek shown under the title — the italic standfirst from the document. */
  subtitle: string
  eyebrow: string
  readingTime: string
}

export const manifestoMeta: ManifestoMeta = {
  title: 'A Profit Incentive for Solving Anything',
  subtitle:
    'Software learned to hire its own help. Here is what happens next, why a harbor has to come first, and the seven papers that work it out.',
  eyebrow: 'Manifesto',
  readingTime: '8 min read',
}

/**
 * The raw markdown, with the leading H1 and the italic standfirst paragraph
 * stripped — both are rendered by the page hero instead of inside the prose
 * column, so we avoid duplicating them. The trailing `---` rule that precedes
 * the footnotes is preserved (it visually separates body from citations).
 */
export const manifestoContent: string = (() => {
  let md = manifestoMarkdown
  // Drop the first H1 line.
  md = md.replace(/^#\s+.+\n/, '')
  // Drop the leading italic standfirst paragraph (a single *...* block) and the
  // first horizontal rule that follows it — the hero owns both.
  md = md.replace(/^\s*\*[\s\S]*?\*\s*\n+/, '')
  md = md.replace(/^\s*---\s*\n+/, '')
  return md.trimStart()
})()

/**
 * Figure captions, keyed by image filename. The markdown alt text doubles as
 * the accessible description (it reads like the drawing's contents, which is
 * correct for `alt`), but a caption should tell the reader what the figure
 * *means* in the argument — not restate the prompt. The page renders these as
 * the visible <figcaption> and keeps the long alt text on the <img> for AT.
 */
export const manifestoCaptions: Record<string, string> = {
  '/img/manifesto/hero-harbor.webp':
    'The fix is structural, not behavioural: give every agent its own berth and one office that hands them out.',
  '/img/manifesto/collision.webp':
    'The lost-write collision. Two agents read the same file, both save, the second erases the first — and the result still looks finished.',
  '/img/manifesto/legibility-zoom.webp':
    'Legibility is one picture you can zoom into: a calm summary up top, the exact change, test, and line one click down.',
  '/img/manifesto/seven-papers.webp':
    'Seven papers: four explain the system in prose, three hand the safety claims to a proof-checker.',
}

/**
 * The harbor-evolution figure — one drawing, three stages, in the site's flat
 * blueprint house style. Shared between the manifesto and the library so the
 * I → II → III arc reads the same wherever a reader meets it. The caption
 * re-states the three stages in words so the figure does not have to be decoded
 * from the roman numerals alone.
 */
export const harborEvolutionFigure = {
  src: '/img/generated/manifesto/trilogy-arc.webp',
  alt: 'A blueprint-style line drawing in three stages connected by a rising arrow. Stage I: a single small hut on pilings. Stage II: a taller house on pilings beside a dockside crane, one machine doing its own loading. Stage III: a full shipyard and harbor with many berths, cranes, and ships.',
  stages: [
    { numeral: 'I', label: 'A single process on one machine — one hut, one job, no one to coordinate with.' },
    { numeral: 'II', label: 'A single machine coordinating its own work — one house, its own crane, keeping its own logbook.' },
    { numeral: 'III', label: 'A harbor coordinating many machines and agents — many berths, one office that hands them out.' },
  ],
  caption:
    'One process → one machine → many machines. The same arc the three papers climb, drawn once: a hut becomes a house with its own crane becomes a harbor that gives every ship a berth.',
} as const

/**
 * The olog / functor figure plus the plain-language gloss the manifesto needs
 * next to it. Authored here so the prose around the image stays legible to a
 * reader who has never met category theory.
 */
export const ologFunctorFigure = {
  src: '/img/generated/manifesto/functor-transport.webp',
  alt: 'A folded protein on the left and a crystal lattice on the right, joined by threads of light that run from points on one structure to matching points on the other — a structure-preserving map carrying relationships across, not just objects.',
  caption:
    'A functor in one picture: the threads do not connect a protein to a crystal at random — they carry the relationships, so what holds on the left already holds on the right.',
  explainer: [
    'An olog — short for ontology log — is a labeled diagram of the concepts in some domain and the structure-preserving relationships between them. A protein, a supply chain, a legal argument: each one can be written as an olog, where the boxes are the ideas and the arrows are how they relate.',
    'A functor is a structure-preserving map from one olog to another. It does not merely pair up boxes; it carries the arrows — the relationships — so the shape of one domain lands intact inside the other. That is the difference between a loose metaphor and a transport you can check.',
    'That is why it matters here: Port Daddy moves a coordination structure faithfully across contexts — one machine, then many — the way a functor carries a domain across without dropping the relationships that made it work.',
  ],
} as const

// ─── Concept sections (the "technology we sell") ────────────────────────────
// These are designed React sections on the page, not markdown. They surface
// the actual primitives, the one mechanism-design theorem we take seriously,
// and the seven papers as a navigable grid.

export interface PrimitiveSpec {
  name: string
  /** The single sentence that says what it does. Verb-first. */
  does: string
  /** The command/idiom that exercises it. Shown in mono. */
  command: string
  /** Repo-relative source path — credibility marker. */
  source: string
  docHref?: string
}

/** What you actually install. Each row is a real primitive with a real command. */
export const technologyPrimitives: PrimitiveSpec[] = [
  {
    name: 'Single-writer claims',
    does: 'An agent announces it holds a file, so a second one sees the claim and can wait instead of silently stomping the first.',
    command: 'pd session files add src/auth.ts',
    source: 'lib/claims.ts',
    docHref: '/docs/concepts/claim-tree',
  },
  {
    name: 'Semantic ports',
    does: 'A name like myapp:api:main hashes to the same port every time, so two services never fight over one.',
    command: 'pd claim myapp:api:main -q',
    source: 'lib/ports.ts',
    docHref: '/docs/features/ports',
  },
  {
    name: 'Sessions + salvage',
    does: 'Every task is a session with notes and a heartbeat. When an agent dies, its work waits in the salvage queue.',
    command: 'pd salvage claim <id>',
    source: 'lib/sugar.ts',
    docHref: '/docs/features/salvage',
  },
  {
    name: 'The Arbiter',
    does: 'A capability boundary an agent cannot cross: no private keys, no saved logins, no spending past a cap you set.',
    command: 'pd guard install --mode enforce',
    source: 'lib/arbiter.ts',
    docHref: '/docs/features/arbiter',
  },
  {
    name: 'Signed identity (relay PKI)',
    does: 'An agent proves who it is across machines with no one to vouch for it — the basis for a reputation that travels.',
    command: 'pd relay enroll',
    source: 'lib/relay-pki.ts',
    docHref: '/docs/features/relay-pki',
  },
  {
    name: 'pd tube',
    does: 'One event-and-reply bus the whole fleet talks over, fail-closed, so steering a running agent is a message, not a restart.',
    command: 'pd tube pub fleet.steer "<directive>"',
    source: 'lib/tube-spawner-router.ts',
    docHref: '/docs/cli/tube',
  },
]

// ─── The seven papers ───────────────────────────────────────────────────────
// The set, as the operator frames it: keep all seven; honor and differentiate.
//   • FOUR ride the PRODUCT LAYERS — the L0→L3 stack, machine up to market.
//   • THREE are CRYPTO DEEP DIVES — proof-checked, each underwriting a layer.
// The three deep dives are shipped (real PDFs + reader pages in whitePapers.ts);
// we surface their real content in-line. The four layer papers each declare the
// rung they sit on so the page reads as one ladder, not a flat list.

export interface LayerPaperSpec {
  title: string
  /** Which product-layer rung this paper sits on. */
  layer: 'L0' | 'L1' | 'L2' | 'L3'
  /** The rung's one-word job, e.g. "Daemon", "Legibility". */
  layerName: string
  /** Who the rung is for — the machine, the agents, the operator, the market. */
  forWhom: string
  blurb: string
}

export interface CryptoPaperSpec {
  title: string
  /** Slug into WHITE_PAPERS — drives the in-line card + links + real content. */
  paperId: string
  /** The proof-checker(s). */
  checker: string
  /** Which layer this proof underwrites. */
  underwrites: 'L0' | 'L1' | 'L2' | 'L3'
  blurb: string
}

/** Four papers, one per product layer — the L0→L3 ladder, machine up to market. */
export const layerPapers: LayerPaperSpec[] = [
  {
    title: 'The Single-Writer Kernel',
    layer: 'L0',
    layerName: 'Daemon',
    forWhom: 'the machine',
    blurb: 'The small, stubborn program at the bottom that decides what is true — who holds what, who is alive, what really happened — so nothing above it has to guess.',
  },
  {
    title: 'The Coordination Protocol',
    layer: 'L1',
    layerName: 'Agent OS',
    forWhom: 'the agents',
    blurb: 'The rules of the road: a typed conversation with commitments, delegation, and the Arbiter — how agents talk without colliding.',
  },
  {
    title: 'The Legible Swarm',
    layer: 'L2',
    layerName: 'Legibility',
    forWhom: 'the operator',
    blurb: 'How a swarm becomes one picture you can zoom into — and why that, not raw speed, is the single-player product worth paying for today.',
  },
  {
    title: 'The Harbor Economy',
    layer: 'L3',
    layerName: 'Market',
    forWhom: 'the market between operators',
    blurb: 'From spawn to person to a reputation worth trading: renting trust between strangers, with money that cannot be quietly stolen in the exchange.',
  },
]

/** Three crypto deep dives — shipped, proof-checked, surfaced in-line from real data. */
export const cryptoPapers: CryptoPaperSpec[] = [
  {
    title: 'The Anchor Protocol',
    paperId: 'anchor-protocol',
    checker: 'ProVerif + Kani',
    underwrites: 'L0',
    blurb: 'Proves an agent can prove who it is, and exactly what it may do, with no one to vouch for it.',
  },
  {
    title: 'The Bonded Commons',
    paperId: 'bonded-commons',
    checker: 'Kani',
    underwrites: 'L3',
    blurb: 'Proves value cannot be conjured or vanished in a settlement — the bond ledger conserves.',
  },
  {
    title: 'The Federated Harbor',
    paperId: 'federated-harbor',
    checker: 'ProVerif',
    underwrites: 'L3',
    blurb: 'Proves trust can cross between machines that do not trust each other, and a deposit held in the middle cannot be stolen.',
  },
]
