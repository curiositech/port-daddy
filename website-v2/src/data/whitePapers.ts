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
   * Library chapter number as a Roman numeral (I–VII). The seven papers are
   * co-equal cross-referenced chapters of one book: four that *explain* the
   * system (I–IV) and three that *prove* it (V–VII).
   */
  chapter: string
  /** Which half of the library this chapter belongs to. */
  group: 'explain' | 'prove'
  /** The stack rung this chapter sits on, in plain words (e.g. "L2 — legibility"). */
  layer: string
  /** A one-line claim: what this chapter argues or proves, in a single sentence. */
  claim: string
  /**
   * Engineering / proof maturity, on the series' neutral scale. `built` /
   * `built-weak` / `designed` / `specified` for the explaining chapters; the
   * proving chapters carry the verifier they were mechanized in.
   */
  maturity: string
  /**
   * Cross-reference edges that make the seven read as one book. Each is a list
   * of chapter Roman numerals with a short reason — rendered as
   * assumes / underwrites / proved-by / proves links on the library page.
   */
  crossRefs: {
    assumes?: Array<{ chapter: string; why: string }>
    underwrites?: Array<{ chapter: string; why: string }>
    provedBy?: Array<{ chapter: string; why: string }>
    proves?: Array<{ chapter: string; why: string }>
  }
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
    id: 'legible-swarm',
    slug: 'legible-swarm',
    title: 'The Legible Swarm',
    subtitle:
      'Why the operator\'s real problem is not collision but blindness — and how a swarm becomes one picture you can zoom into, never a wall of diffs.',
    thesis:
      'A swarm of autonomous coding agents, left to coordinate itself, is Hobbes’ state of nature: rational, even well-meaning actors fall into a war of all against all. The operator rationally consents to a local authority for exactly Hobbes’ reason — the alternative is worse — and that authority governs the only way any sovereign governs a population it cannot personally inspect: by making the swarm legible. The binding constraint on scale is read-poverty, not write-contention; tokens are at once the cost-of-goods and the legibility engine; and authority needs a first-class, scoped, revocable consent primitive with an inalienable operator override.',
    summary:
      'A guided read of the series’ flagship: legibility-with-zoom as the product a solo developer pays for today, the read-poverty bottleneck that decides the next order of magnitude, and an attention queue using Signal Detection Theory as an explicit decision objective rather than a universal fitted detector.',
    filename: 'legible-swarm-whitepaper',
    pdfPath: '/whitepaper/legible-swarm-whitepaper.pdf',
    readerHref: '/whitepaper/legible-swarm',
    overviewHref: '/whitepaper?paper=legible-swarm',
    date: 'August 2026',
    pages: 39,
    sizeKb: 746,
    status: 'Version 1.1 (revised pre-print)',
    order: '01',
    chapter: 'I',
    group: 'explain',
    layer: 'L2 — legibility & authority',
    claim:
      'The operator’s real problem is blindness, not collision; the cure is legibility-with-zoom — every summary a lens onto a verifiable artifact, never a wall.',
    maturity: 'the wedge · mostly built',
    crossRefs: {
      assumes: [{ chapter: 'II', why: 'stands on the single-writer kernel that decides what is true' }],
      underwrites: [
        { chapter: 'III', why: 'hands the identity bridge a legible, checkpointed, outcome-bearing identity' },
        { chapter: 'IV', why: 'legibility is the precondition for a market between operators' },
      ],
    },
    primer:
      'Open one coding agent and it is useful. Open ten on a real codebase and you meet the problem this whole library is about: two agents edit the same file and the second silently erases the first; one “fixes” the tests by deleting them; you come back to a pile of changes and cannot tell what happened. More agents made you less sure, not more. The thesis of this chapter is that the operator’s real problem is not collision — the write side (claims, locks, anomaly detection) is solved — but blindness: you cannot see the whole swarm at once, and a wall of diffs is not seeing. The cure is legibility-with-zoom: the swarm rendered as one picture you can zoom into, where every summary is a lens onto the real artifact and never a replacement for it. The chapter takes James C. Scott’s warning seriously — a map flattened too far destroys the local knowledge that made the place work — and turns it into a buildable rule.',
    glossary: [
      {
        term: 'Read-poverty',
        definition:
          'The binding constraint on swarm scale. The write side — claiming files, holding locks, catching anomalies — is solved. The read side — finding the right agent, the relevant work, the trustworthy collaborator — is where the next order of magnitude is won or lost.',
      },
      {
        term: 'Legibility-with-zoom (digest-with-zoom)',
        definition:
          'Every summary is a lens you look through to the underlying verifiable artifact, never a wall you bump into. The digest is compaction; you can always zoom from the summary to the real thing.',
      },
      {
        term: 'Mêtis',
        definition:
          'James C. Scott’s term for the local, hard-to-codify practical knowledge a system actually runs on. Over-legibility — flattening the map too far — destroys it. The design’s job is to be legible without crushing mêtis.',
      },
      {
        term: 'Signal Detection Theory (SDT)',
        definition:
          'The framework the attention queue is spined on. The operator’s scarce resource is attention, not throughput; SDT lets the system trade false alarms against misses deliberately rather than drown the operator in noise.',
      },
      {
        term: 'Consent primitive',
        definition:
          'A first-class, scoped, revocable grant of authority with an inalienable operator override. Authority over a swarm is not a vibe; it is a typed object you can inspect, narrow, and revoke.',
      },
    ],
    whatYouGet:
      'You should leave able to (a) explain why ten agents on one repo make an operator less sure rather than more, and why that is a read problem not a write problem; (b) sketch the digest-with-zoom loop and say exactly where the “zoom to the real artifact” affordance lives; and (c) argue why the right objective for the operator’s console is attention under Signal Detection Theory, not raw task throughput.',
    forBuilders:
      'If you are building a console, dashboard, or review surface over many agents, this chapter is the argument for what it should optimize: never a wall of diffs, always a zoomable picture; the read path treated as the scaling bottleneck; and an attention queue that decides what reaches the human by false-alarm/miss trade-offs you set on purpose.',
    highlights: [
      { icon: Eye, label: 'Legibility-with-zoom, not a wall of diffs' },
      { icon: Layers, label: 'Read-poverty is the real bottleneck' },
      { icon: Scale, label: 'Attention queue spined on SDT' },
      { icon: Shield, label: 'Scoped, revocable consent with operator override' },
    ],
    sections: [
      {
        title: 'The swarm as a state of nature',
        content:
          'Left to coordinate itself, a swarm of agents falls into Hobbes’ war of all against all. The operator consents to a local authority because the alternative is worse — the same reason Hobbes gives for the sovereign.',
      },
      {
        title: 'Legibility, and its hazard',
        content:
          'A sovereign governs a population it cannot inspect by making it legible. The hazard is over-legibility — Scott’s warning that flattening the map crushes mêtis. The rule that resolves it: digest-with-zoom.',
      },
      {
        title: 'Read-poverty, not write-contention',
        content:
          'The write side is solved. The next order of magnitude is won on the read side: finding the right agent, the relevant work, the trustworthy collaborator. The chapter proves a legibility lower bound and distinguishes the two rankers a swarm needs.',
      },
      {
        title: 'Tokens are the legibility engine',
        content:
          'Tokens are the swarm’s cost-of-goods-sold and its compaction mechanism at once — so the cost question and the legibility question are one question.',
      },
      {
        title: 'Authority and attention',
        content:
          'A scoped, revocable consent primitive with an inalienable operator override, and an operator-attention objective spined on Signal Detection Theory rather than throughput.',
      },
    ],
    takeaways: [
      {
        title: 'Blindness is the product gap',
        body: 'The thing a solo developer pays for today is not another agent; it is the ability to see the ten they already have as one coherent picture they can trust.',
      },
      {
        title: 'Every summary is a lens',
        body: 'A digest that you cannot zoom from is a wall. The whole discipline of the system is that you can always get from the summary back to the verifiable artifact.',
      },
      {
        title: 'Hand the next chapter a real identity',
        body: 'Legibility, checkpoints, and outcome records are the raw material the identity bridge (III) turns into reputation. The flagship’s job is to make that material exist and be trustworthy.',
      },
    ],
  },
  {
    id: 'single-writer-kernel',
    slug: 'single-writer-kernel',
    title: 'The Single-Writer Kernel',
    subtitle:
      'The small, stubborn program at the bottom that decides what is true — one writer, one machine, one durable file, no distributed consensus.',
    thesis:
      'A swarm sharing one machine collides over the same scarce things: ports, files, locks, and the record of who did what. The instinct, trained on a decade of distributed-systems literature, is to reach for consensus. We make the opposite move: collapse the whole problem onto a single writer over a single local SQLite database in write-ahead-log mode, and let the operating system’s file lock serialize every mutation. There is one decider, so there is no agreement to reach. The kernel is a single-writer transactional reference monitor in the sense of Anderson and Lampson — and it is honest about exactly where its promises stop.',
    summary:
      'A guided read of the substrate chapter: why a single writer beats consensus on one machine, the kernel’s invariants stated as theorems, and a careful split of durability by fault class — survives a process crash, does not promise to survive a power cut.',
    filename: 'single-writer-kernel-whitepaper',
    pdfPath: '/whitepaper/single-writer-kernel-whitepaper.pdf',
    readerHref: '/whitepaper/single-writer-kernel',
    overviewHref: '/whitepaper?paper=single-writer-kernel',
    date: 'August 2026',
    pages: 37,
    sizeKb: 732,
    status: 'Version 1.1 (revised pre-print)',
    order: '02',
    chapter: 'II',
    group: 'explain',
    layer: 'L0 / L1 — the daemon & the protocol',
    claim:
      'One writer, one machine, one durable file, no consensus: the kernel decides what is true so nothing above it has to guess — and it is honest about where it stops.',
    maturity: 'built (durability split by fault class)',
    crossRefs: {
      underwrites: [
        { chapter: 'I', why: 'the legibility layer reads truth the kernel decides' },
        { chapter: 'III', why: 'continuity and checkpoints persist on the kernel’s durable file' },
        { chapter: 'IV', why: 'the bond ledger settles on the kernel’s transactional substrate' },
      ],
      provedBy: [{ chapter: 'V', why: 'the Anchor Protocol mechanizes the kernel’s identity & capability claims' }],
    },
    primer:
      'Many programs on one laptop want the same scarce things at the same time: a network port, a file on disk, a mutual-exclusion lock, and — most subtly — the record of who did what. The textbook reflex, after a decade of distributed-systems papers, is to replicate the state and run an agreement protocol so the copies never disagree. This chapter argues the opposite and argues it is correct: if there is exactly one writer, there is nothing to agree on. Collapse the whole problem onto a single local SQLite database in write-ahead-log mode and let the operating system’s file lock serialize every mutation. The result is a small, tamper-evident mediator of every security-relevant operation — a reference monitor in the classical sense — realized locally rather than as an abstract security kernel. The chapter’s discipline is to state the kernel’s guarantees as theorems and to be just as precise about where those guarantees end.',
    glossary: [
      {
        term: 'Single-writer kernel',
        definition:
          'One process is the only thing that writes to the source of truth. Because there is one decider, there is no consensus to run — the OS file lock serializes mutations and the database is always self-consistent.',
      },
      {
        term: 'Reference monitor',
        definition:
          'Anderson and Lampson’s idea: a small, tamper-evident mediator that every security-relevant operation must pass through. The kernel is a local, transactional realization of it rather than an abstract security kernel.',
      },
      {
        term: 'WAL (write-ahead log)',
        definition:
          'A SQLite mode where changes are first written to a log and then folded into the database. It gives concurrent readers and a single writer good behavior — and it is the source of the chapter’s honest durability caveat.',
      },
      {
        term: 'Durability split by fault class',
        definition:
          'A write that returns success survives a process crash, but is not guaranteed against power loss under the default WAL configuration. The chapter refuses to blur these two fault classes into one vague “durable.”',
      },
      {
        term: 'Detector vs. regimenter',
        definition:
          'The policy monitor is a post-commit detector, not a pre-commit regimenter. The chapter corrects a widespread over-claim: the only genuine pre-commit enforcement comes from a uniqueness constraint and a boot-time admission gate.',
      },
    ],
    whatYouGet:
      'You should leave able to (a) explain why a single writer on one machine is the right call and consensus is the wrong reflex; (b) name the kernel’s invariants — mutual exclusion, idempotence, serializable transactions, and a linearizable claim history under the stated one-daemon/no-bypass conditions — and what each buys; and (c) state exactly where the promises stop (process crash yes, power cut no; post-commit detector, not pre-commit regimenter).',
    forBuilders:
      'If you are building local coordination infrastructure for many processes, this chapter is the blueprint for the substrate: collapse to one writer, lean on the OS lock, make every mutation idempotent, and be ruthlessly honest about your durability and enforcement boundaries instead of selling a vague “ACID, distributed, bulletproof.”',
    highlights: [
      { icon: Lock, label: 'One writer, no consensus' },
      { icon: Shield, label: 'Transactional reference monitor' },
      { icon: CheckCircle, label: 'Invariants stated as theorems' },
      { icon: Terminal, label: 'Honest durability split by fault class' },
    ],
    sections: [
      {
        title: 'The wrong reflex: consensus',
        content:
          'Replicate-and-agree is the trained answer to shared mutable state. On one machine it is solving a problem you do not have. Collapse to a single writer instead.',
      },
      {
        title: 'The kernel as reference monitor',
        content:
          'A small, tamper-evident mediator of every security-relevant operation, realized locally over SQLite in WAL mode, with the OS file lock as the serializer.',
      },
      {
        title: 'Invariants, as theorems',
        content:
          'Mutual exclusion, idempotence, and a serializable consistency model with a linearizable claim history under explicit one-daemon, connection, transaction, and no-bypass assumptions — each stated and argued, not asserted.',
      },
      {
        title: 'Where the promises stop',
        content:
          'Durability is split by fault class: success survives a process crash but is not guaranteed against power loss under default WAL. The chapter says so in the same words throughout.',
      },
      {
        title: 'Detector, not regimenter',
        content:
          'The policy monitor catches violations after commit; it does not prevent them before. The only genuine pre-commit enforcement is a uniqueness constraint plus a boot-time admission gate.',
      },
    ],
    takeaways: [
      {
        title: 'One decider dissolves the hard part',
        body: 'Most of the difficulty in coordinating shared state is the agreement protocol. Remove the need to agree and the remaining problem is small, local, and tractable.',
      },
      {
        title: 'Honesty about limits is a feature',
        body: 'The kernel is solid where it is local and provisional exactly where a cross-machine economy would need it to become cryptographic and continuous — and it says which is which, every time.',
      },
      {
        title: 'It is the floor everything else stands on',
        body: 'Legibility (I), continuity (III), and the bond ledger (IV) all read and write through this kernel. Its identity and capability claims are mechanized in the Anchor Protocol (V).',
      },
    ],
  },
  {
    id: 'spawn-to-person',
    slug: 'spawn-to-person',
    title: 'From Spawn to Person',
    subtitle:
      'The hinge of the library: continuity — memory, a checkpoint, a witnessed record — turns an anonymous spawn into a person with a track record, the raw material of reputation.',
    thesis:
      'A swarm produces work, but until that work can be attributed to something that survives the process that did it, none of it can be priced. A role is a bundle of obligation, capability, and authority — an org-chart entry any spawn can fill. A person is a role instance plus continuity: durable memory, a restorable checkpoint, and a witnessed history of outcomes keyed on an identity that cannot be freely re-picked. From this comes the series’ central economic claim, stated identically across the papers: the reputation estimator is cheap; the substrate it scores over — witnessed outcomes on a non-forgeable identity — is the gate.',
    summary:
      'A guided read of the bridge chapter: the role-vs-person distinction made load-bearing, why reputation is not a bandit problem, a multi-dimensional reputation scored by neutral conflict-free judges, and the honest naming of cross-operator attestation as the unbuilt keystone.',
    filename: 'spawn-to-person-whitepaper',
    pdfPath: '/whitepaper/spawn-to-person-whitepaper.pdf',
    readerHref: '/whitepaper/spawn-to-person',
    overviewHref: '/whitepaper?paper=spawn-to-person',
    date: 'August 2026',
    pages: 34,
    sizeKb: 618,
    status: 'Version 1.3 (series-aligned edition)',
    order: '03',
    chapter: 'III',
    group: 'explain',
    layer: 'L3 bridge — identity into reputation',
    claim:
      'A role is a job description; a person is a role plus continuity. Reputation is only as real as the non-forgeable identity it keys on — the score is cheap, the substrate is the gate.',
    maturity: 'partial · identity root local; cross-operator keystone unbuilt',
    crossRefs: {
      assumes: [
        { chapter: 'I', why: 'borrows legibility — outcomes must be visible to be witnessed' },
        { chapter: 'V', why: 'depends on the Anchor Protocol’s non-forgeable identity as its keystone' },
      ],
      underwrites: [{ chapter: 'IV', why: 'reputation is the thing the market prices and trades' }],
    },
    primer:
      'Spawn a process, let it do good work, and then ask: whose work was that? If the answer is “the process that has since exited,” the work cannot be priced, trusted across time, or built into a track record. This chapter is the hinge of the library because it draws one distinction and makes it carry weight. A role — “cartographer,” “reviewer” — is a bundle of obligations, capabilities, and authority; any spawn can step into it. A person is a role plus continuity: durable memory, a checkpoint you can restore, and a witnessed history of outcomes attached to an identity that cannot be quietly re-picked. Continuity is what turns disposable computation into someone with a reputation. Following Locke’s memory criterion and Parfit’s psychological continuity, identity here is that continuity, not a fixed essence. And the chapter is blunt about the economics: the clever scoring math is cheap; the expensive, load-bearing part is the substrate it scores over.',
    glossary: [
      {
        term: 'Role',
        definition:
          'A bundle of {obligation, capability, authority} — an org-chart entry. Any spawn can fill a role. A role alone has no track record.',
      },
      {
        term: 'Person',
        definition:
          'A role instance plus continuity: durable memory, a restorable checkpoint, and a witnessed history of outcomes keyed on an identity that cannot be freely re-picked.',
      },
      {
        term: 'Continuity (Locke / Parfit)',
        definition:
          'Identity as psychological/memory continuity rather than a fixed essence. The philosophical grounding for why a checkpointed, memory-bearing agent is “the same someone” across time.',
      },
      {
        term: 'Multi-dimensional reputation',
        definition:
          'Quality is not one number. Accuracy, aesthetics, and efficiency are separate axes, each judged by a different neutral evaluator with no stake in the answer — the harbor’s “universities and rating agencies.”',
      },
      {
        term: 'Cross-operator attestation',
        definition:
          'Binding identities across operators who do not trust each other. The chapter depends only on a local non-forgeable identity and names this cross-operator step as the unbuilt keystone the market half waits on — a dependency, not an assumption.',
      },
    ],
    whatYouGet:
      'You should leave able to (a) say crisply why a spawn is not a person and why only the person can carry a reputation; (b) explain why reputation is not a bandit problem — non-stationarity, multi-dimensionality, strategic adversaries, and the grading oracle’s own incentives; and (c) state the keystone honestly: a local non-forgeable identity holds today, cross-operator attestation does not, and the difference is exactly where the market’s trust gap lives.',
    forBuilders:
      'If you are building reputation or trust scoring for agents, this chapter is the warning and the blueprint: do not pour effort into the estimator; pour it into the substrate — durable memory, restorable checkpoints, witnessed outcomes, and an identity that cannot be re-rolled. Score multiple axes with neutral judges, and be honest that cross-operator identity is the unsolved part.',
    highlights: [
      { icon: GitBranch, label: 'Role vs. person, made load-bearing' },
      { icon: Eye, label: 'Witnessed outcomes on a non-forgeable id' },
      { icon: Scale, label: 'Multi-axis reputation, neutral judges' },
      { icon: Shield, label: 'Cross-operator attestation named as the keystone' },
    ],
    sections: [
      {
        title: 'The through-line',
        content:
          'memory → checkpoint → continuity → a person, not a spawn → witnessed outcomes → reputation → a tradeable asset. This chapter carries the chain from the single-operator tool to the cross-operator market.',
      },
      {
        title: 'Role vs. person',
        content:
          'A role is fillable by any spawn; a person is a role plus continuity. The distinction is the whole hinge: only a person accrues a record worth pricing.',
      },
      {
        title: 'The score is cheap; the substrate is the gate',
        content:
          'Elo, Bradley–Terry, EigenTrust are inexpensive. The expensive part is witnessed outcomes on an identity that cannot be forged. Stated identically across the series.',
      },
      {
        title: 'Why reputation is not a bandit problem',
        content:
          'Non-stationarity, multi-dimensionality, strategic adversaries, and the grading oracle’s own incentive-compatibility put it well outside the clean bandit setting.',
      },
      {
        title: 'The keystone, named honestly',
        content:
          'A local non-forgeable identity holds within one trusted operator. Cross-operator attestation — the binding across operators who do not trust each other — is handed to the market chapter as a named, unbuilt dependency.',
      },
    ],
    takeaways: [
      {
        title: 'Continuity is what makes someone',
        body: 'Without memory, a checkpoint, and a witnessed record, an agent is a fresh stranger every run. Continuity is the difference between a tool and a worker you can build a relationship with.',
      },
      {
        title: 'Don’t gold-plate the estimator',
        body: 'The math that turns outcomes into a number is the cheap part. If the outcomes are not witnessed and the identity is forgeable, no estimator saves you.',
      },
      {
        title: 'Name the unbuilt keystone',
        body: 'Cross-operator attestation is the highest-leverage thing still missing. The chapter treats it as a dependency the market waits on, not a detail to wave away.',
      },
    ],
  },
  {
    id: 'harbor-economy',
    slug: 'harbor-economy',
    title: 'The Harbor Economy',
    subtitle:
      'Where it all arrives: a three-sided market — labor, rentable agents, licensed skills — settling on one conserving bond ledger through explicitly trusted, conditionally restricted custody.',
    thesis:
      'The first three chapters build a harbor for a single operator. This one is the rung above all of them — the only one whose participants are plural and mutually distrusting. The harbor economy is a three-sided market: operators sell labor and fleet-for-hire; agents and fleets are rentable assets; skills and tools are licensed — all settling on one conserving bond ledger via float-plan escrow. The chapter carries the series’ hardest boundary conditions honestly: cross-operator attestation is not shipped; conservation composes additively within one unit of account while cross-currency settlement needs time-indexed valuation, fee, slippage, and exposure accounts; and Myerson–Satterthwaite constrains only bilateral slices satisfying its private-information assumptions. The defensible product is hosted trust, not the commoditized payment rail.',
    summary:
      'A guided read of the market chapter: the three-sided market and its one conserving ledger, additive trace composition within a unit of account, explicit cross-currency exposure accounting, conditionally restricted custody, and the precise bilateral assumptions under which Myerson–Satterthwaite applies.',
    filename: 'harbor-economy-whitepaper',
    pdfPath: '/whitepaper/harbor-economy-whitepaper.pdf',
    readerHref: '/whitepaper/harbor-economy',
    overviewHref: '/whitepaper?paper=harbor-economy',
    date: 'August 2026',
    pages: 31,
    sizeKb: 871,
    status: 'Version 1.2 (revised pre-print)',
    order: '04',
    chapter: 'IV',
    group: 'explain',
    layer: 'L3 — the market',
    claim:
      'Once agents have un-fakeable reputations, you can rent trust between people who never met: a three-sided market on one conserving ledger, where the product is hosted trust, not the payment rail.',
    maturity: 'specified → proposed · cross-operator keystone unbuilt',
    crossRefs: {
      assumes: [{ chapter: 'III', why: 'the market prices reputation, which the bridge chapter builds' }],
      provedBy: [
        { chapter: 'VI', why: 'the Bonded Commons proves the conservation law of the bond ledger' },
        { chapter: 'VII', why: 'the Federated Harbor specifies conditional federation, custody, and bucket conservation' },
        { chapter: 'V', why: 'the Anchor Protocol proves the cross-harbor capability-transfer ceremony' },
      ],
    },
    primer:
      'This is where the library arrives. Once agents have reputations that cannot be faked, you can do something new: trust a helper you did not build, rent a brilliant one from someone who did, and pay only for work that was actually checked. The chapter argues the harbor is a three-sided market — operators sell labor and fleet-for-hire, agents and fleets are rentable assets, and skills and tools are licensed — all settling on one conserving bond ledger. Cross-harbor settlement remains a trusted-custody design: redirect and fee bounds hold only when a non-bypassable ledger restricts recipients, fees, and terminal transitions. It is also explicit that cross-operator attestation is specified-to-proposed, not shipped.',
    glossary: [
      {
        term: 'Three-sided market',
        definition:
          'Labor + fleet-for-hire (operators), rentable agents and fleets (assets), and licensed skills/tools — three sides settling on one ledger. “Three-sided by design; two-sided until reputation ships.”',
      },
      {
        term: 'Conserving bond ledger',
        definition:
          'A settlement ledger where value can be neither conjured nor vanished — only moved. Within one unit of account, valid traces compose by addition. Across currencies, any aggregate requires an explicit valuation instant plus fee, slippage, and exposure accounts.',
      },
      {
        term: 'Float-plan escrow',
        definition:
          'A trusted custody service whose extraction bound is conditional on a non-bypassable ledger that whitelists recipients, caps fees, and allows exactly one atomic terminal transition. Signed promises alone make theft detectable; they do not prevent it.',
      },
      {
        term: 'Hosted trust',
        definition:
          'The defensible product: a verified ledger, a relay, and a reputation system. Not the payment rail, which commoditizes. The moat is the trust, not the money movement.',
      },
      {
        term: 'Myerson–Satterthwaite',
        definition:
          'A 1983 impossibility for bilateral trade with independent private values and overlapping supports: no Bayesian incentive-compatible, interim individually rational, ex-post efficient mechanism can also be budget-balanced. It constrains qualifying bilateral slices, not every conserving market.',
      },
    ],
    whatYouGet:
      'You should leave able to (a) describe the three sides of the market and why they settle on one ledger; (b) prove additive conservation for composed native-unit traces and explain why cross-currency totals require a valuation model; and (c) state the three honest boundaries: the unbuilt cross-operator keystone, the custody assumptions behind escrow bounds, and the exact bilateral assumptions required by Myerson–Satterthwaite.',
    forBuilders:
      'If you are designing a marketplace for agent labor, rentable fleets, or licensed skills, this chapter is the map of what is hard: build for hosted trust rather than the payment rail; settle on one conserving native-unit ledger; make custody restrictions non-bypassable; model cross-currency exposure explicitly; and do not transfer a bilateral impossibility theorem beyond its assumptions.',
    highlights: [
      { icon: Network, label: 'Three-sided market, one conserving ledger' },
      { icon: Scale, label: 'Conditional custody bound, assumptions explicit' },
      { icon: Handshake, label: 'Hosted trust is the product, not the rail' },
      { icon: Shield, label: 'Myerson–Satterthwaite named, not hidden' },
    ],
    sections: [
      {
        title: 'The only plural, distrusting chapter',
        content:
          'The first three chapters serve one operator. This one is defined by participants who do not trust each other — which is exactly why it needs the proofs.',
      },
      {
        title: 'Three sides, one ledger',
        content:
          'Labor and fleet-for-hire, rentable assets, and licensed skills all settle on a single conserving bond ledger via float-plan escrow.',
      },
      {
        title: 'The cross-harbor ceremony & federation',
        content:
          'A capability-transfer ceremony, a witness log, conditionally restricted custody, and revocation gossip with expected logarithmic dissemination under a connected reliable-round model describe trade without a shared chain.',
      },
      {
        title: 'The honest reconciliations',
        content:
          'Sheaf language is retained only as an analogy and future formalization target; conservation composes additively within native units; cross-currency totals need a valuation model; and every folk-theorem claim includes the grading process in its monitoring assumptions.',
      },
      {
        title: 'The keystone and the tax',
        content:
          'The missing, blocking keystone is cross-operator attestation (specified-to-proposed). Myerson–Satterthwaite constrains qualifying bilateral slices, while the full market’s efficiency boundary remains to be derived.',
      },
    ],
    takeaways: [
      {
        title: 'The harbor comes before the economy',
        body: 'Pull out any link — memory, continuity, personhood, witnessed outcomes, non-forgeable identity — and the market above it falls. That is why the economy is the last chapter, not the first.',
      },
      {
        title: 'Sell trust, not the rail',
        body: 'The payment rail commoditizes. The verified ledger, the relay, and the reputation system are the defensible product — hosted trust.',
      },
      {
        title: 'Name the impossibilities',
        body: 'Myerson–Satterthwaite rules out a particular combination of properties only for qualifying bilateral private-value trade; the paper lists those assumptions and does not promote the result into a universal market theorem.',
      },
    ],
  },
  {
    id: 'anchor-protocol',
    slug: 'anchor-protocol',
    title: 'The Anchor Protocol',
    subtitle:
      'A mechanically analyzed control plane for local agent swarms: signed identity, scoped authority, bounded delegation, and explicit proof boundaries.',
    thesis:
      'When you spawn a script, that script often inherits far more authority than its task needs. This paper specifies signed identity and capability cards, attenuation checks, revocation data structures, and the verifier boundary that consumes them. ProVerif checks symbolic correspondence and attenuation properties of the phase models; Kani checks bounded source properties; conformance tests cover the deployed bridge. Those layers are complementary evidence, not a proof of arbitrary-depth delegation, complete runtime interception, or hardware-level constant time.',
    summary:
      'A guided read of the Anchor Protocol paper — what an "identity for a process" should even mean, how to mint one out of off-the-shelf cryptography, and why a problem that felt unsolvable in 2010 is now a long weekend\'s work.',
    filename: 'anchor-protocol-whitepaper',
    pdfPath: '/whitepaper/anchor-protocol-whitepaper.pdf',
    readerHref: '/whitepaper/anchor-protocol',
    overviewHref: '/whitepaper?paper=anchor-protocol',
    date: 'August 2026',
    pages: 27,
    sizeKb: 849,
    status: 'Version 1.4 (revised pre-print)',
    order: '05',
    chapter: 'V',
    group: 'prove',
    layer: 'proof — identity & capability',
    claim:
      'Signed cards give a verifier machine-checkable identity and authority evidence; the supplied models establish non-injective authentication correspondence and bounded attenuation, with runtime and hardware boundaries stated separately.',
    maturity: 'mechanically analyzed · ProVerif phase models + bounded Kani checks + conformance tests',
    crossRefs: {
      proves: [
        { chapter: 'II', why: 'mechanizes selected identity and capability claims used by the kernel' },
        { chapter: 'IV', why: 'supplies the local token substrate extended by the proposed transfer ceremony' },
      ],
    },
    primer:
      'A developer machine runs many short-lived programs, and autonomous helpers make user-wide ambient authority an increasingly poor default. The Anchor Protocol hands each program a signed card listing which operations it may request, for how long, and through which delegation path. Security depends on every relevant operation reaching the verifier. The paper separates symbolic protocol analysis, bounded source checks, deployed-bridge tests, and the assumptions between them so each conclusion stays inside the evidence that supports it.',
    glossary: [
      {
        term: 'Capability',
        definition:
          'A specific permission slip. Instead of "this program is trusted," capabilities say "this program may read /tmp/build.log, until 5pm, and nothing else."',
      },
      {
        term: 'Signed token',
        definition:
          'A message plus signature whose alteration is detectable by a verifier that has the issuer’s authentic public key, under the signature scheme’s security assumptions. The design uses Ed25519.',
      },
      {
        term: 'Delegation',
        definition:
          'When one program hands a sub-permission to another. If A is allowed to read /tmp/a and /tmp/b, A can mint a token that lets B read only /tmp/a. The new token cannot grow back: B cannot use it to also touch /tmp/b. We call this "attenuation."',
      },
      {
        term: 'Revocation',
        definition:
          'Cancelling a card before expiry. A cuckoo-filter representation and anti-entropy gossip disseminate revocations, with expected logarithmic completion only under the stated connected reliable-round model; partitions eliminate any finite protocol deadline.',
      },
      {
        term: 'Formal verification (ProVerif)',
        definition:
          'Automated symbolic analysis against a Dolev–Yao network attacker. The supplied ProVerif phase models check specific correspondence, secrecy, and attenuation queries; the results do not by themselves prove the deployed runtime or properties absent from those queries.',
      },
    ],
    whatYouGet:
      'You should leave able to (a) explain to your most skeptical coworker why "the user trusts everything this script does" stops being a working model the minute the script can spawn its own scripts, (b) sketch the token-based alternative on a whiteboard with the cryptography in the right places, and (c) recognize three classic attacks by name — algorithm confusion, replay, and over-broad delegation — and know which line of which paragraph defends against each. None of this is novel. The art is in the composition.',
    forBuilders:
      'If you are shipping anything that spawns subprocesses on a user\'s machine — an IDE plugin, an agent runtime, a build orchestrator, a self-updating CLI — this is a blueprint for a scoped authorization layer. The contribution is the assembly and its proof ledger: which check happens where, what the receiver refuses, what remains a runtime-interposition obligation, and how revocation behaves under both healthy gossip and partition.',
    highlights: [
      { icon: Shield, label: 'Verified in ProVerif' },
      { icon: Lock, label: 'Standard Ed25519 signatures' },
      { icon: CheckCircle, label: 'Bounded source checks, hardware caveat explicit' },
      { icon: Terminal, label: 'Revocation model with partition caveat' },
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
          'The phase models are checked in ProVerif, bounded source properties in Kani, and the deployed bridge in conformance tests. The paper records which queries close, including non-injective authentication, and which properties — such as arbitrary-depth delegation and hardware timing — remain outside those results.',
      },
      {
        title: 'Withdrawing a card before it expires',
        content:
          'If a card leaks, you should be able to cancel it without restarting the world. The paper describes cuckoo-filter revocation and anti-entropy gossip, then states the load-bearing caveat: expected dissemination needs a connected reliable-round model, and a partition has no finite deadline.',
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
      'Two agents can negotiate directly; twenty need shared infrastructure. This paper proposes a commons authority that records advisory claims, durable evidence, and refundable bonds. The structural guarantees require relevant operations to pass through the runtime verifier; the economic results are conditional on their stated market, identity, monitoring, and oracle assumptions.',
    summary:
      'A guided read of the Bonded Commons paper: why mutual visibility beats locks once you have more than a handful of agents, what kind of refundable "deposit" makes that visibility honest instead of theatrical, and how a tiny insurance market beats any single human picking the deposit size by hand.',
    filename: 'agent-transactions-whitepaper',
    pdfPath: '/whitepaper/agent-transactions-whitepaper.pdf',
    readerHref: '/whitepaper/bonded-commons',
    overviewHref: '/whitepaper?paper=bonded-commons',
    date: 'August 2026',
    pages: 48,
    sizeKb: 932,
    status: 'Version 2.7 (revised pre-print)',
    order: '06',
    chapter: 'VI',
    group: 'prove',
    layer: 'proof — the coordinator & conservation',
    claim:
      'Why a shared coordinator can reduce negotiation cost, which accounting transitions preserve the bond-ledger invariant, and where Sybil, cartel, oracle, and runtime-interposition assumptions bound the mechanism claims.',
    maturity: 'mixed evidence · bounded TLA⁺/ProVerif models + finite simulations + open runtime obligations',
    crossRefs: {
      proves: [{ chapter: 'IV', why: 'proves the conservation law of the bond ledger' }],
    },
    primer:
      'Picture four roommates sharing a kitchen. Locks on every drawer are costly; unconditional trust is fragile. A chore board, receipts, and a communal repair fund are a third pattern. The paper transplants that pattern into a shared workspace: agents post bonds, announce intended work, and leave evidence. It does not remove judgment — settlement still depends on acceptance criteria, multiple oracles, and sometimes human arbitration — but it makes the evidence and accounting explicit enough to audit.',
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
      'You should leave with: (a) an intuition for why per-resource locking becomes costly as a swarm grows, (b) the exact conditions under which refundable bonds can improve the modeled payoffs, (c) the runtime and evidence obligations needed for attribution and conservation, and (d) an honest map of the open edges — identity costs, oracle capture, cartel detection, thick-market bootstrap, and complete verifier interposition.',
    forBuilders:
      'If you are building infrastructure for multiple agents to collaborate on shared state — or multiple humans, frankly; the design does not care — this paper gives you the contracts you actually need: who announces what before they touch anything, where the evidence has to live so it cannot be quietly retconned, how a participant returns from a crash without you losing what they were doing, and (the whole back half of the paper) how to price the deposit so the buyer and seller both come out ahead. The pricing section was contributed by an actual economist. We made him write down his assumptions.',
    highlights: [
      { icon: Scale, label: 'Conservation model-checked at recorded bounds' },
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
          'The paper gives a cleanup-cost pricing rule and a competitive-insurance mechanism. A finite simulation grid reports where the specified auction beats its chosen static baseline and where it does not; it is not a universal Pareto theorem.',
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
      'Identity, coordination, and settlement across administrative domains — with conditional guarantees and trust boundaries stated explicitly.',
    thesis:
      'Two locally coherent daemons do not automatically compose across an administrative boundary. This paper specifies cross-harbor capability transfer, witnessed revocation dissemination, a trusted custody design with a conditional extraction bound, bucket-partition conservation, and bonded admission. Expected logarithmic revocation completion requires a connected reliable-round model; a partition has no finite deadline. Custody restrictions prevent redirect only when the transfer path and keys are non-bypassable. The runtime and protocol models remain partial.',
    summary:
      'A guided read of the Federated Harbor paper — why two trustworthy local daemons can still fail jointly, what four small primitives close the gap, and the honest list of open questions the paper does not answer.',
    filename: 'federated-harbor-whitepaper',
    pdfPath: '/whitepaper/federated-harbor-whitepaper.pdf',
    readerHref: '/whitepaper/federated-harbor',
    overviewHref: '/whitepaper?paper=federated-harbor',
    date: 'August 2026',
    pages: 29,
    sizeKb: 719,
    status: 'Version 1.0 (revised pre-print)',
    order: '07',
    chapter: 'VII',
    group: 'prove',
    layer: 'proof — federation across machines',
    claim:
      'A falsifiable federation design: modeled transfer properties, expected revocation dissemination under explicit network assumptions, conditional custody bounds, and finite-state conservation checks — not a deployed or trustless federation claim.',
    maturity: 'partial · ProVerif/TLA⁺ artifacts + conditional analytical bounds; federation runtime unshipped',
    crossRefs: {
      proves: [
        { chapter: 'IV', why: 'proves the federation of the market' },
        { chapter: 'III', why: 'names cross-operator attestation as the open keystone' },
      ],
    },
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
          'A trusted third party that holds a bond during cross-harbor settlement. Its extraction bound holds only if a non-bypassable custody ledger whitelists recipients, caps the fee, and executes exactly one atomic terminal transition. Without those assumptions the full custodial balance is exposed.',
      },
      {
        term: 'Bonded sponsorship',
        definition:
          'How a new harbor joins the federation without prior reputation. An existing harbor posts a bond on the newcomer\'s behalf, forfeit if the newcomer misbehaves during probation. Federation-layer analogue of competitive insurance.',
      },
      {
        term: 'Conditional dissemination result',
        definition:
          'Under the stated complete-overlay, independent-uniform-peer, reliable synchronous-round model, all harbors learn a revocation in expected Θ(log m) rounds. This is not a worst-case wall-clock deadline; persistent loss or partition removes any finite bound.',
      },
    ],
    whatYouGet:
      'You should leave able to (a) explain to a security reviewer why federating two trustworthy local daemons is harder than it looks, and which three things go wrong first; (b) sketch the cross-machine capability transfer on a whiteboard with the epoch-root binding in the right place; and (c) separate mechanized, model-conditional, and open claims. The paper names five open questions and treats that boundary as part of the result.',
    forBuilders:
      'If you are building infrastructure for two or more organizations to coordinate agent work across an administrative boundary, this paper gives you four proposed primitives: the transfer ceremony, federated revocation dissemination, conditionally restricted custody, and bonded-sponsor admission. It also gives the assumptions and open runtime obligations that must hold before their composition becomes an implementation guarantee.',
    highlights: [
      { icon: Network, label: 'Two harbors, no central authority' },
      { icon: GitBranch, label: 'Witness-logged revocation gossip' },
      { icon: Scale, label: 'Conditional custody bound, atomic transition' },
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
        title: 'Federated revocation with explicit network assumptions',
        content:
          'The cuckoo-filter gossip of the Anchor paper, extended to multiple administrative domains. Expected completion is Θ(log m) rounds in the stated reliable complete-overlay model; no finite deadline survives persistent loss or partition. Two conflicting signed roots are checkable in O(1) once co-located.',
      },
      {
        title: 'Cross-harbor settlement, structurally bounded',
        content:
          'A bond posted at A clears against damage measured at B through trusted custody. The extraction bound is conditional on recipient whitelisting, a fee cap, exactly one atomic terminal transition, and non-bypassable transfer authority.',
      },
      {
        title: 'Admission without permissionlessness',
        content:
          'A new harbor joins under a bonded sponsor: an existing harbor underwrites the newcomer\'s probationary risk. The federation is invitation-bounded by design. Sybil attacks at the federation layer cost what honest admission costs.',
      },
      {
        title: 'A worked example and an honest open frontier',
        content:
          'Two organizations, three machines, one schema migration, a failure, and a settlement trace. Then a final section names five open questions; for trustless settlement it leaves both a construction and an impossibility result open.',
      },
    ],
    takeaways: [
      {
        title: 'Sovereignty does not extend past the machine boundary, and that is fine',
        body: 'Two daemons each fully in charge of their own machines is the right architecture for cross-organization work. The federation paper is the rules of engagement at the boundary — not a new sovereign, not a blockchain, not a hub-and-spoke service. Four small primitives, each doing one job.',
      },
      {
        title: 'Bound the threat instead of trying to eliminate it',
        body: 'The protocol gives expected revocation latency only under explicit connectivity and delivery assumptions; any hard attacker window must come from an operator service level or fail-closed policy. The custody extraction bound is likewise conditional on non-bypassable structural restrictions.',
      },
      {
        title: 'Name the open questions, do not hide them',
        body: 'The multi-principal correlated-equilibrium extension, trustless settlement for non-fungible bonds, and federation-layer cartel resistance are stated as open. The paper offers neither a trustless construction nor an impossibility proof and does not pretend otherwise.',
      },
    ],
  },
])

export const READING_ORDER = [
  {
    step: '01',
    title: 'Start with the wedge',
    body: 'Read The Legible Swarm (I) first — it is the chapter a solo developer would pay for today. Its claim is that the operator’s real problem is blindness, not collision, and the cure is legibility-with-zoom: the swarm as one picture you can zoom into, never a wall of diffs.',
  },
  {
    step: '02',
    title: 'Then the floor it stands on',
    body: 'Read The Single-Writer Kernel (II). One writer, one machine, one durable file, no consensus — the small stubborn program that decides what is true so nothing above it has to guess. It is honest about exactly where its promises stop. (For the proof, jump to the Anchor Protocol, V.)',
  },
  {
    step: '03',
    title: 'Then the hinge',
    body: 'Read From Spawn to Person (III). Continuity — memory, a checkpoint, a witnessed record — turns an anonymous spawn into a person with a track record, and a track record is the raw material of reputation. The score is cheap; the substrate it scores over is the gate.',
  },
  {
    step: '04',
    title: 'Then the market it was all for',
    body: 'Read The Harbor Economy (IV). Once agents have un-fakeable reputations, you can rent trust between people who never met — a three-sided market on one conserving ledger. The proofs that hold it up are the Bonded Commons (VI) and the Federated Harbor (VII).',
  },
] as const

/**
 * The spine of the whole library, in one sentence. Pull out any link and the
 * chain above it falls — which is why the harbor comes before the economy.
 */
export const LIBRARY_SPINE =
  'Memory makes continuity; continuity makes a person, not a spawn; a person accrues a record; a record is reputation; reputation is a tradeable asset; and tradeable assets make a market.'

/**
 * The reading paths from the introduction — different doors into the same book.
 */
export const READING_PATHS = [
  {
    label: '“Just tell me what it is.”',
    body: 'Read the manifesto, then Chapter I — The Legible Swarm.',
    chapters: ['I'],
  },
  {
    label: '“Convince the skeptic.”',
    body: 'Read the four that explain, in order: I → II → III → IV.',
    chapters: ['I', 'II', 'III', 'IV'],
  },
  {
    label: '“Prove it to the cryptographer / the economist.”',
    body: 'Jump to the matching proof chapter — V (Anchor Protocol), VI (Bonded Commons), or VII (Federated Harbor).',
    chapters: ['V', 'VI', 'VII'],
  },
] as const

/**
 * The library changelog: dated release waves across the whole series, newest
 * first. One entry per wave, not per commit — the per-objection history of the
 * adversarial review rounds lives at /whitepaper/rounds.
 */
export interface LibraryChangelogEntry {
  /** Machine-sortable ISO date (YYYY-MM-DD) — the wave's landing day. */
  dateIso: string
  /** Human display label; may be coarser than dateIso (e.g. a month). */
  date: string
  title: string
  summary: string
  /** Chapter numerals of the papers this wave touched. */
  chapters: string[]
}

export const LIBRARY_CHANGELOG: LibraryChangelogEntry[] = [
  {
    dateIso: '2026-08-04',
    date: 'August 4, 2026',
    title: 'The seven-paper rigor pass closes diagram, math, and assurance drift',
    summary:
      'All seven chapters adopt one visual and editorial system. The six companion papers receive a full figure and mathematics audit: the cartel threshold is re-derived and synchronized with its simulation, revocation claims become model-conditional expectations rather than deadlines, custody bounds name their non-bypass assumptions, cross-currency accounting becomes explicit, and each mechanized claim is scoped to the model that supports it. Versions: I 1.1, II 1.1, III 1.3, IV 1.2, V 1.4, VI 2.7, VII 1.0.',
    chapters: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'],
  },
  {
    dateIso: '2026-07-04',
    date: 'July 4, 2026',
    title: 'The agentic-commerce stack arrives — every paper places itself against it',
    summary:
      'All five papers with LaTeX sources gain related-work treatment of the 2026 agentic-commerce protocols (UCP, AP2, ACP): the rails standardize the transaction and name agent trust out of scope — the layer this library prices. The reference implementation aligns at the boundary: harbor cards profile onto AP2’s verifiable-credential formats (ADR-0094) and the marketplace adopts UCP’s /.well-known discovery pattern (ADR-0051 Phase 1b). Versions bumped: III 1.0→1.1, IV 1.0→1.1, V 1.2→1.3, VI 2.5→2.6, VII 0.9→0.9.1.',
    chapters: ['III', 'IV', 'V', 'VI', 'VII'],
  },
  {
    dateIso: '2026-06-11',
    date: 'June 11, 2026',
    title: 'Paper VII lands; the PDFs start building themselves',
    summary:
      'The Federated Harbor (VII) publishes as a 0.9 pre-print — cross-machine capability transfer, revocation gossip, bounded escrow — and CI begins rebuilding every PDF from source on each change, so the published papers can no longer drift from their LaTeX.',
    chapters: ['VII'],
  },
  {
    dateIso: '2026-06-10',
    date: 'June 10, 2026',
    title: 'The Coordination Series: seven papers become one cross-linked book',
    summary:
      'The /library guide ships and the papers are restructured as seven co-equal chapters — four explain, three prove — each declaring what it assumes, what it underwrites, and which proof discharges it. Every figure in the explain quartet is de-cluttered in the same wave.',
    chapters: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'],
  },
  {
    dateIso: '2026-06-05',
    date: 'June 5, 2026',
    title: 'The attenuation proof stops being vacuous',
    summary:
      'The Anchor Protocol’s capability-attenuation proof is closed for real: a sound subset relation plus an explicit escalation adversary in ProVerif 2.05, replacing a model that could not have failed.',
    chapters: ['V'],
  },
  {
    dateIso: '2026-05-19',
    date: 'May 2026',
    title: 'Five adversarial review rounds forge Bonded Commons v2.5',
    summary:
      'The Bonded Commons is argued through five review rounds (v2.0 → v2.5) by two AI review teams — one attacking, one defending, neither reading the other’s notes. Every objection, fix, and still-open gap is on the record on the rounds page.',
    chapters: ['VI'],
  },
]

export const EXPLAIN_PAPERS = WHITE_PAPERS.filter((paper) => paper.group === 'explain')
export const PROVE_PAPERS = WHITE_PAPERS.filter((paper) => paper.group === 'prove')

export function findWhitePaperByChapter(chapter: string) {
  return WHITE_PAPERS.find((paper) => paper.chapter === chapter)
}

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
