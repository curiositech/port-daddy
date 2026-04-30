import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  FileCog,
  Gauge,
  KeyRound,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  ShipWheel,
  WalletCards,
  Wrench,
} from 'lucide-react';
import { fetchModels, fetchResourceOverview, saveBackendSecrets } from '../api';
import type { BackendInfo, ResourceOverview } from '../types';
import BackendSetupActions from './BackendSetupActions';

interface ProjectInfo {
  id: string;
  name: string;
  logicalId?: string;
  fleetPath: string;
  projectDir: string;
  running?: boolean;
  agents: Array<{ agentName: string; status: string }>;
  configuredAgentCount?: number;
  configuredWatcherCount?: number;
  signals?: string[];
  sources?: string[];
  operatorState?: 'running' | 'ready' | 'blocked' | 'service_only' | 'context_only' | 'missing';
  operatorSummary?: string;
  operatorNextAction?: string;
  fleetConfigStatus?: 'ready' | 'missing_budget' | 'invalid' | 'missing';
  budgetUsdPerDay?: number | null;
  configError?: string | null;
  configWarnings?: string[];
  remediation?: {
    action: 'start_fleet' | 'set_budget' | 'fix_yaml' | 'create_fleet' | 'run_scan';
    title: string;
    detail: string;
    command?: string;
    suggestedBudgetUsdPerDay?: number;
  } | null;
}

interface Props {
  projects: ProjectInfo[];
  selected: string | null;
  onSelect: (id: string) => void;
  onStartProject?: (project: ProjectInfo) => void;
  onSetBudget?: (project: ProjectInfo, usdPerDay: number) => void;
  onOpenYaml?: (project: ProjectInfo) => void;
  onOpenShipwright?: () => void;
}

interface AllProjectsProps {
  projects: ProjectInfo[];
  onSelect: (id: string) => void;
  onStartProject?: (project: ProjectInfo) => void;
  onSetBudget?: (project: ProjectInfo, usdPerDay: number) => void;
  onOpenYaml?: (project: ProjectInfo) => void;
  onOpenShipwright?: () => void;
}

type OperatorTone = 'accent' | 'danger' | 'neutral' | 'success' | 'warning';
type IconComponent = typeof AlertTriangle;

interface EntranceMetric {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: OperatorTone;
  Icon: IconComponent;
}

interface EntranceAction {
  id: string;
  label: string;
  title: string;
  detail: string;
  actionLabel?: string;
  tone: OperatorTone;
  Icon: IconComponent;
  onClick?: () => void;
}

const ADD_PROJECT_COMMANDS = [
  {
    title: 'Full onboarding',
    caption: 'Install daemon/MCP/FleetBar wiring and register this repo for the control plane.',
    command: 'pd setup --project <project-dir>',
  },
  {
    title: 'Starter fleet',
    caption: 'Write pd-fleet.yml plus the post-commit trigger for a repo that already exists.',
    command: 'cd <project-dir>\npd fleet init',
  },
  {
    title: 'Service stack',
    caption: 'Use the older .portdaddyrc service config path for pd up / pd down.',
    command: 'cd <project-dir>\npd scan\npd up',
  },
  {
    title: 'Make fleet live',
    caption: 'Start a budgeted project fleet on the current daemon.',
    command: 'cd <project-dir>\npd fleet up',
  },
];

function deployedCount(project: ProjectInfo): number {
  return project.agents.filter((agent) => agent.status !== 'paused').length;
}

function configuredCount(project: ProjectInfo): number {
  return project.configuredAgentCount ?? project.agents.length;
}

function formatBudget(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `$${value.toFixed(2)}/day` : 'no budget';
}

function formatUsd(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : 'measuring';
}

function positiveBudget(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function toneStyle(tone: OperatorTone): { backgroundColor: string; color: string; border: string } {
  if (tone === 'success') {
    return { backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' };
  }
  if (tone === 'warning') {
    return { backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' };
  }
  if (tone === 'danger') {
    return { backgroundColor: 'var(--pd-danger-surface)', color: 'var(--pd-danger)', border: '1px solid var(--pd-danger-border)' };
  }
  if (tone === 'accent') {
    return { backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' };
  }
  return { backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' };
}

function readinessTone(backends: BackendInfo[]): OperatorTone {
  if (backends.length === 0) return 'neutral';
  const blockers = backends.filter((backend) => (backend.readinessStatus ?? 'unknown') !== 'ready');
  if (blockers.some((backend) => backend.readinessStatus === 'needs_setup')) return 'danger';
  if (blockers.length > 0) return 'warning';
  return 'success';
}

function backendStatusLabel(backend: BackendInfo): string {
  if (backend.readinessStatus === 'needs_setup') return 'needs setup';
  if (backend.readinessStatus === 'manual_check') return 'manual check';
  if (backend.readinessStatus === 'ready') return 'ready';
  return 'unknown';
}

function withLandingTimeout<T>(request: Promise<T>, label: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    request.then(resolve, reject).finally(() => window.clearTimeout(timeout));
  });
}

function projectState(project: ProjectInfo): NonNullable<ProjectInfo['operatorState']> {
  if (project.operatorState) return project.operatorState;
  if (project.running) return 'running';
  if (project.fleetConfigStatus === 'ready') return 'ready';
  if (project.fleetConfigStatus === 'missing_budget' || project.fleetConfigStatus === 'invalid') return 'blocked';
  if (project.signals?.includes('config')) return 'service_only';
  return 'missing';
}

function stateLabel(project: ProjectInfo): string {
  switch (projectState(project)) {
    case 'running':
      return 'running';
    case 'ready':
      return 'ready';
    case 'blocked':
      return project.fleetConfigStatus === 'missing_budget' ? 'needs budget' : 'blocked';
    case 'service_only':
      return 'pd up config';
    case 'context_only':
      return 'context only';
    case 'missing':
      return 'needs setup';
  }
}

function stateStyle(project: ProjectInfo): { backgroundColor: string; color: string; border: string } {
  switch (projectState(project)) {
    case 'running':
      return { backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' };
    case 'ready':
      return { backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' };
    case 'blocked':
      return { backgroundColor: 'var(--pd-danger-surface)', color: 'var(--pd-danger)', border: '1px solid var(--pd-danger-border)' };
    case 'service_only':
      return { backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' };
    default:
      return { backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' };
  }
}

function StateIcon({ project }: { project: ProjectInfo }) {
  switch (projectState(project)) {
    case 'running':
      return <Radio size={12} />;
    case 'ready':
      return <CheckCircle2 size={12} />;
    case 'blocked':
      return <AlertTriangle size={12} />;
    case 'service_only':
      return <FileCog size={12} />;
    default:
      return <Wrench size={12} />;
  }
}

async function copyCommand(command: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    window.prompt('Copy this Port Daddy command', command);
    return;
  }
  await navigator.clipboard.writeText(command);
}

function readinessLabel(status: BackendInfo['readinessStatus']): string {
  if (status === 'ready') return 'ready';
  if (status === 'manual_check') return 'check';
  if (status === 'needs_setup') return 'setup';
  return 'unknown';
}

function readinessStyle(status: BackendInfo['readinessStatus']): { backgroundColor: string; color: string; border: string } {
  if (status === 'ready') {
    return { backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' };
  }
  if (status === 'manual_check') {
    return { backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' };
  }
  if (status === 'needs_setup') {
    return { backgroundColor: 'var(--pd-danger-surface)', color: 'var(--pd-danger)', border: '1px solid var(--pd-danger-border)' };
  }
  return { backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' };
}

function credentialKeysForBackend(backend: BackendInfo): string[] {
  if (backend.credentialKeys?.length) return backend.credentialKeys;
  if (backend.id === 'claude') return ['ANTHROPIC_API_KEY'];
  if (backend.id === 'gemini') return ['GEMINI_API_KEY'];
  if (backend.id === 'cloudflare') return ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'];
  return [];
}

function credentialAlternatesForBackend(backend: BackendInfo): string[] {
  if (backend.credentialAlternates?.length) return backend.credentialAlternates;
  if (backend.id === 'gemini') return ['GOOGLE_API_KEY'];
  if (backend.id === 'cloudflare') return ['CLOUDFLARE_API_KEY', 'CF_API_TOKEN', 'CF_ACCOUNT_ID'];
  return [];
}

function setupCommandForBackend(backend: BackendInfo): string {
  if (backend.setupCommand?.trim()) return backend.setupCommand.trim();
  const credentialKeys = credentialKeysForBackend(backend);
  if (credentialKeys.length) {
    const body = credentialKeys.map((key) => `${key}=<paste-value>`).join('\\n');
    return `printf '\\n${body}\\n' >> ~/.port-daddy-env\npd restart`;
  }
  if (backend.id === 'claude-cli') return 'claude';
  if (backend.id === 'codex') return 'codex exec "print ok"';
  if (backend.id === 'ollama') return 'ollama serve';
  if (backend.id === 'aider') return 'aider --help';
  return 'pd fleet models';
}

function BackendReadinessPanel() {
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({});
  const [secretSaving, setSecretSaving] = useState(false);
  const [secretMessage, setSecretMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const models = await fetchModels();
        if (cancelled) return;
        setBackends(models);
        const firstAction = models.find((backend) => backend.readinessStatus !== 'ready') ?? models[0] ?? null;
        setSelectedId((current) => current ?? firstAction?.id ?? null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBackend = useMemo(() => {
    return backends.find((backend) => backend.id === selectedId) ?? backends[0] ?? null;
  }, [backends, selectedId]);

  const needsAttention = backends.filter((backend) => backend.readinessStatus !== 'ready').length;
  const readyCount = backends.length - needsAttention;
  const setupCommand = selectedBackend ? setupCommandForBackend(selectedBackend) : 'pd fleet models';
  const selectedCredentialKeys = selectedBackend ? credentialKeysForBackend(selectedBackend) : [];

  async function saveSelectedSecrets() {
    if (!selectedBackend) return;
    const values = Object.fromEntries(
      selectedCredentialKeys
        .map((key) => [key, secretDraft[key]?.trim() ?? ''] as const)
        .filter(([, value]) => value.length > 0),
    );
    if (Object.keys(values).length === 0) {
      setSecretMessage('Enter at least one value to save.');
      return;
    }

    setSecretSaving(true);
    setSecretMessage(null);
    try {
      const result = await saveBackendSecrets({ backend: selectedBackend.id, values });
      setSecretDraft({});
      setSecretMessage(`${result.savedKeys.join(', ')} saved in ${result.storage.location}.`);
      const models = await fetchModels();
      setBackends(models);
    } catch (err) {
      setSecretMessage((err as Error).message);
    } finally {
      setSecretSaving(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border p-5" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-muted)' }}>
            <KeyRound size={13} />
            <span>Backend readiness</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold" style={{ color: 'var(--pd-text)' }}>
            Keys and local auth before launch
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
            Port Daddy loads credentials from <span style={{ color: 'var(--pd-text)' }}>~/.port-daddy-env</span>, project <span style={{ color: 'var(--pd-text)' }}>.env.local</span>, and project <span style={{ color: 'var(--pd-text)' }}>.env</span>. Restart the daemon after changing them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' }}>
            {readyCount} ready
          </span>
          <span className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ backgroundColor: needsAttention > 0 ? 'var(--pd-warning-surface)' : 'var(--pd-bg)', color: needsAttention > 0 ? 'var(--pd-warning)' : 'var(--pd-muted)', border: `1px solid ${needsAttention > 0 ? 'var(--pd-warning-border)' : 'var(--pd-border)'}` }}>
            {needsAttention} need attention
          </span>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 inline-flex items-center gap-2 text-sm" style={{ color: 'var(--pd-muted)' }}>
          <RefreshCw size={14} />
          Checking backends...
        </div>
      ) : error ? (
        <div className="mt-4 rounded-md border px-3 py-2 text-sm" style={{ backgroundColor: 'var(--pd-danger-surface)', borderColor: 'var(--pd-danger-border)', color: 'var(--pd-danger)' }}>
          {error}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
          <div className="grid gap-2">
            {backends.map((backend) => (
              (() => {
                const credentialKeys = credentialKeysForBackend(backend);
                const credentialAlternates = credentialAlternatesForBackend(backend);
                return (
              <button
                key={backend.id}
                type="button"
                onClick={() => {
                  setSelectedId(backend.id);
                  setSecretDraft({});
                  setSecretMessage(null);
                }}
                className="rounded-lg border px-3 py-3 text-left"
                style={{
                  backgroundColor: selectedBackend?.id === backend.id ? 'var(--pd-surface-2)' : 'var(--pd-bg)',
                  borderColor: selectedBackend?.id === backend.id ? 'var(--pd-accent-border)' : 'var(--pd-border)',
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold" style={{ color: 'var(--pd-text)' }}>{backend.name}</div>
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={readinessStyle(backend.readinessStatus)}>
                    {backend.readinessStatus === 'ready' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                    {readinessLabel(backend.readinessStatus)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                  {backend.readinessSummary ?? 'No readiness probe returned a summary.'}
                </p>
                {(credentialKeys.length || credentialAlternates.length) ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {credentialKeys.map((key) => (
                      <span key={`${backend.id}-${key}`} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}>
                        {key}
                      </span>
                    ))}
                    {credentialAlternates.map((key) => (
                      <span key={`${backend.id}-${key}`} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}>
                        or {key}
                      </span>
                    ))}
                  </div>
                ) : null}
              </button>
                );
              })()
            ))}
          </div>

          <div className="rounded-lg border p-4" style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)' }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-muted)' }}>
                  Setup command
                </div>
                <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
                  {selectedBackend?.name ?? 'Backend probe'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => copyCommand(setupCommand)}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-semibold"
                style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
              >
                <Copy size={12} />
                Copy
              </button>
            </div>
            <pre
              className="mt-3 overflow-x-auto rounded-md px-3 py-3 text-[11px] leading-relaxed"
              style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-dim)', whiteSpace: 'pre-wrap' }}
            >
              {setupCommand}
            </pre>
            {selectedBackend?.readinessNextStep && (
              <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                {selectedBackend.readinessNextStep}
              </p>
            )}
            <BackendSetupActions backend={selectedBackend} />
            {selectedBackend && selectedCredentialKeys.length > 0 ? (
              <div className="mt-4 rounded-md border p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
                <div className="text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-muted)' }}>
                  Encrypted save
                </div>
                <div className="mt-3 grid gap-2">
                  {selectedCredentialKeys.map((key) => (
                    <label key={key} className="grid gap-1 text-[11px] font-semibold" style={{ color: 'var(--pd-muted)' }}>
                      <span>{key}</span>
                      <input
                        value={secretDraft[key] ?? ''}
                        onChange={(event) => setSecretDraft((draft) => ({ ...draft, [key]: event.target.value }))}
                        type={key.includes('TOKEN') || key.includes('KEY') ? 'password' : 'text'}
                        autoComplete="off"
                        spellCheck={false}
                        className="rounded-md border px-2 py-1.5 font-mono text-xs"
                        style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)', color: 'var(--pd-text)' }}
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveSelectedSecrets()}
                    disabled={secretSaving}
                    className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60"
                    style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' }}
                  >
                    <ShieldCheck size={12} />
                    {secretSaving ? 'Saving...' : 'Save'}
                  </button>
                  {secretMessage ? (
                    <span className="text-[11px] leading-relaxed" style={{ color: secretMessage.includes('saved') ? 'var(--pd-success)' : 'var(--pd-warning)' }}>
                      {secretMessage}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function AgentConversationPanel({ onOpenShipwright }: { onOpenShipwright?: () => void }) {
  return (
    <section className="mb-6 rounded-lg border p-5" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-muted)' }}>
            <Radio size={13} />
            <span>Agent radio</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold" style={{ color: 'var(--pd-text)' }}>
            Agents can leave each other usable context
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
            The control plane is the shared room: notes preserve intent, file claims show where hands already are, channels carry live signals, actor inboxes route responsibilities, and salvage lets a new agent continue abandoned work.
          </p>
        </div>
        {onOpenShipwright && (
          <button
            type="button"
            onClick={onOpenShipwright}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
            style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
          >
            <ShipWheel size={13} />
            Start in Shipwright
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {[
          ['Notes', 'Durable progress and decisions'],
          ['Claims', 'Visible edit ownership'],
          ['Channels', 'Scoped live broadcasts'],
          ['Actors', 'Messages to durable roles'],
        ].map(([label, detail]) => (
          <div key={label} className="rounded-lg border px-3 py-3" style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)' }}>
            <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>{label}</div>
            <div className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>{detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectActionButton({
  project,
  onStartProject,
  onSetBudget,
  onOpenYaml,
}: {
  project: ProjectInfo;
  onStartProject?: (project: ProjectInfo) => void;
  onSetBudget?: (project: ProjectInfo, usdPerDay: number) => void;
  onOpenYaml?: (project: ProjectInfo) => void;
}) {
  const remediation = project.remediation;

  if (remediation?.action === 'set_budget') {
    const budget = remediation.suggestedBudgetUsdPerDay ?? 5;
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onSetBudget?.(project, budget);
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
        style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' }}
      >
        <CircleDollarSign size={13} />
        Set ${budget}/day
      </button>
    );
  }

  if (remediation?.action === 'start_fleet' || projectState(project) === 'ready') {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onStartProject?.(project);
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
        style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
      >
        <Play size={13} />
        Start
      </button>
    );
  }

  if (remediation?.action === 'fix_yaml') {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenYaml?.(project);
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
        style={{ backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' }}
      >
        <FileCog size={13} />
        Open YAML
      </button>
    );
  }

  if (remediation?.command) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void copyCommand(remediation.command ?? '');
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
        style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}
      >
        <Copy size={13} />
        Copy steps
      </button>
    );
  }

  return null;
}

function MetricTile({ metric }: { metric: EntranceMetric }) {
  const Icon = metric.Icon;
  const style = toneStyle(metric.tone);

  return (
    <div className="rounded-lg border p-2.5 sm:p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[9px] font-semibold tracking-wider sm:gap-2 sm:text-[10px]" style={{ color: 'var(--pd-dim)' }}>
          <Icon size={13} />
          <span>{metric.label.toUpperCase()}</span>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={style}>
          {metric.tone}
        </span>
      </div>
      <div className="mt-2.5 break-words font-mono text-lg font-semibold tabular-nums sm:mt-3 sm:text-xl" style={{ color: 'var(--pd-text)' }}>
        {metric.value}
      </div>
      <div className="mt-1 min-h-[2.4rem] text-[11px] leading-snug sm:min-h-[2.25rem] sm:text-xs" style={{ color: 'var(--pd-muted)' }}>
        {metric.detail}
      </div>
    </div>
  );
}

function ActionRow({ action }: { action: EntranceAction }) {
  const Icon = action.Icon;
  const style = toneStyle(action.tone);

  return (
    <button
      type="button"
      disabled={!action.onClick}
      onClick={action.onClick}
      className="w-full rounded-lg border p-3 text-left disabled:cursor-default"
      style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)', opacity: action.onClick ? 1 : 0.92 }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={style}>
          <Icon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
            {action.label.toUpperCase()}
          </span>
          <span className="mt-1 block text-sm font-semibold leading-snug" style={{ color: 'var(--pd-text)' }}>
            {action.title}
          </span>
          <span
            className="mt-1 block text-xs leading-snug"
            style={{
              color: 'var(--pd-muted)',
              display: '-webkit-box',
              overflow: 'hidden',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
            }}
          >
            {action.detail}
          </span>
        </span>
        {action.actionLabel && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold" style={style}>
            <span>{action.actionLabel}</span>
            <ArrowRight size={11} />
          </span>
        )}
      </div>
    </button>
  );
}

export default function ProjectPicker({ projects, selected, onSelect, onStartProject, onSetBudget, onOpenYaml }: Props) {
  const active = projects.find(p => p.id === selected);
  const rest = projects.filter(p => p.id !== selected);

  return (
    <div className="flex flex-col gap-2 pt-1">
      {active && (
        <motion.div layoutId={`project-${active.id}`} onClick={() => onSelect(active.id)}
          className="relative cursor-pointer rounded-lg border px-4 py-3"
          style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-accent)', borderWidth: 1.5 }}
          whileHover={{ scale: 1.01 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono font-bold text-sm" style={{ color: 'var(--pd-accent)' }}>{active.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={stateStyle(active)}>
              <StateIcon project={active} />
              {stateLabel(active)}
            </span>
          </div>
          <div className="text-[10px] mt-0.5 font-mono truncate" style={{ color: 'var(--pd-muted)' }}>{active.fleetPath}</div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[10px]" style={{ color: 'var(--pd-muted)' }}>
            <span>{configuredCount(active)} configured · {deployedCount(active)} deployed</span>
            <span>{formatBudget(active.budgetUsdPerDay)}</span>
          </div>
          <div className="mt-2">
            <ProjectActionButton project={active} onStartProject={onStartProject} onSetBudget={onSetBudget} onOpenYaml={onOpenYaml} />
          </div>
        </motion.div>
      )}

      <div className="relative" style={{ height: rest.length * 40 + 8 }}>
        <AnimatePresence>
          {rest.map((p, i) => (
            <motion.div key={p.id} layoutId={`project-${p.id}`} onClick={() => onSelect(p.id)}
              className="absolute w-full cursor-pointer rounded-lg border px-4 py-2"
              style={{ backgroundColor: 'var(--pd-surface-2)', borderColor: 'var(--pd-border)', top: i * 40, zIndex: rest.length - i }}
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1 - i * 0.12, y: 0, scale: 1 - i * 0.015 }}
              exit={{ opacity: 0, y: -8 }}
              whileHover={{ borderColor: 'var(--pd-muted)', scale: 1.01 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30, delay: i * 0.04 }}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-sm" style={{ color: 'var(--pd-muted)' }}>{p.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={stateStyle(p)}>
                  <StateIcon project={p} />
                  {stateLabel(p)}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function AllProjectsList({ projects, onSelect, onStartProject, onSetBudget, onOpenYaml, onOpenShipwright }: AllProjectsProps) {
  const [overview, setOverview] = useState<ResourceOverview | null>(null);
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [liveDataError, setLiveDataError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const totalAgents = projects.reduce((n, p) => n + configuredCount(p), 0);
  const totalActive = projects.reduce((n, p) => n + deployedCount(p), 0);
  const blockedProjects = projects.filter(p => projectState(p) === 'blocked');
  const readyProjects = projects.filter(p => projectState(p) === 'ready');
  const runningProjects = projects.filter(p => projectState(p) === 'running');
  const serviceOnly = projects.filter(p => projectState(p) === 'service_only').length;
  const budgetedProjects = projects.filter((project) => positiveBudget(project.budgetUsdPerDay) > 0);
  const totalDailyCap = projects.reduce((sum, project) => sum + positiveBudget(project.budgetUsdPerDay), 0);
  const missingBudgetProjects = projects.filter((project) => project.fleetConfigStatus === 'missing_budget');
  const invalidConfigProjects = projects.filter((project) => project.fleetConfigStatus === 'invalid');
  const backendBlockers = backends.filter((backend) => (backend.readinessStatus ?? 'unknown') !== 'ready');
  const readyBackends = backends.length - backendBlockers.length;
  const resourceUnavailable = !overview && !!liveDataError?.includes('resources:');
  const readinessUnavailable = backends.length === 0 && !!liveDataError?.includes('readiness:');
  const dailySpend = overview?.cost.dailySpendUsd ?? 0;
  const remainingBudget = totalDailyCap > 0 ? Math.max(0, totalDailyCap - dailySpend) : null;
  const runningProjectCount = overview?.fleet.runningProjects ?? runningProjects.length;
  const launchableAgents = overview?.fleet.launchableAgents ?? totalActive;
  const visibleAgents = overview?.fleet.totalAgents ?? totalAgents;
  const spendTone: OperatorTone = totalDailyCap <= 0
    ? 'warning'
    : dailySpend > totalDailyCap
      ? 'danger'
      : dailySpend > totalDailyCap * 0.8
        ? 'warning'
        : 'success';

  const refreshLandingData = useCallback(async () => {
    setRefreshing(true);
    const [overviewResult, modelsResult] = await Promise.allSettled([
      withLandingTimeout(fetchResourceOverview(), 'resource governance'),
      withLandingTimeout(fetchModels(), 'backend readiness'),
    ]);
    const errors: string[] = [];

    if (overviewResult.status === 'fulfilled') {
      setOverview(overviewResult.value);
    } else {
      errors.push(`resources: ${overviewResult.reason instanceof Error ? overviewResult.reason.message : String(overviewResult.reason)}`);
    }

    if (modelsResult.status === 'fulfilled') {
      setBackends(modelsResult.value);
    } else {
      errors.push(`readiness: ${modelsResult.reason instanceof Error ? modelsResult.reason.message : String(modelsResult.reason)}`);
    }

    setLiveDataError(errors.length > 0 ? errors.join(' | ') : null);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void refreshLandingData();
    const interval = window.setInterval(() => void refreshLandingData(), 15000);
    return () => window.clearInterval(interval);
  }, [refreshLandingData]);

  const metrics = useMemo<EntranceMetric[]>(() => [
    {
      id: 'budget-envelope',
      label: 'Budget envelope',
      value: totalDailyCap > 0 ? `${resourceUnavailable ? 'spend ?' : formatUsd(dailySpend)} / ${formatUsd(totalDailyCap)}` : formatUsd(dailySpend),
      detail: resourceUnavailable && totalDailyCap > 0
        ? `Live spend is unavailable; ${budgetedProjects.length} project caps total ${formatUsd(totalDailyCap)}/day.`
        : totalDailyCap > 0
        ? `${formatUsd(remainingBudget)} left today across ${budgetedProjects.length} budgeted project${budgetedProjects.length === 1 ? '' : 's'}.`
        : 'No daily cap is configured; agentic launches fail closed until a budget exists.',
      tone: resourceUnavailable ? 'warning' : spendTone,
      Icon: WalletCards,
    },
    {
      id: 'launchable',
      label: 'Launchable',
      value: `${launchableAgents}/${visibleAgents}`,
      detail: `${runningProjectCount} running project${runningProjectCount === 1 ? '' : 's'}; ${totalActive} deployed agents in visible fleets.`,
      tone: launchableAgents > 0 ? 'success' : readyProjects.length > 0 ? 'accent' : 'neutral',
      Icon: Gauge,
    },
    {
      id: 'readiness',
      label: 'Readiness',
      value: readinessUnavailable ? 'timeout' : backends.length > 0 ? `${readyBackends}/${backends.length}` : 'measuring',
      detail: readinessUnavailable
        ? 'Backend readiness did not return before the entrance timeout.'
        : backendBlockers.length > 0
        ? `${backendBlockers.length} backend${backendBlockers.length === 1 ? '' : 's'} blocked or manual-check before launch.`
        : backends.length > 0
          ? 'Backend catalog reports launch dependencies ready.'
          : 'Waiting for backend readiness.',
      tone: readinessUnavailable ? 'warning' : readinessTone(backends),
      Icon: ShieldCheck,
    },
    {
      id: 'next-projects',
      label: 'Project queue',
      value: `${blockedProjects.length}/${projects.length}`,
      detail: `${readyProjects.length} ready, ${serviceOnly} service-only, ${missingBudgetProjects.length} missing budget.`,
      tone: blockedProjects.length > 0 ? 'warning' : readyProjects.length > 0 ? 'accent' : 'success',
      Icon: Radio,
    },
  ], [
    backendBlockers.length,
    backends,
    blockedProjects.length,
    budgetedProjects.length,
    dailySpend,
    launchableAgents,
    missingBudgetProjects.length,
    projects.length,
    readyBackends,
    readyProjects.length,
    remainingBudget,
    readinessUnavailable,
    resourceUnavailable,
    runningProjectCount,
    serviceOnly,
    spendTone,
    totalActive,
    totalDailyCap,
    visibleAgents,
  ]);

  const nextActions = useMemo<EntranceAction[]>(() => {
    const actions: EntranceAction[] = [];
    const missingBudget = missingBudgetProjects[0];
    const invalidConfig = invalidConfigProjects[0];
    const readyProject = readyProjects[0];
    const runningProject = runningProjects[0];
    const backendBlocker = backendBlockers[0];

    if (missingBudget) {
      const budget = missingBudget.remediation?.suggestedBudgetUsdPerDay ?? 5;
      actions.push({
        id: `budget-${missingBudget.id}`,
        label: 'budget blocker',
        title: `Set ${formatUsd(budget)}/day for ${missingBudget.name}`,
        detail: missingBudget.remediation?.detail ?? 'This fleet has agents but no daily cap, so Port Daddy blocks launches.',
        actionLabel: 'Set cap',
        tone: 'warning',
        Icon: CircleDollarSign,
        onClick: onSetBudget ? () => onSetBudget(missingBudget, budget) : undefined,
      });
    }

    if (invalidConfig) {
      actions.push({
        id: `yaml-${invalidConfig.id}`,
        label: 'config blocker',
        title: `Fix fleet YAML for ${invalidConfig.name}`,
        detail: invalidConfig.configError ?? invalidConfig.remediation?.detail ?? 'The daemon could not validate this project fleet config.',
        actionLabel: 'Open YAML',
        tone: 'danger',
        Icon: FileCog,
        onClick: onOpenYaml ? () => onOpenYaml(invalidConfig) : undefined,
      });
    }

    if (backendBlocker) {
      actions.push({
        id: `backend-${backendBlocker.id}`,
        label: backendStatusLabel(backendBlocker),
        title: `${backendBlocker.name} is not launch-ready`,
        detail: backendBlocker.readinessNextStep ?? backendBlocker.readinessSummary ?? 'Resolve backend readiness before assigning new work.',
        tone: backendBlocker.readinessStatus === 'needs_setup' ? 'danger' : 'warning',
        Icon: AlertTriangle,
      });
    }

    if (overview?.policy.escalation.recommended) {
      actions.push({
        id: 'resource-escalation',
        label: 'governance',
        title: overview.policy.escalation.title,
        detail: overview.policy.escalation.body,
        actionLabel: onOpenShipwright ? 'Rehearse' : undefined,
        tone: 'warning',
        Icon: ShieldCheck,
        onClick: onOpenShipwright,
      });
    }

    if (readyProject) {
      actions.push({
        id: `start-${readyProject.id}`,
        label: 'ready fleet',
        title: `Start ${readyProject.name}`,
        detail: readyProject.operatorNextAction ?? 'The fleet has a budget envelope and can be started on this daemon.',
        actionLabel: 'Start',
        tone: 'accent',
        Icon: Play,
        onClick: onStartProject ? () => onStartProject(readyProject) : undefined,
      });
    } else if (runningProject) {
      actions.push({
        id: `inspect-${runningProject.id}`,
        label: 'running now',
        title: `Inspect ${runningProject.name}`,
        detail: runningProject.operatorSummary ?? 'Open the running fleet to inspect agents, channels, and recent activity.',
        actionLabel: 'Open',
        tone: 'success',
        Icon: Radio,
        onClick: () => onSelect(runningProject.id),
      });
    }

    if (onOpenShipwright) {
      actions.push({
        id: 'shipwright',
        label: 'where next',
        title: 'Open Shipwright budget planning',
        detail: 'Review daily cap, agent budgets, bond ceiling, and dry-run evidence before shaping the next fleet.',
        actionLabel: 'Shipwright',
        tone: 'neutral',
        Icon: ArrowRight,
        onClick: onOpenShipwright,
      });
    }

    if (actions.length === 0) {
      actions.push({
        id: 'select-project',
        label: 'where next',
        title: projects[0] ? `Open ${projects[0].name}` : 'Add a project',
        detail: projects[0]?.operatorNextAction ?? 'Bring a repo into Port Daddy before assigning fleet work.',
        actionLabel: projects[0] ? 'Open' : undefined,
        tone: 'neutral',
        Icon: Wrench,
        onClick: projects[0] ? () => onSelect(projects[0].id) : undefined,
      });
    }

    return actions.slice(0, 5);
  }, [
    backendBlockers,
    invalidConfigProjects,
    missingBudgetProjects,
    onOpenShipwright,
    onOpenYaml,
    onSelect,
    onSetBudget,
    onStartProject,
    overview?.policy.escalation,
    projects,
    readyProjects,
    runningProjects,
  ]);

  const priorityProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const order = { running: 0, blocked: 1, ready: 2, service_only: 3, context_only: 4, missing: 5 } as const;
      const aState = projectState(a);
      const bState = projectState(b);
      if (order[aState] !== order[bState]) return order[aState] - order[bState];
      return a.name.localeCompare(b.name);
    });
  }, [projects]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }} className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>FLEET CONTROL CENTER</div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl" style={{ color: 'var(--pd-text)' }}>Operator entrance</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--pd-muted)' }}>
            {totalActive} deployed · {totalAgents} configured · {blockedProjects.length} blocked · {readyProjects.length} ready
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshLandingData()}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
        >
          <RefreshCw size={13} />
          <span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.82fr)]">
        <section className="grid grid-cols-2 gap-2 sm:gap-3 2xl:grid-cols-4" aria-label="Fleet control center live numbers">
          {metrics.map((metric) => (
            <MetricTile key={metric.id} metric={metric} />
          ))}
        </section>

        <section className="rounded-lg border p-3" style={{ backgroundColor: 'var(--pd-surface-2)', borderColor: 'var(--pd-border)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>NEXT ACTIONS</div>
            {liveDataError && (
              <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={toneStyle('warning')}>
                partial data
              </span>
            )}
          </div>
          <div className="mt-3 grid gap-2">
            {nextActions.map((action) => (
              <ActionRow key={action.id} action={action} />
            ))}
          </div>
          {backendBlockers.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {backendBlockers.slice(1, 4).map((backend) => (
                <span key={backend.id} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={toneStyle(backend.readinessStatus === 'needs_setup' ? 'danger' : 'warning')}>
                  {backend.name}: {backendStatusLabel(backend)}
                </span>
              ))}
            </div>
          )}
          {liveDataError && (
            <div className="mt-2 line-clamp-2 text-[10px]" style={{ color: 'var(--pd-warning)' }}>
              {liveDataError}
            </div>
          )}
        </section>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.85fr)]">
        <BackendReadinessPanel />
        <AgentConversationPanel onOpenShipwright={onOpenShipwright} />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {priorityProjects.map((p, i) => {
          const activeCount = deployedCount(p);
          const warningCount = p.configWarnings?.length ?? 0;
          return (
            <motion.div key={p.id} layoutId={`project-${p.id}`} onClick={() => onSelect(p.id)}
              className="cursor-pointer rounded-lg border px-4 py-3"
              style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, type: 'spring', stiffness: 300, damping: 28 }}
              whileHover={{ borderColor: 'var(--pd-accent)', scale: 1.005 }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono font-bold" style={{ color: 'var(--pd-text)' }}>{p.name}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold" style={stateStyle(p)}>
                      <StateIcon project={p} />
                      {stateLabel(p)}
                    </span>
                    {warningCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' }}>
                        <AlertTriangle size={11} />
                        {warningCount} warning{warningCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px]" style={{ color: 'var(--pd-muted)' }}>{p.fleetPath}</div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-xs" style={{ color: 'var(--pd-muted)' }}>
                    {configuredCount(p)} configured · {activeCount} deployed · {formatBudget(p.budgetUsdPerDay)}
                  </span>
                  <ProjectActionButton project={p} onStartProject={onStartProject} onSetBudget={onSetBudget} onOpenYaml={onOpenYaml} />
                </div>
              </div>

              <div className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--pd-text)' }}>
                {p.operatorSummary ?? 'No operator summary available.'}
              </div>
              <div className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                {p.operatorNextAction ?? 'Select this project to inspect it.'}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {(p.signals ?? []).map((signal) => (
                  <span
                    key={`${p.id}-${signal}`}
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}
                  >
                    {signal}
                  </span>
                ))}
                {(p.sources ?? []).map((source) => (
                  <span
                    key={`${p.id}-${source}`}
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
                  >
                    {source}
                  </span>
                ))}
              </div>

              {p.remediation?.command && projectState(p) !== 'ready' && (
                <pre
                  className="mt-3 overflow-x-auto rounded-md px-3 py-2 text-[11px] leading-relaxed"
                  style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-dim)', whiteSpace: 'pre-wrap' }}
                >
                  {p.remediation.command}
                </pre>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-8 rounded-lg border p-5" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-muted)' }}>
              Add project
            </div>
            <h2 className="mt-2 text-lg font-semibold" style={{ color: 'var(--pd-text)' }}>
              Bring another repo into the control plane
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
              Repos become visible through durable markers: <span style={{ color: 'var(--pd-text)' }}>pd-fleet.yml</span>, <span style={{ color: 'var(--pd-text)' }}>.portdaddyrc</span>, or a real <span style={{ color: 'var(--pd-text)' }}>.portdaddy/</span> state directory.
            </p>
          </div>
          <div className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)' }}>
            Click to copy
          </div>
          {onOpenShipwright && (
            <button
              type="button"
              onClick={onOpenShipwright}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
              style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
            >
              <ShipWheel size={13} />
              Open Shipwright
            </button>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {ADD_PROJECT_COMMANDS.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border p-4"
              style={{ backgroundColor: 'var(--pd-surface-2)', borderColor: 'var(--pd-border)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold" style={{ color: 'var(--pd-text)' }}>{item.title}</div>
                  <div className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>{item.caption}</div>
                </div>
                <button
                  type="button"
                  onClick={() => copyCommand(item.command)}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-semibold"
                  style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
                >
                  <Copy size={12} />
                  Copy
                </button>
              </div>
              <pre
                className="mt-3 overflow-x-auto rounded-md px-3 py-3 text-[11px] leading-relaxed"
                style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-dim)', whiteSpace: 'pre-wrap' }}
              >
                {item.command}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
