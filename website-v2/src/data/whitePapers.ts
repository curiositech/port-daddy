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
    subtitle: 'Formal verification for signed, scoped agent access',
    thesis:
      'Local agents need identities that survive process churn without turning localhost into a free-for-all. This paper specifies signed capability tokens, scoped access, and delegation chains.',
    summary:
      'Read the Anchor Protocol paper inline with a guided explanation of scoped identity, delegation, verification, and why it matters for Port Daddy harbors.',
    filename: 'anchor-protocol-whitepaper',
    pdfPath: '/whitepaper/anchor-protocol-whitepaper.pdf',
    readerHref: '/whitepaper/anchor-protocol',
    overviewHref: '/whitepaper?paper=anchor-protocol',
    date: 'April 2026',
    pages: 17,
    sizeKb: 437,
    status: 'Protocol foundation',
    order: '01',
    explainerTitle: 'The paper that makes local access explicit.',
    explainerLead:
      'Anchor is the identity boundary underneath Port Daddy harbors. It says an agent should be able to prove what it may do locally without inheriting broad ambient power from the process that launched it.',
    whyValuable:
      'The project needs this because a local app cannot ask users to trust every spawned process by vibes. Signed cards, scoped capabilities, attenuated delegation, and now early-revocation give FleetBar, Shipwright, sorties, and future harbor joins a common language for safe access.',
    futureValue:
      'As Port Daddy moves toward richer fleet admission and remote harbor workflows, this paper is the design contract for who may enter, what access they carry, and how the daemon revokes or rejects claims before they touch shared work.',
    highlights: [
      { icon: Shield, label: 'ProVerif agreement proof' },
      { icon: Lock, label: 'Rust memory-safety path' },
      { icon: CheckCircle, label: 'Constant-time comparison' },
      { icon: Terminal, label: 'Cuckoo-filter revocation' },
    ],
    sections: [
      {
        title: 'Abstract',
        content:
          'Defines the identity layer: signed cards, scoped capabilities, and attenuated delegation that let agents prove what they may do without inheriting broad ambient access.',
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
        title: 'Revocation via cuckoo filter',
        content:
          'New in v2: capability tokens can be withdrawn before TTL via a gossiped cuckoo filter. Compromise and policy reversal stop being eventual-only events; revocation reaches every daemon in O(log m) gossip rounds.',
      },
      {
        title: 'Implementation boundary',
        content:
          'The daemon mediates scoped access. The cryptographic core signs and verifies scoped claims, but it does not pretend to solve host-level isolation, process supervision, or user policy alone.',
      },
    ],
    takeaways: [
      {
        title: 'Access should be scoped',
        body: 'An agent should not inherit everything its launcher can do. The useful unit is a signed capability with purpose, lifetime, and attenuation.',
      },
      {
        title: 'Localhost still needs limits',
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
    subtitle: 'Shared accountability for multi-agent systems',
    thesis:
      'Coordination fails when every agent has to negotiate trust from scratch. Port Daddy treats trust as shared product behavior: visible claims, durable attribution, and accountability before work begins.',
    summary:
      'Read the Bonded Commons paper inline with a guided explanation of evidence trails, advisory claims, collateralized work, and the future agent economy Port Daddy can support.',
    filename: 'agent-transactions-whitepaper',
    pdfPath: '/whitepaper/agent-transactions-whitepaper.pdf',
    readerHref: '/whitepaper/bonded-commons',
    overviewHref: '/whitepaper?paper=bonded-commons',
    date: 'April 2026',
    pages: 24,
    sizeKb: 499,
    status: 'Pre-print v2.0',
    order: '02',
    explainerTitle: 'The paper that makes coordination accountable.',
    explainerLead:
      'Bonded Commons sits above Anchor. It asks how agents can work together when intent is private, damage can be real, and trust cannot be negotiated from scratch for every handoff. Version 2 adds the proofs and pricing the original draft promised.',
    whyValuable:
      'The project needs this because Port Daddy is not only a launcher. Sessions, file claims, locks, notes, activity, and salvage already form a commons. This paper explains why those signals should be durable, attributable, and now backed by an operationally checkable conservation invariant and a market-discovered bond price.',
    futureValue:
      'As Port Daddy grows sortie histories, resource controls, budget ceilings, and harbor admission, the v2 expansion gives the foundation: a Merkle forest that survives multi-machine usage, a federated sovereign for keys across devices, and a Bonded Advisor / competitive-insurance market that prices risk instead of guessing it.',
    highlights: [
      { icon: Scale, label: "Sen's impossibility applied" },
      { icon: Handshake, label: 'Bonded advisor + insurance market' },
      { icon: Eye, label: 'Merkle forest with KMS witness' },
      { icon: Terminal, label: 'Conservation theorem (proved)' },
    ],
    sections: [
      {
        title: 'The trust problem',
        content:
          'Peer-to-peer promises do not scale to autonomous work. The paper frames a shared record of intent, scope, evidence, and accountability before coordination turns into conflict.',
      },
      {
        title: 'Three layers, now proved',
        content:
          'Capability boundaries (with revocation) prevent broad damage, the Merkle forest makes work inspectable across daemons, and the conservation theorem turns escrow accounting into a checkable invariant rather than a hopeful claim.',
      },
      {
        title: 'Mutable-signal ledger',
        content:
          'New §4.3: coordination hints can be revoked, renamed, and re-attributed without erasing history. Pheromones get a provenance chain; the substrate stays immutable.',
      },
      {
        title: 'Federated sovereign',
        content:
          'New: passkey-first identity, abstract KMS with five named properties, devices that pair without passwords, and an honest recovery story that does not pretend zero-knowledge is free.',
      },
      {
        title: 'Pricing the bond',
        content:
          "v2 closes part of the original open problem: a cleanup-cost lower bound, a scope multiplier, a reputation discount, the Bonded Advisor pattern, and Thomas Youle's competitive-insurance market in which insurer agents bid to underwrite each transaction.",
      },
      {
        title: 'Coordination as substrate',
        content:
          'Five expressive classes (Signal, Request, Distress, Commons, Proposal) get separate bond profiles. Vibe-time and replay become first-class observability primitives instead of features.',
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
    title: 'Shared accountability',
    body: 'Move to the Bonded Commons when you need the market and accountability layer above signed identity.',
  },
  {
    step: '03',
    title: 'Product proof',
    body: 'Compare both papers against the live daemon: sessions, claims, locks, salvage, and visible evidence.',
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
