import {
  CheckCircle,
  Eye,
  GitBranch,
  Handshake,
  Layers,
  Lock,
  Network,
  Scale,
  Shield,
  Terminal,
  type LucideIcon,
} from 'lucide-react'

/**
 * Forbidden version-history phrases. Per project rule: "speak only of the
 * now. do not assume the reader read you before. do not anxiously wave to
 * the future." These phrases are banned in body copy at the **type level**
 * via the `NoForbidden` template literal type below.
 *
 * This replaces the prior runtime substring grep (which violated the
 * user-level `NO KEYWORD-BASED NLP. EVER.` rule). The constraint here is
 * narrow and structural — a closed list of literal strings that cannot
 * appear inside specific string-typed prose fields — not an open-ended
 * keyword classifier. If you find yourself adding fuzzy matches or
 * synonym expansion to this union, you have wandered into the rule's
 * territory and should reach for embeddings or a Haiku classifier instead.
 *
 * `Pre-print` is exempt: it is intentionally allowed inside the `status:`
 * field, which is typed as plain `string` (see `WhitePaper.status`).
 *
 * **CANONICAL PATTERN.** Future keyword bans on data files should follow
 * this approach (template literal type narrowing the field), not a runtime
 * regex. The compile pass is the test.
 */
type ForbiddenPhrase =
  | 'original draft'
  | 'Version 2 closes'
  | 'earlier draft'
  | 'Version~2'
  | 'pre-print' // allowed only inside the `status` field — see WhitePaper.status below

/**
 * Compile-time guard: if `S` contains any `ForbiddenPhrase` as a substring,
 * the type resolves to an explicit error string that `tsc` reports as a
 * type mismatch (the call site expected the literal back, got the error).
 * Otherwise it resolves to `S` unchanged.
 *
 * Only operates on string literal types — that's the whole trick. The
 * `defineWhitePapers` helper below threads literal types through so the
 * checker sees the actual prose.
 */
type NoForbidden<S extends string> =
  S extends `${string}${ForbiddenPhrase}${string}`
    ? '❌ contains forbidden phrase (see ForbiddenPhrase in whitePapers.ts)'
    : S

/**
 * Apply `NoForbidden` to every string leaf in a paper object. Walks
 * properties shallowly, then descends into the known `Array<{...}>` fields
 * (glossary, sections, takeaways) one level deeper. Stops at `status` so
 * the status field can mention "Pre-print" / version language without
 * tripping. Stops at `highlights` because its leaves are `LucideIcon`
 * components, not prose.
 *
 * Why not a generic deep walk: a fully-recursive walk on `T extends object`
 * collides with the `T & {...}` intersection used in `defineWhitePapers`,
 * collapsing the parameter to `never`. Hand-rolling the descent for the
 * known paper shape avoids that and stays explicit about which prose
 * fields are policed.
 */
type ValidateString<S> = S extends string ? NoForbidden<S> : S

// Each element of glossary/sections/takeaways gets its string fields validated.
type ValidateNestedElement<E> = { readonly [K in keyof E]: ValidateString<E[K]> }

// Walk a tuple type, preserving its shape, applying ValidateNestedElement
// to each element. Preserving the tuple shape is necessary because the
// outer `T & ValidatePaper<T>` intersection collapses to `never` if the
// validated form widens `readonly [a, b, c]` to `readonly X[]`.
type ValidateTuple<T> = {
  readonly [I in keyof T]: ValidateNestedElement<T[I]>
}

type ValidatePaper<P> = {
  readonly [K in keyof P]: K extends 'status'
    ? P[K]
    : K extends 'highlights'
      ? P[K] // LucideIcon refs, no prose to police
      : K extends 'glossary' | 'sections' | 'takeaways'
        ? ValidateTuple<P[K]>
        : ValidateString<P[K]>
}

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
  /**
   * The only field permitted to contain version language ("Version 2.5",
   * "Pre-print", etc). Typed as plain `string` so it is exempt from the
   * `NoForbidden` template-literal-type check applied to all other prose.
   */
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

/**
 * A readonly mirror of `WhitePaper` used only as the inference constraint on
 * `defineWhitePapers`. The runtime / consumer-facing type is still
 * `WhitePaper`. We need this because:
 *
 *   - `const T` inference treats array literals as readonly tuples.
 *   - `WhitePaper.glossary` etc. are `Array<...>` (mutable).
 *   - If the constraint is mutable, TS widens the inferred `T[I]` properties
 *     to `string`, and `NoForbidden<string>` is a no-op (it can only narrow
 *     literal types). The forbidden-phrase check would silently pass.
 *
 * `DeepReadonly<WhitePaper>` keeps the inferred `T` literal-typed all the
 * way down so the `ValidateField` walk sees the actual prose.
 */
type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T

/**
 * Helper that enforces `NoForbidden` at the type level on every string leaf
 * (except `status`) of every paper. If any prose contains a forbidden
 * phrase, the call site fails to type-check: the literal-typed argument
 * does not assign to the `ValidateField`-narrowed intersection.
 *
 * The `const` modifier on the type parameter (TS 5.0+) preserves literal
 * types through inference; the parameter is `T & {[I in keyof T]:
 * ValidateField<T[I]>}` so the inferred `T` stays literal while the
 * additional mapped-type intersection enforces the substring constraint.
 *
 * The runtime is a pure identity — all the work happens in `tsc`.
 */
/**
 * The signature uses a two-stage pattern:
 *   1. `const T extends readonly DeepReadonly<WhitePaper>[]` infers `T` as
 *      a literal-typed readonly tuple of the actual papers. The
 *      `DeepReadonly<WhitePaper>` constraint matches the readonly tuple
 *      shape so inference doesn't widen string literals.
 *   2. The parameter is the **intersection** `T & {[I in keyof T]:
 *      ValidatePaper<T[I]>}`. The intersection is reflexive in T (the
 *      argument is structurally T), and TS performs the assignability
 *      check against the second member, where `ValidatePaper` substitutes
 *      forbidden-phrase strings with the explicit error literal. Mismatch
 *      collapses the intersected paper to `never` — the call site then
 *      reports cascading "X is not assignable to never" errors. The error
 *      message is noisier than ideal, but the constraint holds: a
 *      forbidden phrase anywhere in body prose fails compilation.
 *
 *   Trade-off: a more "pointed" error message (`Type "..." is not
 *   assignable to "❌ contains forbidden phrase"`) requires dropping the
 *   intersection and using a `T extends X ? T : never` return-type trick,
 *   which TS happily silently widens. The intersection survives that.
 */
function defineWhitePapers<const T extends readonly DeepReadonly<WhitePaper>[]>(
  papers: T & { readonly [I in keyof T]: ValidatePaper<T[I]> },
): WhitePaper[] {
  return papers as unknown as WhitePaper[]
}

export const WHITE_PAPERS: WhitePaper[] = defineWhitePapers([
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
    pages: 23,
    sizeKb: 805,
    status: 'Version 1.2',
    order: '01',
    primer:
      'Your laptop is — at this exact moment, while you are reading this — running about twenty programs you did not consciously start. Some you wanted (the language model in your editor, the build watcher, that weird Electron app you forgot you installed). Some are vestigial. A small but rapidly growing handful are *autonomous* — little agents your tools spawned to act on your behalf, with the same standing on your machine as you. This is the cryptographic equivalent of giving every guest at a party your house keys because they showed up with the same Uber driver. The Anchor Protocol is the boring, important plumbing that hands each program a guest pass instead — a tiny signed card listing exactly which rooms it may enter, for how long, and from whom. The card is checked at every door. The card cannot be forged. The paper is short because the idea is small; it is more careful than it had to be, because cryptography is one of those domains where 99%-correct is functionally 0%-correct. (We made a machine — ProVerif — check our work. Output in the appendix.)',
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
          'The protocol authenticates and authorizes. It does not isolate processes from each other at the OS level, supervise them, or replace your security policy. We are explicit about that line so the paper does not over-claim.',
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
    pages: 46,
    sizeKb: 902,
    status: 'Version 2.5 (pre-print)',
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
          'The paper gives two answers to "how big should the bond be?" — a closed-form floor (cleanup-cost lower bound times scope multiplier minus reputation discount), and a market: insurer agents bid to underwrite each transaction so the auction discovers the price. Simulation shows when the market beats a flat deposit and when it does not.',
      },
      {
        title: 'Coordination as five separate things',
        content:
          'Treating "all coordination" the same way makes the deposit either too cheap for the dangerous cases or too expensive for the trivial ones. The paper splits it into five categories — broadcast, request-for-help, distress, shared-resource claim, and proposal — each with its own profile. A passing wave costs less than a cry for help, which costs less than locking shared state.',
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
    ],
  },
  {
    id: 'federated-harbor',
    slug: 'federated-harbor',
    title: 'The Federated Harbor',
    subtitle:
      'How two machines run by two different people share one project without one of them being put in charge of the other.',
    thesis:
      'Two daemons, two operators, one staging environment, four o\'clock demo. Inside each laptop the trust story is closed: tokens are signed, evidence is Merkle-chained, bonds are posted. Between the laptops it falls apart — Alice\'s capability card is gibberish to Bob\'s daemon and the bond she posted to cover a botched migration sits in the wrong harbor. This paper draws the federation boundary cleanly: a cross-machine capability transfer ceremony, a witness-logged revocation mesh with a named convergence bound, a settlement protocol whose escrow can refuse but cannot redirect, and an admission ceremony that is invitation-bounded rather than permissionless. Where we prove, we prove. Where we bound, we name the bound. Where we don\'t know, we say so.',
    summary:
      'A guided read of the Federated Harbor paper — why two trustworthy local daemons can still fail jointly, what four small primitives close the gap, and the honest list of open questions the paper does not answer.',
    filename: 'federated-harbor-whitepaper',
    pdfPath: '/whitepaper/federated-harbor-whitepaper.pdf',
    readerHref: '/whitepaper/federated-harbor',
    overviewHref: '/whitepaper?paper=federated-harbor',
    date: 'May 2026',
    pages: 27,
    sizeKb: 710,
    status: 'Version 0.9 (pre-print)',
    order: '03',
    primer:
      'Picture the 4pm demo that motivated this paper. Alice runs the back end on her laptop, Bob runs the front end on his. Each operator has been doing the right things — capability tokens scoped tight, evidence trail kept honest, bond posted against the obvious risk. Inside either laptop the story is airtight. The demo still fails, and it fails in three predictable places: Alice\'s token is gibberish to Bob\'s daemon, Bob\'s revocation gossip never reaches Alice, and the bond Alice posted to cover the botched migration sits in her collateral pool while the migration lands in Bob\'s database. None of these is a bug in either machine. The bug is the assumption that one daemon\'s authority extends past its machine boundary. This paper is the federation surface that closes that assumption — without making either daemon sovereign over the other, without inventing a shared blockchain, and without pretending the open questions are smaller than they are.',
    glossary: [
      {
        term: 'Harbor',
        definition:
          'One operator\'s machine running the Port Daddy daemon. Inside a harbor, the daemon is sovereign — it mints tokens, holds evidence, and enforces policy. Between harbors, no single daemon is in charge. The federation paper draws the line.',
      },
      {
        term: 'Witness log',
        definition:
          'An append-only log to which each harbor publishes its current state root. Any third party can audit any harbor\'s view without trusting the publisher. Borrowed from Certificate Transparency, the system that watches the public web\'s TLS certificates.',
      },
      {
        term: 'Capability transfer',
        definition:
          'The four-message ceremony by which a token issued at harbor A becomes a (more restricted) token usable at harbor B. Neither daemon trusts the other\'s signing key as a root; both agree only on what the witness log says.',
      },
      {
        term: 'Bounded escrow',
        definition:
          'A third party that holds the bond during cross-harbor settlement. Its decision space is exactly two outcomes: pay out, or refuse and return. It cannot redirect funds, cannot equivocate, cannot extract more than a pre-agreed fee. Trusted, but not trustlessly trusted.',
      },
      {
        term: 'Bonded sponsorship',
        definition:
          'How a new harbor joins the federation without prior reputation. An existing harbor posts a bond on the newcomer\'s behalf, forfeit if the newcomer misbehaves during probation. Federation-layer analogue of competitive insurance.',
      },
      {
        term: 'Convergence bound',
        definition:
          'A named upper bound on how long a revocation takes to reach every federated harbor. The paper proves Δ(1 + ln m) where m is the federation size and Δ is the gossip period. The bound is the attacker\'s window, and the bond is sized to cover damage within it.',
      },
    ],
    whatYouGet:
      'You should leave able to (a) explain to a security reviewer why federating two trustworthy local daemons is harder than it looks, and which three things go wrong first; (b) sketch the cross-machine capability transfer on a whiteboard with the epoch-root binding in the right place; (c) name the threat band each protocol claim lives in — mechanized, bounded, or honestly open — and not confuse them. The paper has five named open questions and we treat that as a feature.',
    forBuilders:
      'If you are building infrastructure for two or more organizations to coordinate agent work across an administrative boundary, this paper gives you the four primitives: the transfer ceremony, the federated revocation mesh, the bounded settlement escrow, and the bonded-sponsor admission protocol. Each does exactly one job. Each is honest about what it does not do. The composition is the contribution.',
    highlights: [
      { icon: Network, label: 'Two harbors, no central authority' },
      { icon: GitBranch, label: 'Witness-logged revocation gossip' },
      { icon: Scale, label: 'Bounded escrow, atomic settlement' },
      { icon: Layers, label: 'Layered defense, named threat bands' },
    ],
    sections: [
      {
        title: 'The two-machine problem',
        content:
          'Both daemons are internally consistent. Neither is a root of authority for the other. The bug is structural, not in either machine — and the rest of the paper is the cleanest set of fixes the author could find that does not introduce a blockchain.',
      },
      {
        title: 'The four-element gestalt',
        content:
          'Two harbors, a shared witness log above, a settlement escrow below. Every protocol in the paper attaches to one of these four elements. The diagram is deliberately small.',
      },
      {
        title: 'Capability transfer across the boundary',
        content:
          'A four-message ceremony that produces a card valid at the receiving harbor, signed under the receiving harbor\'s key, with the issuing harbor\'s current epoch root bound into the envelope. No hot-path lookup back to the issuer.',
      },
      {
        title: 'Federated revocation with a named bound',
        content:
          'The cuckoo-filter gossip of the Anchor paper, extended to multi-administrative-domain settings. Expected propagation time across m federated harbors is Δ(1 + ln m). Cross-witness equivocation is detectable in O(log m) audit rounds.',
      },
      {
        title: 'Cross-harbor settlement, structurally bounded',
        content:
          'A bond posted at A clears against damage measured at B through an escrow whose decision space is two outcomes. The escrow cannot redirect funds, cannot equivocate, cannot extract more than a pre-agreed fee. Theorem 6.1 in the paper.',
      },
      {
        title: 'Admission without permissionlessness',
        content:
          'A new harbor joins under a bonded sponsor: an existing harbor underwrites the newcomer\'s probationary risk. The federation is invitation-bounded by design. Sybil attacks at the federation layer cost what honest admission costs.',
      },
      {
        title: 'A worked example and an honest open frontier',
        content:
          'Two organizations, three machines, one real schema migration, a real failure, a real settlement. Then a final section that names five open questions the paper does not answer — including whether trustless settlement is even possible for non-fungible reputation-priced bonds.',
      },
    ],
    takeaways: [
      {
        title: 'Sovereignty does not extend past the machine boundary, and that is fine',
        body: 'Two daemons each fully in charge of their own machines is the right architecture for cross-organization work. The federation paper is the rules of engagement at the boundary — not a new sovereign, not a blockchain, not a hub-and-spoke service. Four small primitives, each doing one job.',
      },
      {
        title: 'Bound the threat instead of trying to eliminate it',
        body: 'The convergence bound on revocation gossip is the attacker\'s window. The structurally bounded escrow is the trusted third party\'s worst-case extraction. The paper is disciplined about pricing the bond against the named bound rather than promising a window of zero. Defense in depth, in the same posture as the prior two papers.',
      },
      {
        title: 'Name the open questions, do not hide them',
        body: 'Three of the most interesting questions in the paper — whether the correlated-equilibrium framing from Bonded survives the multi-principal extension, whether trustless settlement is possible for non-fungible bonds, whether cartels form more easily across federations than within one — are stated as open. They are not throwaway caveats. A federation paper with five named open questions is doing its job.',
      },
    ],
  },
])

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
    title: 'Then the federation layer',
    body: 'Read the Federated Harbor last. The first two papers stay inside one machine. This one is the cross-machine sequel: two daemons, two operators, one shared project, and the rules of engagement at the boundary. The paper is honest that several of its most interesting questions are still open; that posture is the point.',
  },
  {
    step: '04',
    title: 'Then go look at the actual software',
    body: 'All three papers describe a daemon you can install and poke at. After you have read them, the rest of this site stops looking like marketing — sessions, file claims, locks, durable notes, recovery from crashes, and the cross-machine coordination surface in v4 are the moving parts the papers were arguing about. The papers describe the rules; the daemon enforces them.',
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
