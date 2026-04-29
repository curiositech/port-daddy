import {
  CheckCircle,
  Eye,
  Handshake,
  Lock,
  Scale,
  Shield,
  Terminal,
  type LucideIcon,
} from 'lucide-react'

export interface WhitePaper {
  id: string
  slug: string
  title: string
  subtitle: string
  thesis: string
  summary: string
  filename: string
  pdfPath: string
  readerHref: string
  overviewHref: string
  date: string
  pages: number
  sizeKb: number
  status: string
  order: string
  explainerTitle: string
  explainerLead: string
  whyValuable: string
  futureValue: string
  highlights: Array<{ icon: LucideIcon; label: string }>
  sections: Array<{ title: string; content: string }>
  takeaways: Array<{ title: string; body: string }>
}

export const WHITE_PAPERS: WhitePaper[] = [
  {
    id: 'anchor-protocol',
    slug: 'anchor-protocol',
    title: 'The Anchor Protocol',
    subtitle: 'Formal verification for scoped identity and delegated authority',
    thesis:
      'Local agents need identities that survive process churn without turning localhost into a free-for-all. This paper specifies the cryptographic boundary for signed capability tokens and delegation chains.',
    summary:
      'Read the Anchor Protocol paper inline with a guided explanation of scoped identity, delegation, verification, and why it matters for Port Daddy harbors.',
    filename: 'anchor-protocol-whitepaper',
    pdfPath: '/whitepaper/anchor-protocol-whitepaper.pdf',
    readerHref: '/whitepaper/anchor-protocol',
    overviewHref: '/whitepaper?paper=anchor-protocol',
    date: 'March 2026',
    pages: 12,
    sizeKb: 368,
    status: 'Protocol foundation',
    order: '01',
    explainerTitle: 'The paper that makes local authority explicit.',
    explainerLead:
      'Anchor is the identity boundary underneath Port Daddy harbors. It says an agent should be able to prove what it may do locally without inheriting broad ambient power from the process that launched it.',
    whyValuable:
      'The project needs this because a local control plane cannot ask users to trust every spawned process by vibes. Signed cards, scoped capabilities, and attenuated delegation give FleetBar, Shipwright, sorties, and future harbor joins a common language for authority.',
    futureValue:
      'As Port Daddy moves toward richer fleet admission and remote harbor workflows, this paper will become the design contract for who may enter, what authority they carry, and how the daemon can reject forged or over-broad claims before they touch shared work.',
    highlights: [
      { icon: Shield, label: 'ProVerif agreement proof' },
      { icon: Lock, label: 'Rust memory-safety path' },
      { icon: CheckCircle, label: 'Constant-time comparison' },
      { icon: Terminal, label: 'Formal methods appendix' },
    ],
    sections: [
      {
        title: 'Abstract',
        content:
          'Defines the identity layer: signed cards, scoped capabilities, and attenuated delegation that let agents prove what they may do without inheriting broad ambient authority.',
      },
      {
        title: 'Local threat model',
        content:
          'Port squatting, resource contention, replay, and privilege confusion are treated as first-class localhost risks. The protocol separates semantic agent identity from ordinary process identity.',
      },
      {
        title: 'Verification strategy',
        content:
          'Symbolic analysis models authentication and delegation properties, while implementation-level checks focus on memory safety, signature verification, and constant-time comparisons.',
      },
      {
        title: 'Implementation boundary',
        content:
          'The daemon mediates runtime authority. The cryptographic core signs and verifies scoped claims, but it does not pretend to solve host-level isolation, process supervision, or user policy alone.',
      },
    ],
    takeaways: [
      {
        title: 'Authority should be scoped',
        body: 'An agent should not inherit everything its launcher can do. The useful unit is a signed capability with purpose, lifetime, and attenuation.',
      },
      {
        title: 'Localhost is still a trust boundary',
        body: 'The paper treats local ports, processes, and daemon APIs as real attack surfaces, not as harmless developer-machine trivia.',
      },
      {
        title: 'Formal proof is product leverage',
        body: 'Verification is valuable because it lets the UI and daemon make sharper claims about identity instead of marketing around uncertainty.',
      },
    ],
  },
  {
    id: 'bonded-commons',
    slug: 'bonded-commons',
    title: 'The Bonded Commons',
    subtitle: 'Pre-transactional trust infrastructure for multi-agent systems',
    thesis:
      'Coordination fails when every agent has to negotiate trust from scratch. Port Daddy treats trust as shared infrastructure: visible claims, durable attribution, and funded accountability before work begins.',
    summary:
      'Read the Bonded Commons paper inline with a guided explanation of evidence trails, advisory claims, collateralized work, and the future agent economy Port Daddy can support.',
    filename: 'agent-transactions-whitepaper',
    pdfPath: '/whitepaper/agent-transactions-whitepaper.pdf',
    readerHref: '/whitepaper/bonded-commons',
    overviewHref: '/whitepaper?paper=bonded-commons',
    date: 'March 2026',
    pages: 16,
    sizeKb: 400,
    status: 'Mechanism design',
    order: '02',
    explainerTitle: 'The paper that turns coordination into shared infrastructure.',
    explainerLead:
      'Bonded Commons is the governance argument above Anchor. It asks how agents can work together when intent is private, damage can be real, and trust cannot be negotiated from scratch for every handoff.',
    whyValuable:
      'The project needs this because Port Daddy is not only a launcher. Sessions, file claims, locks, notes, activity, handoffs, and salvage already form a commons. This paper explains why those signals should be durable, attributable, and eventually backed by explicit risk and accountability.',
    futureValue:
      'As Port Daddy grows sortie histories, resource governance, budget ceilings, and harbor admission, this paper will guide how future work contracts, evidence trails, and collateral models could make autonomous work legible before anything goes wrong.',
    highlights: [
      { icon: Scale, label: "Sen's impossibility applied" },
      { icon: Handshake, label: 'Collateralized work contracts' },
      { icon: Eye, label: 'Immutable evidence trails' },
      { icon: Terminal, label: 'TLA+ model boundary' },
    ],
    sections: [
      {
        title: 'The trust problem',
        content:
          'Peer-to-peer promises do not scale to autonomous work. The paper frames a commons authority that records intent, scope, evidence, and accountability before coordination turns into conflict.',
      },
      {
        title: 'Three layers',
        content:
          'Capability boundaries prevent broad damage, Merkle-chained attribution makes work inspectable, and collateralized contracts fund accountability without pretending that intent is observable.',
      },
      {
        title: 'Why advisory claims',
        content:
          "Strict allocation can be worse than conflict when private knowledge matters. The control plane should expose truthful coordination signals instead of pretending it can centrally know every agent's best move.",
      },
      {
        title: 'Open problem',
        content:
          'Bond pricing has to make defection expensive without pricing legitimate agents out of the commons. That is a product, economics, and systems-design problem, not a decorative token mechanic.',
      },
    ],
    takeaways: [
      {
        title: 'Trust should be infrastructure',
        body: 'Agents should enter a shared operating envelope where identity, evidence, and accountability are already present.',
      },
      {
        title: 'Advisory claims are deliberate',
        body: 'The paper argues that shared visibility can beat centralized allocation when private context matters to each agent.',
      },
      {
        title: 'Evidence makes recovery credible',
        body: 'Durable trails turn salvage, handoffs, and disputes into inspectable records instead of chat archaeology.',
      },
    ],
  },
]

export const READING_ORDER = [
  {
    step: '01',
    title: 'Protocol boundary',
    body: 'Start with the Anchor Protocol when you need the identity, verification, and delegation argument.',
  },
  {
    step: '02',
    title: 'Commons governance',
    body: 'Move to the Bonded Commons when you need the market and accountability layer above protocol identity.',
  },
  {
    step: '03',
    title: 'Product proof',
    body: 'Compare both papers against the live daemon: sessions, claims, locks, salvage, and operator-visible evidence.',
  },
] as const

export function formatPaperSize(sizeKb: number) {
  return `${sizeKb} KB`
}

export function paperPdfUrl(paper: WhitePaper) {
  return paper.pdfPath
}

export function findWhitePaperById(paperId: string | null) {
  return WHITE_PAPERS.find((paper) => paper.id === paperId)
}

export function findWhitePaperBySlug(slug: string | undefined) {
  return WHITE_PAPERS.find((paper) => paper.slug === slug)
}
