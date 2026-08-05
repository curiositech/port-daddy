import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Clock3,
  Eye,
  Hammer,
  PauseCircle,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { cancelSortie, fetchModels, fetchSortiePreflight, fetchSorties, launchSortie } from '../api';
import type { BackendInfo, SpawnPreflight, SpawnedAgent } from '../types';

type RecipeId = 'investigate' | 'fix' | 'review' | 'creative' | 'custom';
type ApprovalMode = 'none' | 'before-build' | 'before-apply' | 'before-close';
type MissionSelection = 'draft' | string;

interface SortiePanelProps {
  project?: string | null;
}

interface RecipeSpec {
  id: RecipeId;
  label: string;
  tagline: string;
  description: string;
  icon: typeof Search;
  defaultOutput: string;
  defaultBudgetUsd: string;
  defaultDurationMinutes: string;
  recommendedApproval: ApprovalMode;
  roster: string[];
  steps: string[];
  outputs: string[];
}

interface MissionDraft {
  goal: string;
  recipe: RecipeId;
  expectedOutput: string;
  backend: string;
  model: string;
  identity: string;
  budgetUsd: string;
  maxDurationMinutes: string;
  approvalMode: ApprovalMode;
  allowedTools: string;
  notes: string;
}

interface DraftRuntimePrefs {
  backend: string;
  model: string;
  identity: string;
  allowedTools: string;
  approvalMode: ApprovalMode;
}

const RECIPES: RecipeSpec[] = [
  {
    id: 'investigate',
    label: 'Investigate',
    tagline: 'Root cause first.',
    description: 'Explore the failure surface, narrow the likely cause, and return a legible memo before anyone starts swinging at fixes.',
    icon: Search,
    defaultOutput: 'Root-cause memo, open questions, supporting evidence, and recommended next actions.',
    defaultBudgetUsd: '0.90',
    defaultDurationMinutes: '30',
    recommendedApproval: 'before-close',
    roster: ['planner', 'explorer', 'summarizer'],
    steps: [
      'Map the failure or ambiguity before changing code.',
      'Collect evidence from logs, tests, docs, and nearby code.',
      'Return a concise briefing with confidence, risks, and next actions.',
    ],
    outputs: ['Root-cause memo', 'Open questions', 'Suggested next actions'],
  },
  {
    id: 'fix',
    label: 'Fix',
    tagline: 'Patch with guardrails.',
    description: 'Move from diagnosis into a bounded patch, with explicit testing and a reviewer mindset before the mission closes.',
    icon: Hammer,
    defaultOutput: 'Patch summary, tests run, remaining risks, and any follow-up work still required.',
    defaultBudgetUsd: '1.40',
    defaultDurationMinutes: '45',
    recommendedApproval: 'before-apply',
    roster: ['planner', 'builder', 'reviewer'],
    steps: [
      'Confirm the likely fix path before touching files.',
      'Apply the smallest defensible patch.',
      'Run verification and summarize residual risk before closing.',
    ],
    outputs: ['Patch or diff summary', 'Tests run', 'Residual risks'],
  },
  {
    id: 'review',
    label: 'Review',
    tagline: 'Find what bites later.',
    description: 'Audit a branch, commit range, or feature slice with severity-ordered findings and coverage gaps instead of vague reassurance.',
    icon: ShieldCheck,
    defaultOutput: 'Severity-ordered findings, test and coverage gaps, and a recommendation on whether the change is ready.',
    defaultBudgetUsd: '0.75',
    defaultDurationMinutes: '25',
    recommendedApproval: 'before-close',
    roster: ['reviewer', 'tester', 'summarizer'],
    steps: [
      'Read the diff or target surface with a code-review mindset.',
      'Stress likely regressions and missing tests.',
      'Deliver findings ordered by severity with concrete evidence.',
    ],
    outputs: ['Severity-ordered findings', 'Coverage gaps', 'Readiness recommendation'],
  },
  {
    id: 'creative',
    label: 'Creative',
    tagline: 'Diverge, connect, synthesize.',
    description: 'Generate multiple directions, connect them to project reality, and return the strongest concept or prototype path.',
    icon: Sparkles,
    defaultOutput: 'Three distinct directions, the strongest concept, and a prototype or next-step recommendation.',
    defaultBudgetUsd: '1.80',
    defaultDurationMinutes: '50',
    recommendedApproval: 'before-build',
    roster: ['spark', 'spider', 'prototyper', 'synthesizer'],
    steps: [
      'Generate multiple non-trivial directions before converging.',
      'Compare them against the project constraints and audience.',
      'Recommend the strongest option and the cheapest next proof step.',
    ],
    outputs: ['Options', 'Strongest concept', 'Prototype sketch or next step'],
  },
  {
    id: 'custom',
    label: 'Custom',
    tagline: 'You know the shape.',
    description: 'Hand-author the mission instead of leaning on a stock pattern.',
    icon: ClipboardList,
    defaultOutput: 'A bounded mission result with explicit deliverables, risks, and follow-up items.',
    defaultBudgetUsd: '1.00',
    defaultDurationMinutes: '35',
    recommendedApproval: 'before-close',
    roster: ['coordinator'],
    steps: [
      'Use the goal and notes as the source of truth.',
      'Stay inside the declared budget and duration ceiling.',
      'Return a concise operator-facing summary at the end.',
    ],
    outputs: ['Requested deliverable', 'Risks', 'Follow-up items'],
  },
];

const APPROVAL_LABELS: Record<ApprovalMode, string> = {
  none: 'No gate',
  'before-build': 'Before build/prototype',
  'before-apply': 'Before apply',
  'before-close': 'Before close',
};

function getRecipe(recipeId: RecipeId): RecipeSpec {
  return RECIPES.find((recipe) => recipe.id === recipeId) ?? RECIPES[0];
}

function isBackendReady(backend: BackendInfo): boolean {
  return backend.launchable ?? backend.readinessStatus === 'ready';
}

function createInitialDraft(project?: string | null): MissionDraft {
  const recipe = getRecipe('investigate');
  return {
    goal: '',
    recipe: recipe.id,
    expectedOutput: recipe.defaultOutput,
    backend: '',
    model: '',
    identity: buildSuggestedIdentity(project, recipe, ''),
    budgetUsd: recipe.defaultBudgetUsd,
    maxDurationMinutes: recipe.defaultDurationMinutes,
    approvalMode: recipe.recommendedApproval,
    allowedTools: '',
    notes: '',
  };
}

function preserveRuntimePrefs(draft: MissionDraft): DraftRuntimePrefs {
  return {
    backend: draft.backend,
    model: draft.model,
    identity: draft.identity,
    allowedTools: draft.allowedTools,
    approvalMode: draft.approvalMode,
  };
}

function createFollowupDraft(project: string | null | undefined, runtime: DraftRuntimePrefs): MissionDraft {
  const next = createInitialDraft(project);
  return {
    ...next,
    backend: runtime.backend || next.backend,
    model: runtime.model,
    identity: runtime.identity || next.identity,
    allowedTools: runtime.allowedTools,
    approvalMode: runtime.approvalMode || next.approvalMode,
  };
}

function slugifySegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return normalized || 'mission';
}

function buildSuggestedIdentity(project: string | null | undefined, recipe: RecipeSpec, goal: string): string {
  const projectSegment = slugifySegment(project || 'project');
  const missionSegment = slugifySegment(goal || recipe.id);
  return `${projectSegment}:sortie:${missionSegment}`;
}

function buildMissionPrompt(draft: MissionDraft, recipe: RecipeSpec, identity: string): string {
  const lines = [
    'You are the coordinating agent for a Port Daddy sortie mission.',
    `Mission identity: ${identity}`,
    `Mission recipe: ${recipe.label}`,
    `Mission goal: ${draft.goal.trim()}`,
    '',
    'Expected output:',
    draft.expectedOutput.trim(),
    '',
    'Mission guardrails:',
    `- Budget ceiling: $${draft.budgetUsd.trim() || recipe.defaultBudgetUsd}`,
    `- Time ceiling: ${draft.maxDurationMinutes.trim() || recipe.defaultDurationMinutes} minutes`,
    `- Approval mode: ${APPROVAL_LABELS[draft.approvalMode]}`,
    draft.allowedTools.trim() ? `- Preferred tool scope: ${draft.allowedTools.trim()}` : '- Preferred tool scope: use the minimum necessary tool surface',
    '',
    'Planned roster:',
    ...recipe.roster.map((role) => `- ${role}`),
    '',
    'Mission workflow:',
    ...recipe.steps.map((step) => `- ${step}`),
    '',
    'Deliverables:',
    ...recipe.outputs.map((output) => `- ${output}`),
  ];

  if (draft.notes.trim()) {
    lines.push('', 'Context and constraints:', draft.notes.trim());
  }

  if (draft.approvalMode === 'before-apply') {
    lines.push('', 'Do not apply code changes or destructive operations without explicit approval from the human operator.');
  } else if (draft.approvalMode === 'before-build') {
    lines.push('', 'Do not start prototyping or editing until you have presented a plan for approval.');
  } else if (draft.approvalMode === 'before-close') {
    lines.push('', 'Before closing, provide a concise mission briefing with evidence, decisions, and remaining risks.');
  }

  return lines.join('\n');
}

function formatTimestamp(timestamp?: number | null): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRelative(timestamp?: number | null): string {
  if (!timestamp) return 'just now';
  const deltaMs = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(deltaMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function matchesProject(sortie: SpawnedAgent, project?: string | null): boolean {
  if (!project) return true;
  const prefix = `${project.toLowerCase()}:`;
  const identity = sortie.identity?.toLowerCase() ?? '';
  const purpose = sortie.purpose?.toLowerCase() ?? '';
  return identity.startsWith(prefix) || purpose.includes(project.toLowerCase());
}

function toneForStatus(status: string): {
  label: string;
  chipClass: string;
  dotClass: string;
  icon: typeof CircleDot;
} {
  switch (status) {
    case 'running':
      return { label: 'Running', chipClass: 'pd-chip-warning', dotClass: 'bg-[var(--pd-warning)]', icon: CircleDot };
    case 'completed':
      return { label: 'Completed', chipClass: 'pd-chip-success', dotClass: 'bg-[var(--pd-success)]', icon: CheckCircle2 };
    case 'failed':
      return { label: 'Failed', chipClass: 'pd-chip-accent', dotClass: 'bg-[var(--pd-accent)]', icon: AlertTriangle };
    case 'cancelled':
      return { label: 'Cancelled', chipClass: 'pd-chip-neutral', dotClass: 'bg-[var(--pd-line)]', icon: PauseCircle };
    default:
      return { label: status || 'Unknown', chipClass: 'pd-chip-neutral', dotClass: 'bg-[var(--pd-line)]', icon: CircleDot };
  }
}

function recipeForMission(sortie: SpawnedAgent): RecipeSpec | null {
  const purpose = `${sortie.purpose ?? ''} ${sortie.identity ?? ''}`.toLowerCase();
  return RECIPES.find((recipe) => purpose.includes(recipe.id)) ?? null;
}

export default function SortiePanel({ project }: SortiePanelProps) {
  const [sorties, setSorties] = useState<SpawnedAgent[]>([]);
  const [missionSnapshots, setMissionSnapshots] = useState<Record<string, SpawnedAgent>>({});
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [selectedMissionId, setSelectedMissionId] = useState<MissionSelection>('draft');
  const [draft, setDraft] = useState<MissionDraft>(() => createInitialDraft(project));
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<SpawnPreflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  const recipe = useMemo(() => getRecipe(draft.recipe), [draft.recipe]);
  const selectedBackend = useMemo(
    () => backends.find((backend) => backend.id === draft.backend),
    [backends, draft.backend],
  );
  const effectiveIdentity = useMemo(
    () => draft.identity.trim() || buildSuggestedIdentity(project, recipe, draft.goal),
    [draft.identity, draft.goal, project, recipe],
  );
  const missionPrompt = useMemo(
    () => buildMissionPrompt(draft, recipe, effectiveIdentity),
    [draft, effectiveIdentity, recipe],
  );

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      expectedOutput: current.expectedOutput.trim() ? current.expectedOutput : recipe.defaultOutput,
      budgetUsd: current.budgetUsd.trim() ? current.budgetUsd : recipe.defaultBudgetUsd,
      maxDurationMinutes: current.maxDurationMinutes.trim() ? current.maxDurationMinutes : recipe.defaultDurationMinutes,
      approvalMode: current.approvalMode || recipe.recommendedApproval,
    }));
  }, [recipe]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const [models, launched] = await Promise.all([fetchModels(), fetchSorties()]);
        if (cancelled) return;
        const launchable = models.filter(isBackendReady);
        setBackends(launchable);
        setDraft((current) => {
          if (!current.backend || !launchable.some((backend) => backend.id === current.backend)) {
            return { ...current, backend: launchable[0]?.id ?? '', model: '' };
          }
          return current;
        });
        setSorties(launched);
        setMissionSnapshots((previous) => {
          const next = { ...previous };
          launched.forEach((sortie) => {
            next[sortie.agentId] = { ...next[sortie.agentId], ...sortie };
          });
          return next;
        });
      } catch {
        if (!cancelled) {
          // Non-fatal. The panel will render what it has.
        }
      }
    };

    void refresh();
    const poll = window.setInterval(refresh, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    const budgetUsd = draft.budgetUsd.trim() ? parseFloat(draft.budgetUsd) : NaN;
    const timer = window.setTimeout(() => {
      fetchSortiePreflight({
        backend: draft.backend,
        model: draft.model || undefined,
        identity: effectiveIdentity,
        budgetUsd: Number.isFinite(budgetUsd) ? budgetUsd : undefined,
      })
        .then((result) => {
          setPreflight(result);
          setPreflightError(null);
        })
        .catch((error) => {
          setPreflight(null);
          setPreflightError((error as Error).message);
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [draft.backend, draft.budgetUsd, draft.model, effectiveIdentity]);

  const visibleSorties = useMemo(
    () => sorties.filter((sortie) => matchesProject(sortie, project)),
    [project, sorties],
  );

  const runningSorties = useMemo(
    () => visibleSorties.filter((sortie) => sortie.status === 'running'),
    [visibleSorties],
  );

  const recentSorties = useMemo(
    () => visibleSorties.filter((sortie) => sortie.status !== 'running').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)),
    [visibleSorties],
  );

  const selectedMission = selectedMissionId === 'draft'
    ? null
    : (() => {
        const snapshot = missionSnapshots[selectedMissionId];
        if (snapshot && matchesProject(snapshot, project)) return snapshot;
        return visibleSorties.find((sortie) => sortie.agentId === selectedMissionId) || null;
      })();

  useEffect(() => {
    if (selectedMissionId === 'draft') return;
    const snapshot = missionSnapshots[selectedMissionId];
    const exists = visibleSorties.some((sortie) => sortie.agentId === selectedMissionId)
      || (!!snapshot && matchesProject(snapshot, project));
    if (!exists) setSelectedMissionId('draft');
  }, [missionSnapshots, project, selectedMissionId, visibleSorties]);

  const launchBlocked = !draft.backend || (!!preflight && !preflight.launchReady);

  async function refreshSorties(): Promise<void> {
    const updated = await fetchSorties();
    setSorties(updated);
    setMissionSnapshots((previous) => {
      const next = { ...previous };
      updated.forEach((sortie) => {
        next[sortie.agentId] = { ...next[sortie.agentId], ...sortie };
      });
      return next;
    });
  }

  const handleLaunch = async () => {
    const parsedBudgetUsd = draft.budgetUsd.trim() ? parseFloat(draft.budgetUsd) : NaN;
    const parsedDurationMinutes = draft.maxDurationMinutes.trim() ? parseFloat(draft.maxDurationMinutes) : NaN;

    if (!draft.goal.trim()) {
      window.alert('A mission goal is required.');
      return;
    }
    if (!draft.expectedOutput.trim()) {
      window.alert('Expected output is required so the sortie has a clear finish line.');
      return;
    }
    if (!draft.backend.trim()) {
      window.alert('A ready backend is required before launching a sortie.');
      return;
    }
    if (!Number.isFinite(parsedBudgetUsd) || parsedBudgetUsd <= 0) {
      window.alert('A positive budget ceiling is required for sorties.');
      return;
    }
    if (!effectiveIdentity.trim()) {
      window.alert('A semantic identity is required so sortie spend lands on a project budget.');
      return;
    }

    setLaunching(true);
    setLaunchError(null);
    try {
      const runtimePrefs = preserveRuntimePrefs(draft);
      const result = await launchSortie({
        backend: draft.backend,
        model: draft.model || undefined,
        prompt: missionPrompt,
        purpose: `${recipe.id}: ${draft.goal.trim().slice(0, 120)}`,
        identity: effectiveIdentity,
        allowedTools: draft.allowedTools.trim() || undefined,
        budgetUsd: parsedBudgetUsd,
        timeout: Number.isFinite(parsedDurationMinutes) && parsedDurationMinutes > 0
          ? Math.round(parsedDurationMinutes * 60_000)
          : undefined,
      });

      setMissionSnapshots((previous) => ({
        ...previous,
        [result.agentId]: result,
      }));
      await refreshSorties();
      setSelectedMissionId(result.agentId);
      setDraft(createFollowupDraft(project, runtimePrefs));
      setPreflight(null);
      setPreflightError(null);
    } catch (error) {
      setLaunchError((error as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const handleCancel = async (id: string) => {
    await cancelSortie(id);
    await refreshSorties();
  };

  return (
    <div className="h-full min-h-0 p-4">
      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="pd-card min-h-0 overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-4" style={{ borderColor: 'var(--pd-border)' }}>
            <div>
              <div className="pd-kicker">Sortie Inbox</div>
              <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
                Mission workspace
              </div>
            </div>
            <button
              type="button"
              className="pd-button pd-button-primary min-h-0 px-3 py-2 text-[11px]"
              onClick={() => setSelectedMissionId('draft')}
            >
              <Rocket size={12} />
              New
            </button>
          </div>

          <div className="space-y-5 overflow-y-auto p-4">
            <section className="space-y-2">
              <div className="pd-kicker">Current scope</div>
              <div className="pd-card-inset p-3 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                {project ? (
                  <>
                    Missions are scoped to <span style={{ color: 'var(--pd-text)' }}>{project}</span>.
                    Stable user-facing control should stay on the canonical daemon unless you intentionally override it.
                  </>
                ) : (
                  'No project selected. Mission attribution will fall back to the identity you provide.'
                )}
              </div>
            </section>

            <section className="space-y-2">
              <div className="pd-kicker">Compose</div>
              <button
                type="button"
                onClick={() => setSelectedMissionId('draft')}
                className="pd-card-muted w-full p-3 text-left"
                style={{
                  borderColor: selectedMissionId === 'draft' ? 'var(--pd-accent-border)' : 'var(--pd-border)',
                  boxShadow: selectedMissionId === 'draft' ? '0 0 0 1px color-mix(in srgb, var(--pd-accent) 35%, transparent)' : undefined,
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>Draft mission</div>
                    <div className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                      Goal, recipe, budget ceiling, approval mode, and roster preview.
                    </div>
                  </div>
                  <ArrowRight size={14} style={{ color: 'var(--pd-accent)' }} />
                </div>
              </button>
            </section>

            <MissionListSection
              title="Running"
              empty="No live sorties."
              sorties={runningSorties}
              selectedMissionId={selectedMissionId}
              onSelect={setSelectedMissionId}
            />

            <MissionListSection
              title="Recent outcomes"
              empty="No recent mission outcomes."
              sorties={recentSorties.slice(0, 6)}
              selectedMissionId={selectedMissionId}
              onSelect={setSelectedMissionId}
            />
          </div>
        </aside>

        <div className="min-h-0 overflow-y-auto">
          {selectedMission ? (
            <MissionDetail
              mission={selectedMission}
              onBack={() => setSelectedMissionId('draft')}
              onCancel={() => void handleCancel(selectedMission.agentId)}
            />
          ) : (
            <div className="space-y-4">
              <section className="pd-card overflow-hidden">
                <div className="border-b px-5 py-4" style={{ borderColor: 'var(--pd-border)' }}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="pd-kicker">Guided builder</div>
                      <div className="mt-1 text-xl font-semibold tracking-tight" style={{ color: 'var(--pd-text)' }}>
                        Sortie mission workspace
                      </div>
                      <div className="mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                        Author the mission here, inspect the roster and launch path before spending money, then send one bounded coordinating agent through the current spawn runtime.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="pd-chip pd-chip-warning">
                        <Bot size={12} />
                        Single-agent launch path today
                      </span>
                      <span className="pd-chip pd-chip-neutral">
                        <Eye size={12} />
                        Multi-agent harbor and persistent approvals come next
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1.7fr)_320px]">
                  <div className="space-y-4">
                    {launchError ? (
                      <div className="rounded-2xl border px-4 py-3 text-sm leading-relaxed" style={{ borderColor: 'var(--pd-accent-border)', backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)' }}>
                        Sortie launch failed: {launchError}
                      </div>
                    ) : null}

                    <section className="pd-card-muted p-4">
                      <div className="pd-kicker">Recipe</div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {RECIPES.map((option) => {
                          const Icon = option.icon;
                          const active = draft.recipe === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setDraft((current) => ({ ...current, recipe: option.id }))}
                              className="pd-card-muted text-left p-4 transition-colors"
                              style={{
                                borderColor: active ? 'var(--pd-accent-border)' : 'var(--pd-border)',
                                backgroundColor: active ? 'var(--pd-surface-hover)' : undefined,
                                boxShadow: active ? '0 0 0 1px color-mix(in srgb, var(--pd-accent) 30%, transparent)' : undefined,
                              }}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full p-2" style={{ backgroundColor: 'var(--pd-bg)', color: active ? 'var(--pd-accent)' : 'var(--pd-muted)' }}>
                                    <Icon size={14} />
                                  </span>
                                  <div>
                                    <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>{option.label}</div>
                                    <div className="text-xs" style={{ color: 'var(--pd-muted)' }}>{option.tagline}</div>
                                  </div>
                                </div>
                                {active && <CheckCircle2 size={16} style={{ color: 'var(--pd-accent)' }} />}
                              </div>
                              <div className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                                {option.description}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    <section className="pd-card-muted p-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="lg:col-span-2">
                          <label className="pd-label" htmlFor="sortie-goal">Goal</label>
                          <textarea
                            id="sortie-goal"
                            className="pd-textarea"
                            value={draft.goal}
                            onChange={(event) => setDraft((current) => ({ ...current, goal: event.target.value }))}
                            placeholder="Investigate flaky auth tests, identify the root cause, patch only if safe, and return with risks."
                            rows={4}
                          />
                        </div>

                        <div className="lg:col-span-2">
                          <label className="pd-label" htmlFor="sortie-output">Expected output</label>
                          <textarea
                            id="sortie-output"
                            className="pd-textarea"
                            value={draft.expectedOutput}
                            onChange={(event) => setDraft((current) => ({ ...current, expectedOutput: event.target.value }))}
                            placeholder="What should come back when the mission is actually useful?"
                            rows={4}
                          />
                        </div>

                        <div className="lg:col-span-2">
                          <label className="pd-label" htmlFor="sortie-notes">Context and constraints</label>
                          <textarea
                            id="sortie-notes"
                            className="pd-textarea"
                            value={draft.notes}
                            onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                            placeholder="Relevant branch, failing tests, files to avoid, product context, or human expectations."
                            rows={5}
                          />
                        </div>
                      </div>
                    </section>

                    <section className="pd-card-muted p-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <label className="pd-label" htmlFor="sortie-backend">Backend</label>
                          <select
                            id="sortie-backend"
                            className="pd-select"
                            value={draft.backend}
                            onChange={(event) => setDraft((current) => ({ ...current, backend: event.target.value, model: '' }))}
                          >
                            {backends.length === 0 && (
                              <option value="" disabled>No ready backend</option>
                            )}
                            {backends.map((backend) => (
                              <option key={backend.id} value={backend.id}>{backend.name}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="pd-label" htmlFor="sortie-model">Model</label>
                          <select
                            id="sortie-model"
                            className="pd-select"
                            value={draft.model}
                            onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                          >
                            <option value="">backend default</option>
                            {selectedBackend?.models.map((model) => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="pd-label" htmlFor="sortie-budget">Budget ceiling (USD)</label>
                          <input
                            id="sortie-budget"
                            className="pd-input font-mono"
                            value={draft.budgetUsd}
                            onChange={(event) => setDraft((current) => ({ ...current, budgetUsd: event.target.value }))}
                            placeholder={recipe.defaultBudgetUsd}
                          />
                        </div>

                        <div>
                          <label className="pd-label" htmlFor="sortie-duration">Time ceiling (minutes)</label>
                          <input
                            id="sortie-duration"
                            className="pd-input font-mono"
                            value={draft.maxDurationMinutes}
                            onChange={(event) => setDraft((current) => ({ ...current, maxDurationMinutes: event.target.value }))}
                            placeholder={recipe.defaultDurationMinutes}
                          />
                        </div>

                        <div>
                          <label className="pd-label" htmlFor="sortie-approval">Approval mode</label>
                          <select
                            id="sortie-approval"
                            className="pd-select"
                            value={draft.approvalMode}
                            onChange={(event) => setDraft((current) => ({ ...current, approvalMode: event.target.value as ApprovalMode }))}
                          >
                            {Object.entries(APPROVAL_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="pd-label" htmlFor="sortie-identity">Identity</label>
                          <input
                            id="sortie-identity"
                            className="pd-input font-mono"
                            value={draft.identity}
                            onChange={(event) => setDraft((current) => ({ ...current, identity: event.target.value }))}
                            placeholder={buildSuggestedIdentity(project, recipe, draft.goal)}
                          />
                          <div className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                            Using <span style={{ color: 'var(--pd-text)' }}>{effectiveIdentity}</span> for budget attribution.
                          </div>
                        </div>

                        <div className="lg:col-span-2">
                          <label className="pd-label" htmlFor="sortie-tools">Allowed tools override</label>
                          <input
                            id="sortie-tools"
                            className="pd-input font-mono"
                            value={draft.allowedTools}
                            onChange={(event) => setDraft((current) => ({ ...current, allowedTools: event.target.value }))}
                            placeholder="Read,Grep,Glob,Bash(npm test*)"
                          />
                        </div>
                      </div>
                    </section>

                    <section className="pd-card-muted p-4">
                      <div className="pd-kicker">Generated coordinating brief</div>
                      <pre
                        className="pd-card-inset mt-3 overflow-x-auto p-4 text-[11px] leading-relaxed"
                        style={{ whiteSpace: 'pre-wrap', color: 'var(--pd-dim)' }}
                      >
                        {missionPrompt}
                      </pre>
                    </section>
                  </div>

                  <div className="space-y-4">
                    <section className="pd-card-muted p-4">
                      <div className="pd-kicker">Roster preview</div>
                      <div className="mt-3 space-y-2">
                        {recipe.roster.map((role, index) => (
                          <div key={role} className="pd-card-inset flex items-center justify-between p-3">
                            <div className="flex items-center gap-3">
                              <span className="rounded-full px-2 py-1 text-[11px] font-semibold" style={{ backgroundColor: 'var(--pd-surface-2)', color: 'var(--pd-accent)' }}>
                                {index + 1}
                              </span>
                              <div>
                                <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>{role}</div>
                                <div className="text-xs" style={{ color: 'var(--pd-muted)' }}>{recipe.steps[Math.min(index, recipe.steps.length - 1)]}</div>
                              </div>
                            </div>
                            <Bot size={14} style={{ color: 'var(--pd-muted)' }} />
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                        The runtime still launches one coordinating agent. The roster is explicit mission intent, not yet first-class parallel execution.
                      </div>
                    </section>

                    <section className="pd-card-muted p-4">
                      <div className="pd-kicker">Launch plan</div>
                      <div className="mt-3 space-y-3 text-sm">
                        {selectedBackend && selectedBackend.readinessStatus !== 'ready' && !preflight && (
                          <div className="pd-card-inset p-3 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                            <div className="font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--pd-text)' }}>
                              {selectedBackend.readinessStatus === 'needs_setup' ? 'Needs setup' : 'Manual check'}
                            </div>
                            <div className="mt-2">{selectedBackend.readinessSummary}</div>
                            {selectedBackend.readinessNextStep && (
                              <div className="mt-2">Next: {selectedBackend.readinessNextStep}</div>
                            )}
                          </div>
                        )}

                        {preflightError && (
                          <div className="pd-card-inset p-3 text-xs leading-relaxed" style={{ color: 'var(--pd-accent)' }}>
                            Preflight unavailable: {preflightError}
                          </div>
                        )}

                        {preflight && (
                          <div
                            className="pd-card-inset p-3 text-xs leading-relaxed"
                            style={{
                              borderColor: launchBlocked ? 'var(--pd-accent-border)' : 'var(--pd-border)',
                              backgroundColor: launchBlocked ? 'var(--pd-accent-surface)' : undefined,
                              color: 'var(--pd-muted)',
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--pd-text)' }}>
                                Readiness
                              </div>
                              <span className={`pd-chip ${launchBlocked ? 'pd-chip-accent' : 'pd-chip-success'}`}>
                                {preflight.launchReady ? 'Ready' : 'Blocked'}
                              </span>
                            </div>

                            <div className="mt-3 space-y-2">
                              {preflight.attempts.map((attempt) => (
                                <div key={attempt.attempt} className="flex items-start justify-between gap-3">
                                  <div>
                                    <div style={{ color: 'var(--pd-text)' }}>
                                      Attempt {attempt.attempt}: {attempt.backend || 'missing'} / {attempt.model || (attempt.modelTier ? `${attempt.modelTier} tier` : 'default')}
                                    </div>
                                    <div className="mt-1">{attempt.readinessSummary}</div>
                                  </div>
                                  <span className={`pd-chip ${attempt.readinessStatus === 'ready' ? 'pd-chip-success' : 'pd-chip-warning'}`}>
                                    {attempt.readinessStatus}
                                  </span>
                                </div>
                              ))}
                            </div>

                            {preflight.budget && (
                              <div className="mt-3 pd-card-muted p-3 text-[11px]">
                                <div className="flex items-center gap-2" style={{ color: 'var(--pd-text)' }}>
                                  <Wallet size={12} />
                                  Budget: ${preflight.budget.spentUsd.toFixed(2)} / ${preflight.budget.budgetUsdPerDay.toFixed(2)}
                                </div>
                                <div className="mt-2" style={{ color: 'var(--pd-muted)' }}>
                                  {preflight.budget.percentUsed.toFixed(1)}% used {preflight.budget.overBudget ? 'and over cap.' : 'with room left.'}
                                </div>
                              </div>
                            )}

                            {preflight.blockedReasons.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {preflight.blockedReasons.map((reason) => (
                                  <div key={reason} className="flex items-start gap-2" style={{ color: 'var(--pd-text)' }}>
                                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                                    <span>{reason}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {preflight.localExecutionNote && (
                              <div className="mt-3" style={{ color: 'var(--pd-muted)' }}>
                                {preflight.localExecutionNote}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="pd-card-muted p-4">
                      <div className="grid gap-3">
                        <SummaryStat icon={Wallet} label="Budget ceiling" value={`$${draft.budgetUsd || recipe.defaultBudgetUsd}`} />
                        <SummaryStat icon={Clock3} label="Time ceiling" value={`${draft.maxDurationMinutes || recipe.defaultDurationMinutes} min`} />
                        <SummaryStat icon={ShieldCheck} label="Approval mode" value={APPROVAL_LABELS[draft.approvalMode]} />
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="pd-button pd-button-primary flex-1"
                          onClick={() => void handleLaunch()}
                          disabled={launching || launchBlocked}
                        >
                          {launching ? <RefreshCw size={14} className="animate-spin" /> : <Rocket size={14} />}
                          {launching ? 'Launching mission…' : 'Launch mission'}
                        </button>
                        <button
                          type="button"
                          className="pd-button pd-button-secondary"
                          onClick={() => {
                            setLaunchError(null);
                            setDraft(createInitialDraft(project));
                            setPreflight(null);
                            setPreflightError(null);
                          }}
                        >
                          Reset
                        </button>
                      </div>
                    </section>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MissionListSection({
  title,
  empty,
  sorties,
  selectedMissionId,
  onSelect,
}: {
  title: string;
  empty: string;
  sorties: SpawnedAgent[];
  selectedMissionId: MissionSelection;
  onSelect: (id: MissionSelection) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="pd-kicker">{title}</div>
      {sorties.length === 0 ? (
        <div className="pd-card-inset p-3 text-xs" style={{ color: 'var(--pd-muted)' }}>{empty}</div>
      ) : (
        <div className="space-y-2">
          {sorties.map((sortie) => {
            const tone = toneForStatus(sortie.status);
            const Icon = tone.icon;
            const recipe = recipeForMission(sortie);
            return (
              <button
                key={sortie.agentId}
                type="button"
                onClick={() => onSelect(sortie.agentId)}
                className="pd-card-muted w-full p-3 text-left transition-colors"
                style={{
                  borderColor: selectedMissionId === sortie.agentId ? 'var(--pd-accent-border)' : 'var(--pd-border)',
                  backgroundColor: selectedMissionId === sortie.agentId ? 'var(--pd-surface-hover)' : undefined,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon size={12} style={{ color: 'var(--pd-text)' }} />
                      <span className="truncate text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
                        {sortie.purpose || sortie.identity || sortie.agentId}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={`pd-chip ${tone.chipClass}`}>{tone.label}</span>
                      {recipe && <span className="pd-chip pd-chip-neutral">{recipe.label}</span>}
                    </div>
                    <div className="mt-2 text-[11px]" style={{ color: 'var(--pd-muted)' }}>
                      {sortie.backend}{sortie.model ? ` · ${sortie.model}` : ''} · {formatRelative(sortie.startedAt)}
                    </div>
                  </div>
                  <ArrowRight size={14} style={{ color: 'var(--pd-muted)' }} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function MissionDetail({
  mission,
  onBack,
  onCancel,
}: {
  mission: SpawnedAgent;
  onBack: () => void;
  onCancel: () => void;
}) {
  const tone = toneForStatus(mission.status);
  const Icon = tone.icon;
  const recipe = recipeForMission(mission);

  return (
    <div className="space-y-4">
      <section className="pd-card overflow-hidden">
        <div className="border-b px-5 py-4" style={{ borderColor: 'var(--pd-border)' }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="pd-kicker">Mission detail</div>
              <div className="mt-1 text-xl font-semibold tracking-tight" style={{ color: 'var(--pd-text)' }}>
                {mission.purpose || mission.identity || mission.agentId}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={`pd-chip ${tone.chipClass}`}>
                  <Icon size={12} />
                  {tone.label}
                </span>
                {recipe && <span className="pd-chip pd-chip-neutral">{recipe.label}</span>}
                <span className="pd-chip pd-chip-neutral">{mission.backend}{mission.model ? ` · ${mission.model}` : ''}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="pd-button pd-button-secondary" onClick={onBack}>
                <ArrowRight size={14} className="rotate-180" />
                Draft
              </button>
              {mission.status === 'running' && (
                <button type="button" className="pd-button pd-button-danger" onClick={onCancel}>
                  <X size={14} />
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1.4fr)_320px]">
          <div className="space-y-4">
            <section className="pd-card-muted p-4">
              <div className="pd-kicker">Mission story</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <SummaryStat icon={Clock3} label="Started" value={formatTimestamp(mission.startedAt)} />
                <SummaryStat icon={CheckCircle2} label="Completed" value={formatTimestamp(mission.completedAt)} />
                <SummaryStat icon={Bot} label="Spawn id" value={mission.agentId.slice(0, 12)} />
                <SummaryStat icon={ClipboardList} label="Identity" value={mission.identity || 'Not recorded'} />
              </div>
            </section>

            <section className="pd-card-muted p-4">
              <div className="pd-kicker">Runtime truth</div>
              <div className="mt-3 space-y-3 text-sm leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                <div>
                  This mission detail is backed by the current spawn registry. It shows live or recent spawned agents, not yet a first-class sortie ledger.
                </div>
                <div>
                  Persistent artifacts, approval checkpoints, and multi-agent handoff timelines still need the dedicated sortie mission object from the recovery plan.
                </div>
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <section className="pd-card-muted p-4">
              <div className="pd-kicker">What happened</div>
              <div className="mt-3 space-y-3">
                <div className="pd-card-inset p-3 text-sm leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                  {mission.purpose || 'No mission summary was recorded for this sortie.'}
                </div>
                <div className="pd-card-inset p-3 text-sm leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                  Status is sourced from the spawned agent registry. If you need a durable mission briefing, the current gap is the sortie state/API slice in the recovery plan.
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
}) {
  return (
    <div className="pd-card-inset p-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--pd-muted)' }}>
        <Icon size={12} />
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold leading-snug" style={{ color: 'var(--pd-text)' }}>
        {value}
      </div>
    </div>
  );
}
