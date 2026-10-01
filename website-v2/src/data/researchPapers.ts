import {
  Binary,
  Fingerprint,
  Layers3,
  Radar,
  ShieldCheck,
  SplitSquareVertical,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

/**
 * The eight Harbor research papers — arXiv-style research artifacts,
 * distinct from the seven product whitepapers showcased at
 * `/library`. The whitepapers make the harbor's claims in prose; these
 * papers investigate claims that need hard math: closed-form
 * bit floors, a controllability theorem, a bribery-proof inspection tower,
 * conservation laws for reputation, an NP-completeness frontier, and a
 * bounded sheaf-consistency detector. Publication here does not certify
 * every interpretation or application proposed in a paper.
 *
 * Page counts and file sizes are read from the built PDFs
 * (`public/research/paperN.pdf` via `pdfinfo`), not asserted — see the
 * research-library CI note in the changelog below if these ever drift.
 *
 * `tone` selects a literal Tailwind background/foreground pair defined in
 * `ResearchPage.tsx` (`RESEARCH_TONE_CLASSES`) — kept as literal strings
 * there, not built from this token name, because Tailwind's static scanner
 * cannot see classes assembled at runtime from a partial string.
 */
export type ResearchTone = 'primary' | 'health' | 'rust' | 'accent' | 'violet' | 'warm' | 'indigo'

/** The four outcomes a prior-art/falsification dive can end in — see `docs/harbor-research/deep-dives/README.md`. */
export type DiveVerdict = 'CLEAR' | 'NARROW' | 'SUBSUMED' | 'CONTRADICTED'

export interface PriorArtDive {
  verdict: DiveVerdict
  /** One sentence, safe to show next to the paper's own claim — what the dive found and what changed. */
  summary: string
  /** Path under docs/harbor-research/deep-dives/, e.g. 'flag-1-bonded-tower-vs-hierarchical-collusion/findings.md'. */
  findingsPath: string
}

export interface ResearchPaper {
  id: string
  /** Arabic numeral — deliberately distinct from the whitepapers' Roman-numeral chapters. */
  number: string
  title: string
  subtitle: string
  pdfPath: string
  /** Real page count, read via `pdfinfo public/research/paperN.pdf`. */
  pages: number
  /** KB, `Math.round(bytes / 1024)` on the committed PDF. */
  sizeKb: number
  /** Supported result or research question, in one sentence, in our own words. */
  claim: string
  /** A short evidence-bounded statement for the public listing. */
  pullQuote: string
  /** The R-numbers (results-compendium.md, R1–R17) this paper discharges. */
  resultTags: string[]
  tone: ResearchTone
  icon: LucideIcon
  /** The library chapter (Roman numeral) this paper's proof is closest to. */
  /** Id of the Book chapter this paper's results are folded into (a WHITE_PAPERS id, never a number). */
  chapterRef: string
  /** One line on why that chapter needed this proof. */
  chapterWhy: string
  /**
   * A completed prior-art / falsification dive against this paper, if one
   * exists (`docs/harbor-research/deep-dives/`). Omitted, not a placeholder
   * verdict, for a paper no dive has run against yet — currently just paper 1.
   */
  priorArtDive?: PriorArtDive
}

export const RESEARCH_PAPERS: ResearchPaper[] = [
  {
    id: 'price-of-a-summary',
    number: '1',
    title: 'The Price of a Summary',
    subtitle: 'Information-Theoretic Limits of Agent Oversight',
    pdfPath: '/research/paper1.pdf',
    pages: 16,
    sizeKb: 427,
    claim:
      'A zero-miss digest has a combinatorial bit lower bound under a fixed inspection budget. Decision-specific rankings and adaptive group queries have separate, explicit assumptions.',
    pullQuote:
      'At least log₂C(N,k) − log₂C(m,k) bits are needed to cover every critical k-set using m opens. The counting bound alone does not construct an encoder that attains it.',
    resultTags: ['R1', 'R2', 'R3', 'R4', 'R14', 'R16'],
    tone: 'primary',
    icon: Binary,
    chapterRef: 'legible-swarm',
    chapterWhy: 'develops the oversight bounds, decision thresholds and zoom procedure embodied in Chapter 4',
  },
  {
    id: 'regimented-or-enforced',
    number: '2',
    title: 'Regimented or Enforced',
    subtitle: 'The Controllability Boundary for Agent Governance',
    pdfPath: '/research/paper2.pdf',
    pages: 14,
    sizeKb: 363,
    claim:
      'In the declared full-observation event model, controllability determines which safety policies a mediator can enforce before an effect.',
    pullQuote:
      'Prevention requires control of the relevant effect channel. Observation, authentication and adapter semantics determine whether that model applies.',
    resultTags: ['R5'],
    tone: 'health',
    icon: Workflow,
    chapterRef: 'single-writer-kernel',
    chapterWhy: 'formalizes the kernel chapter’s mediation boundary and its observation assumptions',
    priorArtDive: {
      verdict: 'NARROW',
      summary:
        'The enforcement claim is scoped to its event model, controllable channels and observation assumptions. Partial observation and real adapter behavior require additional contracts.',
      findingsPath: 'flag-2-runtime-enforceability-priority/findings.md',
    },
  },
  {
    id: 'reputation-is-amortized-verification',
    number: '3',
    title: 'Reputation is Amortized Verification',
    subtitle: 'Inspection Games for Agent Economies',
    pdfPath: '/research/paper3.pdf',
    pages: 12,
    sizeKb: 345,
    claim:
      'In the inspection game, deterrence requires audit probability times detection probability times penalty to cover the deviation gain. Hierarchy guarantees depend on bounded depth and the stated collusion model.',
    pullQuote:
      'Audit savings depend on the assumed gain, detection and penalty schedules. They require calibration before they can guide a real verification budget.',
    resultTags: ['R7'],
    tone: 'rust',
    icon: Layers3,
    chapterRef: 'spawn-to-person',
    chapterWhy: 'prices the neutral judges the bridge chapter’s multi-axis reputation depends on',
    priorArtDive: {
      verdict: 'CLEAR',
      summary:
        'The finite-depth hierarchy and collusion assumptions delimit the result. A bounded literature review is not a proof of priority or universal applicability.',
      findingsPath: 'flag-1-bonded-tower-vs-hierarchical-collusion/findings.md',
    },
  },
  {
    id: 'the-sealed-harbor',
    number: '4',
    title: 'The Sealed Harbor',
    subtitle: 'Mutually Confidential Computation with Explicit, Gated, Bounded Releases',
    pdfPath: '/research/paper4.pdf',
    pages: 17,
    sizeKb: 407,
    claim:
      'A declared release interface combines a finite noninterference model, mediated effects, atomic privacy accounting and a calibrated canary test.',
    pullQuote:
      'A q·b output-bit cap bounds the declared output channel. It does not establish which information those bits reveal, and timing channels remain outside that model.',
    resultTags: ['R5', 'R9', 'R10', 'R11'],
    tone: 'accent',
    icon: ShieldCheck,
    chapterRef: 'sealed-harbor',
    chapterWhy: 'is folded directly into its own chapter as the four-pillar assurance argument for mutually confidential computation',
    priorArtDive: {
      verdict: 'NARROW',
      summary:
        'The assurance argument composes scoped information-flow, privacy-accounting and detection results. Each pillar retains its own assumptions and proof boundary.',
      findingsPath: 'paper4-sealed-harbor/findings.md',
    },
  },
  {
    id: 'continuity-without-metaphysics',
    number: '5',
    title: 'Continuity Without Metaphysics',
    subtitle: 'Identity, Reputation, and the Body Problem for Software Agents',
    pdfPath: '/research/paper5.pdf',
    pages: 15,
    sizeKb: 324,
    claim:
      'Ledger rules can conserve credit and inherited obligations across agent changes. Safe continuation of an unknown remote effect additionally requires an adapter-specific deduplication or fencing contract.',
    pullQuote:
      'An authenticated checkpoint does not prove behavioral equivalence. Negative readback cannot justify retry while a prior request can still commit.',
    resultTags: ['R12', 'R13'],
    tone: 'violet',
    icon: Fingerprint,
    chapterRef: 'spawn-to-person',
    chapterWhy: 'gives the role-vs-person distinction its conservation proof: reputation survives a fork without minting itself',
    priorArtDive: {
      verdict: 'NARROW',
      summary:
        'The economic substitution result assumes the stated quality-pricing contract. Credit conservation, behavioral fidelity and safe external effects are distinct obligations.',
      findingsPath: 'paper5-continuity-without-metaphysics/findings.md',
    },
  },
  {
    id: 'what-needs-an-authority',
    number: '6',
    title: 'What Needs an Authority',
    subtitle: 'Mechanical Detection, Chartered Resolution, and the Exact Price of Sole Ownership',
    pdfPath: '/research/paper6.pdf',
    pages: 15,
    sizeKb: 422,
    claim:
      'A ground commitment language admits polynomial conflict checks. For a finite declared reachable family, future safety is decided on its inclusion-maximal fact sets.',
    pullQuote:
      'Disjunctive discharge choices make the decision NP-complete. That changes worst-case computational cost; it does not prove that a human judge is necessary.',
    resultTags: ['R15', 'R17'],
    tone: 'warm',
    icon: SplitSquareVertical,
    chapterRef: 'harbor-economy',
    chapterWhy: 'supplies scoped admission checks, future-fact conditions and specialization economics for Chapter 6',
    priorArtDive: {
      verdict: 'NARROW',
      summary:
        'The fragment uses established Horn, interval and difference-constraint methods. Its reachable-family result specializes monotonicity reasoning and requires independent reachability evidence.',
      findingsPath: 'flag-3-deontic-tractability-frontier/findings.md',
    },
  },
  {
    id: 'the-cohomology-of-equivocation',
    number: '7',
    title: 'The Cohomology of Equivocation',
    subtitle: 'What Cycle Residuals Certify in Federated Witness-Log Gossip',
    pdfPath: '/research/paper7.pdf',
    pages: 11,
    sizeKb: 423,
    claim:
      'A nonzero cycle residual rules out a global real-valued completion of the admitted edge observations. It neither identifies a liar nor detects every inconsistent raw claim.',
    pullQuote:
      'With the same visible endpoint claims, direct equality detects every cycle inconsistency and can detect more. Sparse visibility and privacy change the evidence contract.',
    resultTags: ['R6', 'CR'],
    tone: 'indigo',
    icon: Radar,
    chapterRef: 'federated-harbor',
    chapterWhy: 'gives Chapter 8 a scoped consistency test, visibility limits and equal-information comparisons',
    priorArtDive: {
      verdict: 'CLEAR',
      summary:
        'Graph projection and effective resistance provide the mathematical baseline. The research question is which authenticated observations justify a useful decision.',
      findingsPath: 'flag-4-topological-consensus-citation-audit/findings.md',
    },
  },
  {
    id: 'active-sheaf-cohomology-for-swarms',
    number: '8',
    title: 'The Cohomology of Agent Evidence',
    subtitle: 'Typed Cellular Sheaves, Relative Extension, and Fault Observability',
    pdfPath: '/research/paper8.pdf',
    pages: 14,
    sizeKb: 290,
    claim:
      'Typed maps specify which evidence can be compared. Exact categorical certificates, relative extension and report-error distance answer distinct compatibility questions.',
    pullQuote:
      'A contradictory categorical table can have zero real residual. Its least-cost retained witness consists of incompatible pins and a connecting zero-edge path.',
    resultTags: ['thm:categorical-certificate', 'thm:sheaf-edge-distance'],
    tone: 'primary',
    icon: Layers3,
    chapterRef: 'federated-harbor',
    chapterWhy: 'develops Chapter 8’s categorical certificates and typed observation limits; field utility and causal attribution remain open',
    priorArtDive: {
      verdict: 'NARROW',
      summary:
        'Cellular sheaf cohomology, Hodge decomposition, and sparse recovery supply the mathematics. The testable contribution is a typed agent-evidence contract, exact observability certificates, and controlled comparison with direct checks.',
      findingsPath: 'paper8-typed-evidence-sheaf/findings.md',
    },
  },
]

export const RESEARCH_PAPER_TOTAL_PAGES = RESEARCH_PAPERS.reduce((sum, paper) => sum + paper.pages, 0)

/**
 * The result ledger (which paper carries which executed result, and where it
 * lives in the book) is no longer typed here. It is derived from
 * docs/harbor-research/library-index.json into program.json and mirrored to
 * ./harborResearchProgram.json, which /research renders; the mirror test
 * checks every `resultTags` entry above against it.
 */
export function findResearchPaperById(id: string | undefined) {
  return RESEARCH_PAPERS.find((paper) => paper.id === id)
}
