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
  /** A one-paragraph welcome that defines the central idea in plain language. */
  primer: string
  /** A short list of terms the rest of the page assumes. Each term is defined for someone meeting it for the first time. */
  glossary: Array<{ term: string; definition: string }>
  /** What the reader can do with the ideas in this paper, written for the reader, not for the project. */
  whatYouGet: string
  /** A pragmatic example. "If you build X, this paper tells you Y." */
  forBuilders: string
  highlights: Array<{ icon: LucideIcon; label: string }>
  sections: Array<{ title: string; content: string }>
  takeaways: Array<{ title: string; body: string }>
}

export const WHITE_PAPERS: WhitePaper[] = [
  {
    id: 'anchor-protocol',
    slug: 'anchor-protocol',
    title: 'The Anchor Protocol',
    subtitle: 'A way for one program to prove who it is to another, on the same machine, without secrets in the wind',
    thesis:
      'When you spawn a script, that script inherits everything you can do. That is fine for trusted code; it is dangerous for autonomous agents. This paper specifies a small system that lets each agent carry a signed "ID card" listing exactly what it is allowed to do — and that lets the program receiving a request verify the card without phoning home.',
    summary:
      'A guided read of the Anchor Protocol paper: what an "identity for a process" should mean, how to make one with off-the-shelf cryptography, and why this is now solvable on a laptop.',
    filename: 'anchor-protocol-whitepaper',
    pdfPath: '/whitepaper/anchor-protocol-whitepaper.pdf',
    readerHref: '/whitepaper/anchor-protocol',
    overviewHref: '/whitepaper?paper=anchor-protocol',
    date: 'May 2026',
    pages: 18,
    sizeKb: 442,
    status: 'Version 1.2',
    order: '01',
    primer:
      'A laptop today happily runs dozens of background programs spawned by IDEs, language models, and developer tools. Most of them inherit the full power of whoever launched them — your shell, your network, your filesystem. The Anchor Protocol is a small piece of plumbing that gives each one a tiny ID card instead. The card lists what the program may do (read this folder, call this port, talk to this peer), how long the card is valid, and is signed so it cannot be forged. The receiving program checks the signature and the scope, and refuses anything outside it. That is the whole idea. The paper exists because doing this correctly is full of subtle traps, and we wanted to write down a version that holds up to formal scrutiny.',
    glossary: [
      {
        term: 'Capability',
        definition:
          'A specific permission slip. Instead of "this program is trusted," capabilities say "this program may read /tmp/build.log, until 5pm, and nothing else."',
      },
      {
        term: 'Signed token',
        definition:
          'A short string of bytes whose contents are tamper-proof: anyone with the public key can check that nobody altered it after the issuer signed it. We use Ed25519, a modern signature scheme that is fast, small, and standard.',
      },
      {
        term: 'Delegation',
        definition:
          'When one program hands a sub-permission to another. If A is allowed to read /tmp/a and /tmp/b, A can mint a token that lets B read only /tmp/a. The new token cannot grow back: B cannot use it to also touch /tmp/b. We call this "attenuation."',
      },
      {
        term: 'Revocation',
        definition:
          'Cancelling a card before its expiry — the equivalent of telling the front desk that a hotel keycard was stolen. We use a small data structure called a cuckoo filter, gossiped between machines, so that withdrawn cards stop working within a couple of minutes everywhere.',
      },
      {
        term: 'Formal verification (ProVerif)',
        definition:
          'A way to mathematically check a protocol design against an attacker who controls every wire on your network. ProVerif is an academic tool used to verify TLS 1.3, Signal, and WireGuard. We modeled the protocol in it and pasted the resulting proofs into the paper.',
      },
    ],
    whatYouGet:
      'After this paper you should be able to (1) explain why "the user trusts everything this script does" is a fragile model for autonomous agents, (2) sketch a token-based alternative on a whiteboard, (3) recognize three classic attacks the design defends against — algorithm confusion, replay, and over-broad delegation — and know what defends against each.',
    forBuilders:
      "If you are building a tool that spawns subprocesses (an IDE plugin, an agent runtime, a build orchestrator), this paper is a working blueprint for putting a real authorization layer between them. The cryptography is standard; the contribution is the assembly: which check to do where, and what the receiving program should refuse.",
    highlights: [
      { icon: Shield, label: 'Verified in ProVerif' },
      { icon: Lock, label: 'Standard Ed25519 signatures' },
      { icon: CheckCircle, label: 'Constant-time verification' },
      { icon: Terminal, label: 'Withdraw a card in seconds' },
    ],
    sections: [
      {
        title: 'What problem this solves',
        content:
          'A modern developer machine runs many short-lived programs that talk to each other through localhost. Today those programs are trusted by virtue of having been launched by you. The paper argues that is no longer enough.',
      },
      {
        title: 'Threats this takes seriously',
        content:
          'Another program racing yours to bind a port; a stale token replayed an hour later; a sub-program asking the daemon for more than its parent gave it. The paper enumerates these and what stops each one.',
      },
      {
        title: 'How we know it is correct',
        content:
          'The protocol is modeled in ProVerif, an automated verifier for security protocols. The verifier reports whether the properties (authentication, secrecy, replay-freedom) hold against an attacker who controls every message. They hold. The verifier output is reproduced in the appendix.',
      },
      {
        title: 'Withdrawing a card before it expires',
        content:
          'If a card leaks, you should be able to cancel it without restarting the world. The paper describes a small data structure (a cuckoo filter) that machines gossip between themselves so that a revoked card stops working everywhere within a couple of gossip rounds.',
      },
      {
        title: 'Where this stops',
        content:
          'The protocol authenticates and authorizes. It does not isolate processes from each other at the OS level, supervise them, or replace your security policy. We are explicit about that line so the paper does not over-claim.',
      },
    ],
    takeaways: [
      {
        title: 'A program is not a person',
        body: 'Treating a spawned process as if it were "you" worked when there were three of them. With dozens of autonomous helpers running on a laptop, each one needs its own much smaller permission set.',
      },
      {
        title: 'Localhost is a real network',
        body: 'Local ports, sockets, and developer-tool APIs are attack surface. The paper applies the same hygiene we use for the public internet to the connections inside your machine.',
      },
      {
        title: 'Proofs are useful, not decorative',
        body: 'Mathematically checking the design lets the running daemon make sharper claims to its UI ("this token is valid, scoped to X, expires at Y") instead of vague reassurances. Users notice the difference.',
      },
    ],
  },
  {
    id: 'bonded-commons',
    slug: 'bonded-commons',
    title: 'The Bonded Commons',
    subtitle: 'How a group of independent programs can share a workspace without stepping on each other',
    thesis:
      'When several agents work on the same project, the cheap solution is to lock everything; the cheap-but-broken solution is to trust everyone. This paper proposes a third option: agents announce what they are about to do, leave durable evidence of what they did, and post a small bond against making a mess. The bond, the announcements, and the evidence together replace a central authority.',
    summary:
      'A guided read of the Bonded Commons paper: why mutual visibility beats locks for agent coordination, what kind of "deposit" makes that visibility honest, and how to price the deposit fairly.',
    filename: 'agent-transactions-whitepaper',
    pdfPath: '/whitepaper/agent-transactions-whitepaper.pdf',
    readerHref: '/whitepaper/bonded-commons',
    overviewHref: '/whitepaper?paper=bonded-commons',
    date: 'May 2026',
    pages: 26,
    sizeKb: 510,
    status: 'Version 2.5 (pre-print)',
    order: '02',
    primer:
      'Imagine four people sharing a kitchen. They could put a lock on every drawer (slow, miserable), or trust nobody to take the last egg (fragile, ends in tears). The third option is the one that actually works in shared kitchens: a chore wheel on the fridge, receipts for groceries, and a small kitty everyone chips into for breakage. That is the design pattern we transplant to autonomous programs sharing a project. Each agent posts a small deposit (the bond), announces what it is about to do (the commons), and leaves an unforgeable record of what actually happened (the ledger). If the agent makes a mess, the deposit pays for the cleanup. If it does good work, the deposit comes back, plus a tiny reputation gain. Most of the paper is about doing this honestly: how to make the announcements visible without leaking the agent\'s private plan, how to size the deposit so it actually deters bad behavior, and how to recover when an agent simply dies mid-task.',
    glossary: [
      {
        term: 'Commons',
        definition:
          'In economics, a shared resource — pasture, fishery, codebase — that everyone benefits from and nobody owns. Elinor Ostrom won the 2009 Nobel for showing how real communities govern commons without a central authority. We apply her design principles to a developer\'s project directory.',
      },
      {
        term: 'Bond / Bonded',
        definition:
          'A refundable deposit. Agents post one before starting work; if the work is clean, they get it back; if it leaves damage, the deposit pays for repair. "Bonded" is the adjective: a bonded commons is one where bonds back the trust.',
      },
      {
        term: 'Conservation invariant',
        definition:
          'A formal accounting rule: the total money in the system never changes by surprise. Mathematically equivalent to "you cannot create or destroy escrowed value, only move it." We proved this rule holds in TLA+, a specification language used at AWS and Microsoft for distributed systems.',
      },
      {
        term: 'Merkle tree / forest',
        definition:
          'A way of stacking hashes so that a tiny "fingerprint" at the top is changed by any modification anywhere below. Used by Git, Bitcoin, and Certificate Transparency. We use one to make the workspace\'s history tamper-evident across machines.',
      },
      {
        term: 'Competitive insurance',
        definition:
          'Instead of an authority picking one fixed deposit size for everyone, multiple insurers bid to underwrite each transaction. The market discovers the right price. This idea was contributed by economist Thomas Youle.',
      },
      {
        term: 'Vibe time',
        definition:
          'Our shorthand for "what was the agent thinking when it acted?" — the local context, files in view, errors seen. Captured for replay so failures can be reproduced. Less mystical than the name suggests.',
      },
    ],
    whatYouGet:
      'After this paper you should be able to (1) describe why locks scale poorly for autonomous coordination, (2) explain how a posted bond changes an agent\'s incentive without needing a judge to step in, (3) sketch a system where agents leave evidence of their work that anyone can verify later, and (4) recognize where this design stops being right — small teams, low-stakes work, or environments where one trusted operator is faster.',
    forBuilders:
      'If you are building infrastructure for multiple agents (or multiple humans! — the design is identical) to collaborate on shared state, this paper gives you a working set of contracts: who announces what, where the evidence lives, how to recover from a crashed participant, and how to price the participation deposit so neither side gets cheated.',
    highlights: [
      { icon: Scale, label: 'Conservation invariant proven (TLA+)' },
      { icon: Handshake, label: 'Market-priced participation bonds' },
      { icon: Eye, label: 'Tamper-evident workspace history' },
      { icon: Terminal, label: 'Honest recovery from agent crashes' },
    ],
    sections: [
      {
        title: 'Why peer-to-peer trust does not scale',
        content:
          'Two agents can negotiate. Twenty cannot. The paper opens with the failure mode every "ask the agents to coordinate among themselves" design eventually hits, and uses it to motivate shared infrastructure instead of one-on-one promises.',
      },
      {
        title: 'Three pieces, each independently useful',
        content:
          'Permission boundaries from the Anchor Protocol prevent broad damage; a tamper-evident history (Merkle tree) lets work be inspected after the fact; a deposit-and-refund accounting rule (Conservation) makes the bond mathematically honest. Each piece works alone; together they form the system.',
      },
      {
        title: 'Editable signals without rewritten history',
        content:
          'Coordination hints — "I am working on file X," "this lock is mine until 4pm" — sometimes need to be cancelled or reassigned. The paper explains how to do that in a way that updates the live state without erasing the audit trail. The metaphor: a notice board where notices can be marked superseded but not unposted.',
      },
      {
        title: 'Who holds your keys, when several machines hold them',
        content:
          'Identity needs to survive a laptop dying. The paper specifies an abstract key-management service with five honest properties (no zero-knowledge magic), a passkey-first device pairing flow, and a recovery story that does not pretend to be free.',
      },
      {
        title: 'Pricing the deposit',
        content:
          'The original draft left "how big should the bond be?" open. Version 2 closes part of it with a method (cleanup-cost lower bound times scope multiplier minus reputation discount), then proposes a market: insurers bid to underwrite each transaction, and the auction discovers the price. We show by simulation when this beats a fixed deposit and when it does not.',
      },
      {
        title: 'Coordination as five separate things',
        content:
          'Treating "all coordination" the same way makes the deposit either too cheap for the dangerous cases or too expensive for the trivial ones. The paper splits it into five categories — broadcast, request-for-help, distress, shared-resource claim, and proposal — each with its own profile. A passing wave costs less than a cry for help, which costs less than locking shared state.',
      },
    ],
    takeaways: [
      {
        title: 'Trust is cheaper as infrastructure than as a negotiation',
        body: 'Building the visibility, the evidence, and the deposit into the substrate means new agents can start working without first establishing a relationship with every other agent.',
      },
      {
        title: 'Visibility is not surveillance',
        body: 'The paper distinguishes "what an agent announces it is about to do" from "what an agent is privately thinking." Only the first is shared. The design protects private context while making coordination legible.',
      },
      {
        title: 'Evidence makes recovery from failure boring',
        body: 'When an agent dies mid-task, the next one inherits a precise record of what was done and what is left. Today this is achieved through chat archaeology and prayer; the paper makes it routine.',
      },
    ],
  },
]

export const READING_ORDER = [
  {
    step: '01',
    title: 'Start with identity',
    body: 'Read the Anchor Protocol first. It defines what it means for one local program to prove who it is to another. Everything in the second paper assumes you can do that.',
  },
  {
    step: '02',
    title: 'Then read coordination',
    body: 'Read the Bonded Commons next. It builds on Anchor and asks the harder question: how do several of these programs share a workspace without one of them being put in charge?',
  },
  {
    step: '03',
    title: 'Compare against running software',
    body: 'Both papers describe a real running daemon. The website tour shows the same ideas as moving parts you can install and inspect: signed sessions, file claims, locks, durable notes, and recovery from crashes.',
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
