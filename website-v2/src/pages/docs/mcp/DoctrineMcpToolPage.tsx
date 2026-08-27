import { CommandPage } from '@/components/docs/CommandPage'
import type { ComponentProps } from 'react'

type DoctrineTool =
  | 'doctrine_list'
  | 'doctrine_get'
  | 'doctrine_harvest_list'
  | 'doctrine_harvest_get'
  | 'record_doctrine_episode'
  | 'harvest_doctrine_episodes'
  | 'propose_doctrine_candidate'
  | 'preregister_doctrine_experiment'
  | 'record_doctrine_treatment_run'
  | 'admit_doctrine_candidate'
  | 'doctrine_orders'
  | 'record_doctrine_application'
  | 'record_doctrine_outcome'
  | 'contest_doctrine'
  | 'supersede_doctrine'
  | 'retire_doctrine'

const commonSeeAlso = [
  { name: 'Doctrine feature', href: '/docs/features/doctrine' },
  { name: 'pd-console Doctrine pane', href: '/docs/features/doctrine' },
  { name: 'CASE-13 tutorial', href: '/tutorials/doctrine-cycle' },
  { name: 'MCP catalog', href: '/docs/mcp#doctrine_orders' },
]

const commonEvidenceFlags = [
  { flag: 'project_dir', description: 'Required absolute project directory for the evidence scope.' },
  { flag: 'citations', description: 'Required immutable transcript, review, CI, commit, or verifier references.' },
  { flag: 'daemon-minted credential', description: 'Held by the MCP session, not supplied as a tool argument. The daemon derives the writer and admission reviewer from it.' },
  { flag: 'session_id / run_id / provenance', description: 'Optional session, run, model, harness, worktree, and environment provenance.' },
]

const toolPages = {
  doctrine_list: {
    description: 'List candidate and admitted advisory doctrine revisions. A listed packet is evidence to consider, not policy or authorization to act.',
    syntax: 'doctrine_list({ status?, project_dir?, decision_class? })',
    flags: [
      { flag: 'status', description: 'Optional revision state: candidate, provisional, established, contested, or retired.' },
      { flag: 'project_dir', description: 'Optional absolute project-directory scope.' },
      { flag: 'decision_class', description: 'Optional structured decision class, such as integration.merge.' },
    ],
    usagePatterns: [
      'Use before reviewing a doctrine family, not as a replacement for the live decision receipt.',
      'Filter by both project_dir and decision_class when studying a comparable decision class.',
    ],
    examples: [{
      description: 'List provisional merge-decision packets for one project',
      code: 'doctrine_list({ status: "provisional", project_dir: "/workspace/app", decision_class: "integration.merge" })',
      output: '{\n  "candidates": [/* advisory revisions with cited evidence */]\n}',
    }],
  },
  doctrine_get: {
    description: 'Read one advisory doctrine revision together with its cited episode, experiment, retrieval receipts, applications, outcomes, and contest history.',
    syntax: 'doctrine_get({ doctrine_id })',
    flags: [
      { flag: 'doctrine_id', description: 'Required admitted doctrine-revision identifier.' },
    ],
    usagePatterns: [
      'Use when a packet needs audit before it is reused or challenged.',
      'Treat a contested revision as historical evidence, not active advice.',
    ],
    examples: [{
      description: 'Inspect a candidate explanation for the CASE-13 decision class',
      code: 'doctrine_get({ doctrine_id: "doctrine:integration:independent-evidence" })',
      output: '{\n  "doctrine": { "status": "provisional", "evidence": "…" },\n  "applications": [],\n  "outcomes": []\n}',
    }],
  },
  doctrine_harvest_list: {
    description: 'List immutable offline harvests of cited recurring, exact-decision-class episodes. A harvest is preserved observation evidence, not active policy or a causal conclusion.',
    syntax: 'doctrine_harvest_list({ project_dir?, decision_class? })',
    flags: [
      { flag: 'project_dir', description: 'Optional absolute project-directory filter.' },
      { flag: 'decision_class', description: 'Optional exact structured decision-class filter.' },
    ],
    usagePatterns: [
      'Use to locate a recurring evidence set before proposing a candidate; do not treat a harvest as proof that a pattern caused an outcome.',
      'Filter by the exact project and decision class when auditing comparable observations.',
    ],
    examples: [{
      description: 'List immutable merge-decision harvests for one project',
      code: 'doctrine_harvest_list({ project_dir: "/workspace/app", decision_class: "integration.merge" })',
      output: '{\n  "harvests": [/* immutable cited observation sets */]\n}',
    }],
  },
  doctrine_harvest_get: {
    description: 'Read one immutable harvest with its frozen cited observation snapshots and source episode identifiers. Reading it does not infer a rule or activate doctrine.',
    syntax: 'doctrine_harvest_get({ harvest_id })',
    flags: [
      { flag: 'harvest_id', description: 'Required immutable harvest identifier.' },
    ],
    usagePatterns: [
      'Inspect the frozen source episodes before claiming that a recurring observation supports a candidate.',
      'Use the harvest as an audit record; retain it even when a later candidate is contested, superseded, or retired.',
    ],
    examples: [{
      description: 'Inspect the CASE-13 recurring-observation harvest',
      code: 'doctrine_harvest_get({ harvest_id: "doctrine-harvest_…" })',
      output: '{\n  "harvest": { "episodeIds": ["doctrine-episode_…"], "observations": [/* cited snapshots */] }\n}',
    }],
  },
  record_doctrine_episode: {
    description: 'Append a cited observed DecisionEpisode before proposing an explanation. It records what happened and the available alternatives; it is not itself doctrine or proof of cause.',
    syntax: 'record_doctrine_episode({ decision_class, summary, historical_action, project_dir, citations, alternatives?, cues?, fidelity?, id?, idempotency_key? })',
    flags: [
      { flag: 'decision_class', description: 'Required structured decision class, such as integration.merge.' },
      { flag: 'summary', description: 'Required observation of the decision without asserting its cause.' },
      { flag: 'historical_action', description: 'Required account of what the agent or reviewer actually did.' },
      { flag: 'alternatives / cues / fidelity', description: 'Optional competing actions, decision cues, and T0–T5 evidence-fidelity notation.' },
      { flag: 'id / idempotency_key', description: 'Optional stable episode identifier and retry key; a duplicate retry returns its original durable receipt.' },
      ...commonEvidenceFlags,
    ],
    usagePatterns: [
      'Capture the CASE-13 decision before writing a candidate rule about why it happened.',
      'Use citations to distinguish observed evidence from a retrospective story.',
    ],
    examples: [{
      description: 'Record the observed CASE-13 merge decision',
      code: 'record_doctrine_episode({ decision_class: "integration.merge", summary: "A technically mergeable PR was held for an unresolved bot thread", historical_action: "withheld merge", alternatives: ["merge after reviewing evidence", "request a technical response"], project_dir: "/workspace/app", citations: ["pr:case-13", "review:case-13"] })',
      output: '{\n  "episode": { "episodeId": "doctrine-episode_…" }\n}',
    }],
  },
  harvest_doctrine_episodes: {
    description: 'Freeze a cited recurring observation set from at least two existing episodes that share an exact project directory and structured decision class. It records evidence only; it neither infers nor activates doctrine.',
    syntax: 'harvest_doctrine_episodes({ decision_class, episode_ids, summary, project_dir, citations, id?, idempotency_key? })',
    flags: [
      { flag: 'decision_class', description: 'Required exact structured decision class shared by every source episode.' },
      { flag: 'episode_ids', description: 'Required list of at least two distinct existing DecisionEpisode identifiers.' },
      { flag: 'summary', description: 'Required bounded factual description of the recurring observation; do not claim causal proof.' },
      { flag: 'id / idempotency_key', description: 'Optional stable harvest identifier and retry key; a duplicate retry returns its original durable receipt.' },
      ...commonEvidenceFlags,
    ],
    usagePatterns: [
      'Harvest only episodes with the same exact project scope and decision class; an approximate similarity is not enough.',
      'Freeze recurring observations before drafting a falsifiable candidate, then test the candidate separately.',
    ],
    examples: [{
      description: 'Freeze a recurring CASE-13 merge-decision observation set',
      code: 'harvest_doctrine_episodes({ decision_class: "integration.merge", episode_ids: ["doctrine-episode_01", "doctrine-episode_02"], summary: "Two cited merge decisions held on an unresolved review thread", project_dir: "/workspace/app", citations: ["pr:case-13", "pr:case-27"] })',
      output: '{\n  "harvest": { "id": "doctrine-harvest_…", "episodeIds": ["doctrine-episode_01", "doctrine-episode_02"] }\n}',
    }],
  },
  propose_doctrine_candidate: {
    description: 'Propose a cited, falsifiable conditional preference from a recorded episode. It may be useful, wrong, or superseded; it is not active guidance until separately admitted.',
    syntax: 'propose_doctrine_candidate({ episode_id, decision_class, title, when, prefer, over, because, project_dir, citations, harvest_id?, supersedes_doctrine_id?, unless?, school?, skill_refs?, doctrine_id? })',
    flags: [
      { flag: 'episode_id', description: 'Required recorded DecisionEpisode identifier.' },
      { flag: 'harvest_id', description: 'Optional immutable recurring-observation harvest. It must contain episode_id and match this exact project and decision class.' },
      { flag: 'supersedes_doctrine_id', description: 'Optional cited prior revision whose boundary this candidate refines. It does not retire the prior revision; use supersede_doctrine only after successor admission.' },
      { flag: 'when / prefer / over / because', description: 'Required conditional rule, preferred action, alternative, and proposed mechanism.' },
      { flag: 'unless', description: 'Optional exceptions that bound the candidate.' },
      { flag: 'school', description: 'Optional decision-domain school, never an agent personality label.' },
      { flag: 'skill_refs', description: 'Optional procedural-skill citations. A skill file is a projection, never canonical doctrine.' },
      { flag: 'doctrine_id', description: 'Optional stable advisory identity chosen at proposal time; admission cannot rewrite it, so revisions are successor candidates.' },
      ...commonEvidenceFlags,
    ],
    usagePatterns: [
      'Phrase the claim so a comparable factual experiment could prove it wrong.',
      'A harvest can support the factual observation set, but it cannot substitute for the required control and treatment runs recorded with matched fidelity status.',
      'Use Skill Graft to locate a relevant procedural skill, then cite it rather than treating it as evidence.' ,
    ],
    examples: [{
      description: 'Propose the CASE-13 evidence-weighted candidate',
      code: 'propose_doctrine_candidate({ episode_id: "doctrine-episode_…", decision_class: "integration.merge", title: "Independent technical evidence carries merge-blocking weight", when: "a merge is otherwise ready and a review thread remains open", prefer: "inspect substantive evidence before blocking", over: "treating thread state as a veto", because: "thread count is a proxy", project_dir: "/workspace/app", citations: ["pr:case-13"] })',
      output: '{\n  "candidate": { "candidateId": "doctrine-candidate_…", "status": "candidate" }\n}',
    }],
  },
  preregister_doctrine_experiment: {
    description: 'Preregister a candidate experiment before results exist. It names the factual control, treatment, primary outcome, and optional sham so the later analysis cannot quietly change the test.',
    syntax: 'preregister_doctrine_experiment({ candidate_id, hypothesis, primary_outcome, control, treatment, project_dir, citations, sham?, preregistered_at?, id?, idempotency_key? })',
    flags: [
      { flag: 'candidate_id', description: 'Required candidate that this experiment will test.' },
      { flag: 'hypothesis / primary_outcome', description: 'Required prediction and observable outcome chosen before runs.' },
      { flag: 'control / treatment', description: 'Required factual arms that make the proposed mechanism testable.' },
      { flag: 'sham', description: 'Optional neutral or attention-control arm.' },
      { flag: 'preregistered_at / id / idempotency_key', description: 'Optional timestamp, stable identifier, and retry key.' },
      ...commonEvidenceFlags,
    ],
    usagePatterns: [
      'Define the arms before recording results or claiming that a transcript taught the fleet.',
      'Keep recorded fidelity separate from outcome quality; mark a prompt-only reconstruction mismatched rather than presenting it as a matched control.',
    ],
    examples: [{
      description: 'Preregister a CASE-13 factual test',
      code: 'preregister_doctrine_experiment({ candidate_id: "doctrine-candidate_…", hypothesis: "Independent evidence changes the merge decision more than thread state", primary_outcome: "merge, hold, or request-response decision", control: "unresolved thread without independent evidence", treatment: "unresolved thread with independent evidence", project_dir: "/workspace/app", citations: ["fork:case-13:checkpoint"] })',
      output: '{\n  "experiment": { "experimentId": "doctrine-experiment_…" }\n}',
    }],
  },
  record_doctrine_treatment_run: {
    description: 'Append one preregistered control, treatment, or sham run. A run recorded as unmatched, prompt-only, drifted, or same-replica cannot satisfy the advisory-admission gate; its cited fidelity record remains auditable.',
    syntax: 'record_doctrine_treatment_run({ experiment_id, arm, action, outcome, fidelity, replay_context, project_dir, citations, notes?, id?, idempotency_key? })',
    flags: [
      { flag: 'experiment_id', description: 'Required preregistered experiment identifier.' },
      { flag: 'arm', description: 'Required control, treatment, or sham arm.' },
      { flag: 'action / outcome', description: 'Required account of what occurred in that arm.' },
      { flag: 'fidelity', description: 'Required not-run, matched, or mismatched factual-fidelity status.' },
      { flag: 'replay_context', description: 'Required model, model_version, harness, worktree, environment, checkpoint, and replica_id. A qualifying pair matches every field except distinct replica_id values.' },
      { flag: 'notes / id / idempotency_key', description: 'Optional run notes, stable identifier, and retry key.' },
      ...commonEvidenceFlags,
    ],
    usagePatterns: [
      'Record every arm, including a failed reconstruction, instead of discarding inconvenient evidence.',
      'Admission needs a control and treatment from this experiment that are both matched and context-compatible, with distinct replica IDs; reviewers should inspect their citations and provenance.',
    ],
    examples: [{
      description: 'Record a matched treatment run',
      code: 'record_doctrine_treatment_run({ experiment_id: "doctrine-experiment_…", arm: "treatment", action: "requested a technical response", outcome: "independent evidence changed the decision", fidelity: "matched", replay_context: { model: "model-a", model_version: "v1", harness: "codex", worktree: "/workspace/app", environment: "dev-berth", checkpoint: "case-13:before-merge", replica_id: "treatment-01" }, project_dir: "/workspace/app", citations: ["fork:case-13:treatment-1"] })',
      output: '{\n  "run": { "runId": "doctrine-run_…", "arm": "treatment" }\n}',
    }],
  },
  admit_doctrine_candidate: {
    description: 'Admit a candidate as provisional advisory guidance only after its own preregistered experiment has matched control and treatment runs with compatible replay contexts and distinct replicas. It never authorizes or enforces an action.',
    syntax: 'admit_doctrine_candidate({ candidate_id, experiment_id, project_dir, citations, idempotency_key? })',
    flags: [
      { flag: 'candidate_id', description: 'Required candidate to admit; revisions require a new successor candidate.' },
      { flag: 'experiment_id', description: 'Required candidate-linked preregistered experiment.' },
      { flag: 'daemon-minted credential', description: 'The MCP session carries it; the daemon derives the reviewer and stamps first-cycle admission as provisional.' },
      { flag: 'idempotency_key', description: 'Optional retry key for the append-only admission call.' },
      ...commonEvidenceFlags,
    ],
    usagePatterns: [
      'Do not call after a run recorded as unmatched, a prompt-only reconstruction, or a test that lacks one of the required arms.',
      'Inspect cited replay context before relying on a matched-fidelity record; the pair must agree on model, model version, harness, worktree, environment, and checkpoint while using distinct replicas.',
      'Treat admission as an advisory packet for retrieval, not a merge gate or an automatic training event.',
    ],
    examples: [{
      description: 'Admit a CASE-13 candidate after cited fidelity evidence is reviewed',
      code: 'admit_doctrine_candidate({ candidate_id: "doctrine-candidate_…", experiment_id: "doctrine-experiment_…", project_dir: "/workspace/app", citations: ["review:case-13:admission"] })',
      output: '{\n  "doctrine": { "doctrineId": "doctrine:…", "status": "provisional" }\n}',
    }],
  },
  doctrine_orders: {
    description: 'Retrieve advisory doctrine for a live structured decision and append a retrieval receipt before the agent acts. Matching is exact on decision class; it never substitutes lexical similarity.',
    syntax: 'doctrine_orders({ decision_id, decision_class, project_dir, citations, limit?, id?, idempotency_key? })',
    flags: [
      { flag: 'decision_id', description: 'Required stable identifier for this live decision.' },
      { flag: 'decision_class', description: 'Required structured decision class, such as integration.merge.' },
      { flag: 'project_dir', description: 'Required absolute project-directory scope.' },
      { flag: 'citations', description: 'Required immutable decision-context receipts or source spans.' },
      { flag: 'limit', description: 'Optional maximum packets returned; default 3 and maximum 10.' },
      { flag: 'id / idempotency_key', description: 'Optional stable receipt identity and retry key. A retry returns the original receipt only for the same project, decision ID, and exact decision class.' },
    ],
    usagePatterns: [
      'Call immediately before a comparable decision so the receipt records what the agent was shown.',
      'Record an application afterward, including follow, adapt, or reject.',
    ],
    examples: [{
      description: 'Request advisory packets before an integration decision',
      code: 'doctrine_orders({ decision_id: "merge-482", decision_class: "integration.merge", project_dir: "/workspace/app", citations: ["pr:482", "ci:482"], idempotency_key: "merge-482:orders" })',
      output: '{\n  "retrieval": { "id": "doctrine-retrieval_…" },\n  "orders": [/* matching advisory packets, possibly empty */]\n}',
    }],
  },
  record_doctrine_application: {
    description: 'Record whether an agent followed, adapted, or rejected a doctrine that was actually present in a retrieval receipt. This links advice to a later verified outcome without erasing agency.',
    syntax: 'record_doctrine_application({ retrieval_id, doctrine_id, response, decision, project_dir, citations, note? })',
    flags: [
      { flag: 'retrieval_id', description: 'Required retrieval receipt that showed the advisory packet.' },
      { flag: 'doctrine_id', description: 'Required doctrine revision that appeared in that receipt.' },
      { flag: 'response', description: 'Required follow, adapt, or reject response.' },
      { flag: 'decision', description: 'Required account of what the agent actually decided or did.' },
      { flag: 'citations', description: 'Required evidence for the application record.' },
    ],
    usagePatterns: [
      'Use only after doctrine_orders returned the named doctrine in the referenced receipt.',
      'A rejection is useful evidence; do not rewrite it as compliance.',
    ],
    examples: [{
      description: 'Record an adapted merge decision',
      code: 'record_doctrine_application({ retrieval_id: "doctrine-retrieval_…", doctrine_id: "doctrine:integration:independent-evidence", response: "adapt", decision: "Asked for a technical reply, then merged", project_dir: "/workspace/app", citations: ["pr:482"] })',
      output: '{\n  "application": { "id": "doctrine-application_…", "response": "adapt" }\n}',
    }],
  },
  record_doctrine_outcome: {
    description: 'Attach a later verified outcome to a recorded doctrine application. A self-assessment alone is insufficient: cite the verification receipt that establishes helped, harmed, or inconclusive.',
    syntax: 'record_doctrine_outcome({ application_id, verdict, summary, verified_by, project_dir, citations })',
    flags: [
      { flag: 'application_id', description: 'Required recorded application identifier.' },
      { flag: 'verdict', description: 'Required helped, harmed, or inconclusive verdict.' },
      { flag: 'summary', description: 'Required concise account of the verified outcome.' },
      { flag: 'verified_by', description: 'Required direct verification-receipt identifier.' },
      { flag: 'citations', description: 'Required evidence that lets a reviewer inspect the verdict.' },
    ],
    usagePatterns: [
      'Record a verified effect, not a claim that one agent or one case proves fleet-wide learning.',
      'Contest a doctrine when a contrary case exposes a boundary or harm.',
    ],
    examples: [{
      description: 'Attach a verifier-backed result to an application',
      code: 'record_doctrine_outcome({ application_id: "doctrine-application_…", verdict: "inconclusive", summary: "No regression found, but the thread was not independently reproduced", verified_by: "ci:482:verified", project_dir: "/workspace/app", citations: ["ci:482:verified"] })',
      output: '{\n  "outcome": { "verdict": "inconclusive", "verifiedBy": "ci:482:verified" }\n}',
    }],
  },
  contest_doctrine: {
    description: 'Record contrary evidence or a boundary condition against an advisory doctrine. Contesting retains all history but removes that revision from active retrieval.',
    syntax: 'contest_doctrine({ doctrine_id, reason, project_dir, citations, severity?, idempotency_key? })',
    flags: [
      { flag: 'doctrine_id', description: 'Required advisory revision to contest.' },
      { flag: 'reason', description: 'Required cited contradiction, harm, or boundary condition.' },
      { flag: 'severity', description: 'Optional low, medium, or high severity.' },
      { flag: 'idempotency_key', description: 'Optional retry key for this append-only contest.' },
      ...commonEvidenceFlags,
    ],
    usagePatterns: [
      'Use when a later case exposes harm or an exception set that is too narrow.',
      'Propose a successor candidate if the underlying rule needs revision; never overwrite the contested one.',
    ],
    examples: [{
      description: 'Preserve a CASE-13 boundary condition',
      code: 'contest_doctrine({ doctrine_id: "doctrine:integration:independent-evidence", reason: "A policy-bound release required thread closure regardless of technical evidence", severity: "high", project_dir: "/workspace/app", citations: ["pr:9911", "policy:release-gate"] })',
      output: '{\n  "contest": { "doctrineId": "doctrine:integration:independent-evidence", "status": "contested" }\n}',
    }],
  },
  supersede_doctrine: {
    description: 'Retire one active advisory revision in favor of an already active successor that was explicitly proposed as its successor. The predecessor remains readable in the immutable ledger and is removed from future retrieval.',
    syntax: 'supersede_doctrine({ doctrine_id, successor_doctrine_id, reason, project_dir, citations, idempotency_key? })',
    flags: [
      { flag: 'doctrine_id', description: 'Required active predecessor revision to retire.' },
      { flag: 'successor_doctrine_id', description: 'Required already admitted successor whose candidate declared supersedes_doctrine_id equal to doctrine_id.' },
      { flag: 'reason', description: 'Required cited reason for replacing the older revision rather than rewriting its history.' },
      { flag: 'idempotency_key', description: 'Optional retry key for this append-only supersession.' },
      ...commonEvidenceFlags,
    ],
    usagePatterns: [
      'Admit and inspect the successor independently before superseding an active predecessor.',
      'Use a new successor candidate for a changed boundary; admissions never rewrite a candidate identity.',
    ],
    examples: [{
      description: 'Replace an active CASE-13 advisory revision with an admitted successor',
      code: 'supersede_doctrine({ doctrine_id: "doctrine:integration:independent-evidence:v1", successor_doctrine_id: "doctrine:integration:independent-evidence:v2", reason: "The successor adds the policy-bound release exception", project_dir: "/workspace/app", citations: ["review:case-13:successor"] })',
      output: '{\n  "supersession": { "doctrineId": "…", "successorDoctrineId": "…" }\n}',
    }],
  },
  retire_doctrine: {
    description: 'Retire an admitted or contested advisory revision without deleting its evidence. Retired doctrine no longer appears in future retrieval, but remains readable for audit and successor citation.',
    syntax: 'retire_doctrine({ doctrine_id, reason, project_dir, citations, idempotency_key? })',
    flags: [
      { flag: 'doctrine_id', description: 'Required admitted or contested advisory revision to retire.' },
      { flag: 'reason', description: 'Required cited reason that the revision should leave active retrieval.' },
      { flag: 'idempotency_key', description: 'Optional retry key for this append-only retirement.' },
      ...commonEvidenceFlags,
    ],
    usagePatterns: [
      'Use when an advisory revision should leave active retrieval but its evidence must remain auditable.',
      'Retirement preserves the ledger; it is not deletion and does not prove a causal conclusion about past cases.',
    ],
    examples: [{
      description: 'Retire an advisory revision while retaining its CASE-13 evidence',
      code: 'retire_doctrine({ doctrine_id: "doctrine:integration:independent-evidence:v1", reason: "The prior boundary is too broad for current release policy", project_dir: "/workspace/app", citations: ["policy:release-gate"] })',
      output: '{\n  "retirement": { "doctrineId": "…" }\n}',
    }],
  },
} satisfies Record<DoctrineTool, Omit<ComponentProps<typeof CommandPage>, 'command' | 'version' | 'seeAlso' | 'apiSpec'>>

export function DoctrineMcpToolPage({ tool }: { tool: DoctrineTool }) {
  const page = toolPages[tool]
  return (
    <CommandPage
      command={tool}
      description={page.description}
      version="3.30.3"
      syntax={page.syntax}
      flags={page.flags}
      usagePatterns={page.usagePatterns}
      examples={page.examples}
      apiSpec={[
        { label: 'Transport', value: 'MCP → local Port Daddy daemon' },
        { label: 'Category', value: 'Doctrine — advisory evidence loop' },
        { label: 'Authority', value: 'Advisory only; does not authorize or enforce an action' },
        { label: 'Evidence rule', value: 'Citations and credential-derived attribution are required; harvests record evidence, not causal proof' },
        { label: 'Deep operator surface', value: 'pd-console Doctrine pane; this page is a callable-tool reference' },
      ]}
      seeAlso={commonSeeAlso}
    />
  )
}
