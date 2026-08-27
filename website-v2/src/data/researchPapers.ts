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
 * The seven Harbor research papers — arXiv-style, adversarially reviewed
 * proofs, distinct from the seven product whitepapers showcased at
 * `/library`. The whitepapers make the harbor's claims in prose; these
 * papers are where the claims that needed hard math get it: closed-form
 * bit floors, a controllability theorem, a bribery-proof inspection tower,
 * conservation laws for reputation, an NP-completeness frontier, a
 * sheaf-cohomology detector with a certified lower bound.
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
  /** Arabic numeral, 1–7 — deliberately distinct from the whitepapers' Roman-numeral chapters. */
  number: string
  title: string
  subtitle: string
  pdfPath: string
  /** Real page count, read via `pdfinfo public/research/paperN.pdf`. */
  pages: number
  /** KB, `Math.round(bytes / 1024)` on the committed PDF. */
  sizeKb: number
  /** What this paper proves, in one sentence, in our own words — not lifted from the abstract. */
  claim: string
  /** A verbatim headline number or theorem statement from the paper's abstract. */
  pullQuote: string
  /** The R-numbers (results-compendium.md, R1–R17) this paper discharges. */
  resultTags: string[]
  tone: ResearchTone
  icon: LucideIcon
  /** The library chapter (Roman numeral) this paper's proof is closest to. */
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
    sizeKb: 451,
    claim:
      'Reading digests instead of transcripts has an exact bit-price, not a rule of thumb — and the floor survived a pre-registered attempt to break it.',
    pullQuote:
      'log₂C(N,k) − log₂C(m,k) bits, minimum, to guarantee catching all k load-bearing artifacts among N while opening only m — 0/16 falsification attempts survived it, including an oracle encoder.',
    resultTags: ['R1', 'R2', 'R3', 'R4', 'R14', 'R16'],
    tone: 'primary',
    icon: Binary,
    chapterRef: 'I',
    chapterWhy: 'prices the digest-with-zoom loop the flagship chapter only argues for in prose',
  },
  {
    id: 'regimented-or-enforced',
    number: '2',
    title: 'Regimented or Enforced',
    subtitle: 'The Controllability Boundary for Agent Governance',
    pdfPath: '/research/paper2.pdf',
    pages: 13,
    sizeKb: 362,
    claim:
      'Whether a governance rule can be prevented before it happens or only caught after is decided by one theorem, not by how hard the runtime tries.',
    pullQuote:
      'A safety policy is regimentable — preventable pre-effect — iff it is controllable in the Ramadge–Wonham sense. The design rule it proves: gate the channel, never the token.',
    resultTags: ['R5'],
    tone: 'health',
    icon: Workflow,
    chapterRef: 'II',
    chapterWhy: 'mechanizes the kernel chapter’s own "detector vs. regimenter" distinction as a theorem',
    priorArtDive: {
      verdict: 'NARROW',
      summary:
        'The rumored same-year preprint is real but orthogonal; the actual prior problem is Basin et al. (TISSEC 2013) — two correctness bugs against Schneider’s original theorem were found and fixed.',
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
    sizeKb: 343,
    claim:
      'A bonded judge stays honest exactly when audit-rate times damages clears the bribe — and stacking judges on judges holds at any depth on a finite bond, not an infinite one.',
    pullQuote:
      'Lifetime audit spend falls from Θ(T) flat to Θ(log T) to O(1) as a track record grows. Reputation is not a soft layer bolted onto verification — it is the mechanism that amortizes its cost.',
    resultTags: ['R7'],
    tone: 'rust',
    icon: Layers3,
    chapterRef: 'III',
    chapterWhy: 'prices the neutral judges the bridge chapter’s multi-axis reputation depends on',
    priorArtDive: {
      verdict: 'CLEAR',
      summary:
        'The one named competing result turned out to support the tower theorem, not contradict it — but the adversarial re-read caught and fixed a real arithmetic defect in the paper’s own C=1 counter-case.',
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
    sizeKb: 406,
    claim:
      'Two parties who share neither data nor model can still get one attributable joint computation, with every leak explicit, gated, and priced in bits — not trusted away.',
    pullQuote:
      'Four independently verified pillars — exhaustive noninterference, the controllability boundary, ε-conservation of the release ledger, a canary detector with a quotable operating curve — priced honestly as q·b bits across q jobs, before timing channels, which are out of model.',
    resultTags: ['R5', 'R9', 'R10', 'R11'],
    tone: 'accent',
    icon: ShieldCheck,
    chapterRef: 'V',
    chapterWhy: 'extends the Anchor Protocol’s capability boundary to what two mutually distrustful daemons can compute together',
    priorArtDive: {
      verdict: 'NARROW',
      summary:
        'Each pillar narrows to a known result (delimited release, a privacy filter) the paper mostly pre-concedes; one corollary applied an invalid composition bound and was rewritten to the model it actually holds for.',
      findingsPath: 'paper4-sealed-harbor/findings.md',
    },
  },
  {
    id: 'continuity-without-metaphysics',
    number: '5',
    title: 'Continuity Without Metaphysics',
    subtitle: 'Identity, Reputation, and the Body Problem for Software Agents',
    pdfPath: '/research/paper5.pdf',
    pages: 14,
    sizeKb: 324,
    claim:
      'Forking, distilling, swapping engines, or resurrecting an agent from a checkpoint needs no theory of personal identity — just three conservation laws on a ledger, proved.',
    pullQuote:
      'Unattested, swapping in a cheap engine always pays — Akerlof’s death spiral runs inside one identity. Attest the engine id and the incentive flips to the planner’s own efficiency rule, at zero audit stake.',
    resultTags: ['R12', 'R13'],
    tone: 'violet',
    icon: Fingerprint,
    chapterRef: 'III',
    chapterWhy: 'gives the role-vs-person distinction its conservation proof: reputation survives a fork without minting itself',
    priorArtDive: {
      verdict: 'NARROW',
      summary:
        'No prior work proves the theorems, but Theorem 2a was misnamed — it’s Akerlof’s lemons result, not the unraveling theorem the paper originally called it — and a plotted crossing value the paper’s own figure contradicted was corrected.',
      findingsPath: 'paper5-continuity-without-metaphysics/findings.md',
    },
  },
  {
    id: 'what-needs-an-authority',
    number: '6',
    title: 'What Needs an Authority',
    subtitle: 'Mechanical Detection, Chartered Resolution, and the Exact Price of Sole Ownership',
    pdfPath: '/research/paper6.pdf',
    pages: 14,
    sizeKb: 419,
    claim:
      'Conflict detection needs no authority at all — until one small step up in expressiveness makes it NP-complete, and that is exactly, provably, where an authority earns its keep.',
    pullQuote:
      'One step outside the tractable fragment (disjunctive obligations), conflict-freedom is NP-complete — validated against a brute-force oracle on 3,000 random policy sets, zero disagreements. An authority is needed exactly where the algorithm ends.',
    resultTags: ['R15', 'R17'],
    tone: 'warm',
    icon: SplitSquareVertical,
    chapterRef: 'IV',
    chapterWhy: 'corrects the market chapter’s sole-owner-vs-pooled-swarm threshold with the actual Erlang-C crossing point',
    priorArtDive: {
      verdict: 'NARROW',
      summary:
        'The tractable-then-NP-complete shape is already mapped by the Colombo Tosatto/Governatori compliance line; the paper’s specific fragment survives as novel, and a wrong-strictness "iff" in Theorem 3 — stated three different ways across four sites — was found and unified.',
      findingsPath: 'flag-3-deontic-tractability-frontier/findings.md',
    },
  },
  {
    id: 'the-cohomology-of-equivocation',
    number: '7',
    title: 'The Cohomology of Equivocation',
    subtitle: 'Detecting Split-View Lies in Federated Witness-Log Gossip by Sheaf Consistency',
    pdfPath: '/research/paper7.pdf',
    pages: 14,
    sizeKb: 466,
    claim:
      'An analyst can convict an equivocating gossip peer across a link that was never directly checked, whenever that link sits on a cycle — and the size of the lie has a certified lower bound.',
    pullQuote:
      'r = |s|·√(1 − R_eff(e)), closed form — the harness’s measured 1.2247 is exactly 3√(1 − 5/6). r > 0 proves no global history explains the data; a coalition on a cycle cancels to 0, measured at 6×10⁻¹⁵.',
    resultTags: ['R6'],
    tone: 'indigo',
    icon: Radar,
    chapterRef: 'VII',
    chapterWhy: 'gives the federation chapter’s witness-log gossip a detector for lies on links nobody directly compared',
    priorArtDive: {
      verdict: 'CLEAR',
      summary:
        'The one citation flagged as possibly fabricated turned out to be real but irrelevant — excluded on relevance, not fraud — and Herlihy–Shavit plus three more foundational citations were added to close a real omission.',
      findingsPath: 'flag-4-topological-consensus-citation-audit/findings.md',
    },
  },
]

export const RESEARCH_PAPER_TOTAL_PAGES = RESEARCH_PAPERS.reduce((sum, paper) => sum + paper.pages, 0)

/**
 * The R-number ledger: every result the seven papers discharge, in order,
 * with which paper carries it. R8 (the work-unit machine substrate) is
 * deliberately absent — it underwrites the daemon these papers assume but
 * has no numbered paper of its own yet (see results-compendium.md's paper
 * map). Listing it here as "proved" would overclaim.
 */
export interface ResultLedgerEntry {
  id: string
  label: string
  paperNumbers: string[]
}

export const RESULT_LEDGER: ResultLedgerEntry[] = [
  { id: 'R1', label: 'Read-poverty & the information floor', paperNumbers: ['1'] },
  { id: 'R2', label: 'Split-digest theorem', paperNumbers: ['1'] },
  { id: 'R3', label: 'Derived regret head', paperNumbers: ['1'] },
  { id: 'R4', label: 'Digest-zoom Pareto frontier', paperNumbers: ['1'] },
  { id: 'R5', label: 'Hypervisor enforceability = supervisory control', paperNumbers: ['2', '4'] },
  { id: 'R6', label: 'Sheaf verdict & consistency-radius theorem', paperNumbers: ['7'] },
  { id: 'R7', label: 'Inspection tower', paperNumbers: ['3'] },
  { id: 'R9', label: 'Sealed-room noninterference', paperNumbers: ['4'] },
  { id: 'R10', label: 'ε-conservation of the release ledger', paperNumbers: ['4'] },
  { id: 'R11', label: 'Canary detection power & SPRT latency', paperNumbers: ['4'] },
  { id: 'R12', label: 'No-mint reputation inheritance', paperNumbers: ['5'] },
  { id: 'R13', label: 'Engine substitution & resurrection soundness', paperNumbers: ['5'] },
  { id: 'R14', label: 'Costly-escalation threshold & the debit tuning band', paperNumbers: ['1'] },
  { id: 'R15', label: 'Specialization boundary & the succession price', paperNumbers: ['6'] },
  { id: 'R16', label: 'Context paging under a corrupted pin oracle', paperNumbers: ['1'] },
  { id: 'R17', label: 'Tractable deontic-conflict fragment & its NP frontier', paperNumbers: ['6'] },
]

export function findResearchPaperById(id: string | undefined) {
  return RESEARCH_PAPERS.find((paper) => paper.id === id)
}
