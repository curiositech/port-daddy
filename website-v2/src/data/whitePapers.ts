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
  /** Honest list of what this paper does NOT do — read before installing so nothing later feels like a surprise. */
  limitations: Array<{ title: string; body: string }>
}

export const WHITE_PAPERS: WhitePaper[] = [
  {
    id: 'anchor-protocol',
    slug: 'anchor-protocol',
    title: 'The Anchor Protocol',
    subtitle:
      'How one program proves who it is to another — on the same machine, without secrets blowing around in the wind.',
    thesis:
      'When you spawn a script, that script inherits the full powers of you. Fine for code you wrote yesterday; perilous for autonomous agents you barely supervised. This paper specifies a small, embarrassingly classical bit of plumbing — a signed ID card per program, scoped to exactly what that program may do — that turns "trust me, I was launched by Erich" into something a cryptographer would shake hands on.',
    summary:
      'A guided read of the Anchor Protocol paper — what an "identity for a process" should even mean, how to mint one out of off-the-shelf cryptography, and why a problem that felt unsolvable in 2010 is now a long weekend\'s work.',
    filename: 'anchor-protocol-whitepaper',
    pdfPath: '/whitepaper/anchor-protocol-whitepaper.pdf',
    readerHref: '/whitepaper/anchor-protocol',
    overviewHref: '/whitepaper?paper=anchor-protocol',
    date: 'May 2026',
    pages: 22,
    sizeKb: 690,
    status: 'Version 1.2',
    order: '01',
    primer:
      'Your laptop is — at this exact moment, while you are reading this — running about twenty programs you did not consciously start. Some you wanted (the language model in your editor, the build watcher, that weird Electron app you forgot you installed). Some are vestigial. A small but rapidly growing handful are *autonomous* — little agents your tools spawned to act on your behalf, with the same standing on your machine as you. This is the cryptographic equivalent of giving every guest at a party your house keys because they showed up with the same Uber driver. The Anchor Protocol is the boring, important plumbing that hands each program a guest pass instead — a tiny signed card listing exactly which rooms it may enter, for how long, and from whom. The card is checked at every door. The card cannot be forged. The paper is short because the idea is small; it is more careful than it had to be, because cryptography is one of those domains where 99%-correct is functionally 0%-correct. (We made a machine — ProVerif — check our work. Output in the appendix.) Anchor authenticates *who is acting* and refuses unauthorized actions at the boundary; the companion paper, Bonded Commons, prices the *authorized-but-harmful* ones via collateral. Together they are defense-in-depth without OS-level process isolation.',
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
      'You should leave able to (a) explain to your most skeptical coworker why "the user trusts everything this script does" stops being a working model the minute the script can spawn its own scripts, (b) sketch the token-based alternative on a whiteboard with the cryptography in the right places, and (c) recognize three classic attacks by name — algorithm confusion, replay, and over-broad delegation — and know which line of which paragraph defends against each. None of this is novel. The art is in the composition.',
    forBuilders:
      'If you are shipping anything that spawns subprocesses on a user\'s machine — an IDE plugin, an agent runtime, a build orchestrator, a self-updating CLI — this is a working blueprint for the authorization layer you have probably been meaning to write. The cryptographic primitives are standard; you can grab them off NPM. The contribution is the assembly: which check happens where, what the receiver should refuse, what to do when the card is good but the request is suspicious anyway, and how to revoke a card that you handed out two minutes ago.',
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
          'The protocol authenticates and authorizes. It does not isolate processes from each other at the OS level, supervise them, or replace your security policy. What it does NOT prevent — an authorized agent doing harm inside its scope — is exactly what the Bonded Commons paper prices via collateral. The two compose.',
      },
    ],
    takeaways: [
      {
        title: 'A program is not a person',
        body: 'Treating a spawned process as a stand-in for "you" worked fine in 2008. With twenty autonomous helpers a day cycling through your laptop, each of them needs its own much smaller permission set — not because anybody is malicious, but because the per-program blast radius needs to match the per-program competence.',
      },
      {
        title: 'Localhost is a real network',
        body: 'Local ports, sockets, and developer-tool APIs are attack surface, full stop. The paper applies the same hygiene the public internet learned the hard way to the connections inside your own machine. The fact that two programs are talking over `127.0.0.1` is interesting; the fact that one of them came from a `curl | bash` you ran six months ago is the part to be careful about.',
      },
      {
        title: 'Proofs are leverage, not decoration',
        body: 'Putting the protocol through a formal verifier is not a flex — it is what lets the daemon say sharper things to its UI ("this token is valid, scoped to /tmp/build, expires at 5:14pm") instead of vague reassurances. Users notice. Engineers notice when they go to integrate. The math earns its keep at the seams.',
      },
    ],
    limitations: [
      {
        title: 'Does not isolate processes at the OS level',
        body: 'Anchor answers "may this program do that?" — it does not stop a program that has been authorized from misbehaving inside its scope. For that, see the companion Bonded Commons paper (prices authorized-but-harmful actions via collateral) and OS-level sandboxes (seatbelt, gVisor, firejail) when the threat model demands hard containment.',
      },
      {
        title: 'Email-gated recovery is the weakest link',
        body: 'The federated-sovereign recovery path uses single-use email magic-link tokens, formally verified for atomicity. An attacker with email control can trigger that recovery. The paper says this out loud in §"Federated Sovereign." Pair with hardware-key second factors when the threat model demands.',
      },
      {
        title: 'Localhost trust model, not internet-facing',
        body: 'The threat model is "many programs on one developer machine." A public-internet identity service has different requirements (DDoS, cross-organization revocation gossip, regulatory KYC). Anchor borrows from that body of work but does not solve it.',
      },
    ],
  },
  {
    id: 'bonded-commons',
    slug: 'bonded-commons',
    title: 'The Bonded Commons',
    subtitle:
      'How a group of independent programs can share a workspace without one of them being put in charge.',
    thesis:
      'Two agents can negotiate. Twenty cannot. The expensive-and-broken solutions are to lock every drawer or to trust everyone equally. This paper proposes a third thing: agents announce what they are about to do, leave durable evidence of what they actually did, and post a small refundable deposit against making a mess. The deposit, the announcements, and the evidence together do the job a central manager would do — and they do it without a manager.',
    summary:
      'A guided read of the Bonded Commons paper: why mutual visibility beats locks once you have more than a handful of agents, what kind of refundable "deposit" makes that visibility honest instead of theatrical, and how a tiny insurance market beats any single human picking the deposit size by hand.',
    filename: 'agent-transactions-whitepaper',
    pdfPath: '/whitepaper/agent-transactions-whitepaper.pdf',
    readerHref: '/whitepaper/bonded-commons',
    overviewHref: '/whitepaper?paper=bonded-commons',
    date: 'May 2026',
    pages: 37,
    sizeKb: 862,
    status: 'Pre-print',
    order: '02',
    primer:
      'Picture four roommates sharing a kitchen. There are two tempting solutions and they are both bad. The first is to put a lock on every drawer (slow, miserable, ruins dinner). The second is to trust everyone implicitly to never take the last egg or leave the pan in the sink (fragile, scales poorly, ends in tears). The thing that actually works in real shared kitchens — and has worked for as long as humans have shared kitchens — is the boring third option: a chore wheel on the fridge, receipts kept where everybody can see them, and a small communal kitty that pays for breakage when it happens. Elinor Ostrom won a Nobel Prize for noticing that this same pattern is how fisheries and pastures avoid the *tragedy of the commons*. We are transplanting it into the directory where your autonomous programs work. Each agent posts a small refundable deposit (the *bond*), announces what it is about to do (the *commons*), and leaves a tamper-evident record of what actually happened (the *ledger*). Clean work, the deposit comes back. Mess, the deposit pays for the cleanup. The clever part is not the deposit — that is just escrow. The clever part is that you do not need a judge.',
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
      'You should leave with: (a) a real intuition for why locking-everything starts to feel claustrophobic the second you have more than two agents in the same directory, (b) a feel for how a refundable deposit changes an agent\'s incentives without anybody needing to play judge, (c) a working sketch of a system where each participant leaves evidence anybody can verify later (Git already half-does this; we finish the half), and (d) — the part most authors leave out — an honest map of where this design stops being right. Small teams, low-stakes scratch work, environments with one trusted operator: stick with the lock. The mechanism only earns its keep when the agents are many, the consequences are real, and nobody has the standing to be in charge.',
    forBuilders:
      'If you are building infrastructure for multiple agents to collaborate on shared state — or multiple humans, frankly; the design does not care — this paper gives you the contracts you actually need: who announces what before they touch anything, where the evidence has to live so it cannot be quietly retconned, how a participant returns from a crash without you losing what they were doing, and (the whole back half of the paper) how to price the deposit so the buyer and seller both come out ahead. The pricing section was contributed by an actual economist. We made him write down his assumptions.',
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
      {
        title: 'Why allocation cannot be enforced',
        content:
          'A short detour through Sen\'s Impossibility of a Paretian Liberal. With private agent preferences, any authority that tries to enforce who gets what is provably suboptimal. The daemon\'s role is therefore to publish shared information and let agents decide — claims are advisory, not binding. The argument is the load-bearing reason the daemon does not act like a kernel.',
      },
      {
        title: 'Crash recovery as social continuation',
        content:
          'Agents die. The paper treats death as routine and asks: what does the successor inherit? Float Plans, bonded scope, and the Merkle-chained evidence trail combine so the next agent picks up with full provenance — including the deposit, the lock state, and the vibe-time replay buffer. The metaphor is shift change at a hospital, not a process restart.',
      },
      {
        title: 'A worked example, end-to-end',
        content:
          'The appendix runs one agent through every layer in sequence: identity issuance, Float Plan, bond posting, work, partial crash, salvage, settlement. Three swimlanes, twenty-four-hour timeline. It is the fastest way to see how the parts compose without reading the formal model first.',
      },
    ],
    takeaways: [
      {
        title: 'Trust is cheaper as infrastructure than as negotiation',
        body: 'If the visibility, the evidence, and the deposit are baked into the substrate, a new agent can show up and start working without first establishing a personal relationship with every other agent in the room. This is exactly the dynamic that lets you walk into a hardware store you have never visited before and buy a hammer with a credit card. The infrastructure does the negotiating, ahead of time, in bulk.',
      },
      {
        title: 'Visibility is not surveillance',
        body: 'The paper holds an important line: what an agent *announces* it is about to do is shared. What an agent is *privately thinking* is not. Coordination is legible; the agent\'s private context, plan, and reasoning stay the agent\'s own. (This is why the system feels less like a panopticon and more like a hardware store.)',
      },
      {
        title: 'Evidence makes recovery from failure boring',
        body: 'When an agent dies mid-task — and they will — the next one inherits a precise record of what was done and what is left. Today this is achieved through chat archaeology and a hopeful re-run; in the world this paper describes, it is the routine. Boring is the goal. Boring is what scales.',
      },
      {
        title: 'Insurer collusion is unprofitable above a closed-form threshold',
        body: 'The cartel folk-theorem subsection derives a detection probability p_d* such that for any p_d above it, the discounted future stream of cooperative profits exceeds the one-shot gain from undercutting. Simulated to convergence over the parameter space. This is the most original quantitative result in the paper, and the answer to the natural question "what stops the insurers from collectively raising premiums?"',
      },
    ],
    limitations: [
      {
        title: 'Competitive insurance needs a thick market',
        body: 'The §"Pricing the deposit" market mechanism Pareto-dominates static parameters only when the market is mature: enough insurers to support price discovery, enough reputation history to calibrate discounts. In cold-start, the paper falls back to the closed-form floor and graduated task access. The path from cold-start to thick market is named explicitly — it is not free.',
      },
      {
        title: 'New agents pay the highest premiums',
        body: 'Reputation-adjusted bonds reward agents with clean history. The flip side: an unknown agent posts a higher deposit for the same work. This is the correct economic signal (information about an unproven actor is genuinely missing) but it can feel like an onboarding tax. The paper acknowledges it; production deployments typically subsidize the first cohort.',
      },
      {
        title: 'Does not authenticate the binary, only the principal',
        body: 'A bonded agent running a poisoned plugin is still bonded — but the bond signs the action, not the code. Supply-chain provenance for the agent binary itself is out of scope here. The threat model is misbehavior by the principal, not by code the principal trusted in good faith.',
      },
      {
        title: 'Advisory, not enforced — by design',
        body: 'The Sen\'s-theorem detour proves that enforced allocation with private agent preferences is provably suboptimal. So the daemon publishes information and lets agents decide. This is a deliberate choice that some operators expect to be "kernel-like" hard enforcement. It is not. If your threat model needs hard isolation, pair this with OS-level sandboxing.',
      },
    ],
  },
]

export const READING_ORDER = [
  {
    step: '01',
    title: 'Start with identity',
    body: 'Read the Anchor Protocol first — it is the shorter and more classical of the two. It pins down what it means for one local program to prove who it is to another, and everything in the second paper quietly assumes you can do that. (Skip the appendix on the first pass; come back when you want the proofs.)',
  },
  {
    step: '02',
    title: 'Then the harder one',
    body: 'Read the Bonded Commons next. Anchor handles "who is this program;" Bonded Commons handles the question that gets harder every year: how do several of those programs share the same project without anyone being put in charge of anyone else? This is the paper with the kitchen analogy and Elinor Ostrom showing up.',
  },
  {
    step: '03',
    title: 'Then go look at the actual software',
    body: 'Both papers describe a daemon you can install and poke at. After you have read them, the rest of this site stops looking like marketing — sessions, file claims, locks, durable notes, and recovery from crashes are the moving parts the papers were arguing about. The papers describe the rules; the daemon enforces them.',
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
