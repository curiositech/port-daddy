import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Cpu, HardDrive, Monitor, Network, RefreshCw, ServerCog, ShieldCheck, SlidersHorizontal, Sparkles } from 'lucide-react';
import { fetchModels, fetchResourceOverview, setFleetConfigRuntime } from '../api';
import type { BackendInfo, FleetLimits, ResourceBucket, ResourceOverview, ResourceSample, ResourceStatus } from '../types';

interface ResourceGovernancePanelProps {
  projectDir?: string;
  limits?: FleetLimits;
  onOpenYaml?: () => void;
  onRuntimeChanged?: () => void;
}

const BUCKET_ICONS: Record<ResourceBucket['id'], typeof Cpu> = {
  memory: Cpu,
  disk: HardDrive,
  'port-daddy': ServerCog,
  network: Network,
  rendering: Monitor,
  'local-ai': Sparkles,
  fleet: ShieldCheck,
};

function statusColors(status: ResourceStatus): { fg: string; bg: string; border: string } {
  if (status === 'critical' || status === 'hot') {
    return { fg: 'var(--pd-accent)', bg: 'var(--pd-accent-surface)', border: 'var(--pd-accent-border)' };
  }
  if (status === 'busy') {
    return { fg: 'var(--pd-warning)', bg: 'var(--pd-warning-surface)', border: 'var(--pd-warning-border)' };
  }
  return { fg: 'var(--pd-success)', bg: 'var(--pd-success-surface)', border: 'var(--pd-success-border)' };
}

function plainStatus(status: ResourceStatus): string {
  if (status === 'critical') return 'needs attention';
  if (status === 'hot') return 'running hot';
  if (status === 'busy') return 'getting busy';
  return 'comfortable';
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  const gib = value / (1024 ** 3);
  if (gib >= 1) return `${gib.toFixed(gib >= 10 ? 0 : 1)} GB`;
  return `${Math.max(1, value / (1024 ** 2)).toFixed(0)} MB`;
}

function formatBucketValue(bucket: ResourceBucket): string {
  if (bucket.unit === 'bytes') return formatBytes(bucket.value);
  if (bucket.unit === 'usd') return `$${bucket.value.toFixed(2)}`;
  if (bucket.unit === 'percent') return `${bucket.value.toFixed(0)}%`;
  if (bucket.unit === 'cpu') return `${bucket.value.toFixed(1)}% CPU`;
  return `${bucket.value}`;
}

function formatLimit(bucket: ResourceBucket): string {
  if (!bucket.limit) return 'observed';
  if (bucket.unit === 'bytes') return formatBytes(bucket.limit);
  if (bucket.unit === 'usd') return `$${bucket.limit.toFixed(2)}`;
  if (bucket.unit === 'percent') return `${bucket.limit.toFixed(0)}%`;
  return `${bucket.limit}`;
}

function isBackendReady(backend: BackendInfo): boolean {
  return backend.launchable ?? backend.readinessStatus === 'ready';
}

function sampleValue(bucketId: ResourceBucket['id'], sample: ResourceSample): number | null {
  if (bucketId === 'memory') return sample.memoryUsedRatio * 100;
  if (bucketId === 'disk') return sample.diskUsedRatio === null ? null : sample.diskUsedRatio * 100;
  if (bucketId === 'port-daddy') return sample.portDaddyRssBytes;
  if (bucketId === 'network') return sample.activePorts;
  if (bucketId === 'rendering') return sample.rendererRssBytes;
  if (bucketId === 'local-ai') return sample.localAiRssBytes;
  return sample.activeAgents;
}

function Sparkline({ bucket, samples }: { bucket: ResourceBucket; samples: ResourceSample[] }) {
  const values = samples
    .map((sample) => sampleValue(bucket.id, sample))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const colors = statusColors(bucket.status);

  if (values.length < 2) {
    return <div className="h-10 rounded-md" style={{ backgroundColor: 'var(--pd-surface-3)', border: '1px solid var(--pd-border)' }} />;
  }

  const max = Math.max(...values, bucket.limit ?? 0, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
    const y = 34 - ((value - min) / range) * 28;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  return (
    <svg viewBox="0 0 100 40" className="h-10 w-full" role="img" aria-label={`${bucket.label} usage over time`}>
      <path d="M0 36 H100" stroke="var(--pd-border)" strokeWidth="1" />
      <polyline fill="none" stroke={colors.fg} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

function BucketCard({ bucket, samples }: { bucket: ResourceBucket; samples: ResourceSample[] }) {
  const Icon = BUCKET_ICONS[bucket.id];
  const colors = statusColors(bucket.status);
  return (
    <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
            <Icon size={13} />
            <span>{bucket.label.toUpperCase()}</span>
          </div>
          <div className="mt-1 truncate text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
            {bucket.plainLabel}
          </div>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold"
          style={{ color: colors.fg, backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}
        >
          {plainStatus(bucket.status)}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-lg font-semibold" style={{ color: 'var(--pd-text)' }}>
            {formatBucketValue(bucket)}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--pd-muted)' }}>
            {bucket.percent === null ? formatLimit(bucket) : `${bucket.percent.toFixed(0)}% of ${formatLimit(bucket)}`}
          </div>
        </div>
        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
          {bucket.confidence}
        </span>
      </div>
      <div className="mt-3">
        <Sparkline bucket={bucket} samples={samples} />
      </div>
      <div className="mt-2 text-xs leading-snug" style={{ color: 'var(--pd-muted)' }}>
        {bucket.summary}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {bucket.includes.slice(0, 4).map((item) => (
          <span key={item} className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ color: 'var(--pd-dim)', backgroundColor: 'var(--pd-bg)' }}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ResourceGovernancePanel({ projectDir, limits, onOpenYaml, onRuntimeChanged }: ResourceGovernancePanelProps) {
  const [overview, setOverview] = useState<ResourceOverview | null>(null);
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [runtimeBackend, setRuntimeBackend] = useState('');
  const [runtimeModel, setRuntimeModel] = useState('');
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissedEscalation, setDismissedEscalation] = useState(false);
  const maxConcurrentSpawns = limits?.maxConcurrentSpawns;
  const readyBackends = useMemo(() => backends.filter(isBackendReady), [backends]);
  const selectedRuntimeBackend = readyBackends.find((backend) => backend.id === runtimeBackend) ?? readyBackends[0] ?? null;

  const refresh = async () => {
    setError(null);
    try {
      const next = await fetchResourceOverview({ projectDir, maxConcurrentSpawns });
      setOverview(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setDismissedEscalation(false);
    void refresh();
    const interval = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(interval);
  }, [projectDir, maxConcurrentSpawns]);

  useEffect(() => {
    let cancelled = false;
    fetchModels()
      .then((models) => {
        if (cancelled) return;
        const launchable = models.filter(isBackendReady);
        setBackends(models);
        setRuntimeBackend((current) => (
          launchable.some((backend) => backend.id === current)
            ? current
            : launchable[0]?.id ?? ''
        ));
      })
      .catch(() => {
        if (!cancelled) setBackends([]);
      });
    return () => { cancelled = true; };
  }, [projectDir]);

  useEffect(() => {
    if (!selectedRuntimeBackend) {
      setRuntimeModel('');
      return;
    }
    setRuntimeModel((current) => (
      current && selectedRuntimeBackend.models.includes(current)
        ? current
        : selectedRuntimeBackend.models[0] ?? ''
    ));
  }, [selectedRuntimeBackend?.id]);

  const applyRuntime = async () => {
    if (!projectDir || !selectedRuntimeBackend) return;
    setRuntimeSaving(true);
    setRuntimeMessage(null);
    setRuntimeError(null);
    try {
      const result = await setFleetConfigRuntime(projectDir, {
        backend: selectedRuntimeBackend.id,
        model: runtimeModel || undefined,
        clearFallbacks: true,
      });
      setRuntimeMessage(`Updated ${result.updatedAgents.length} agents`);
      onRuntimeChanged?.();
    } catch (err) {
      setRuntimeError((err as Error).message);
    } finally {
      setRuntimeSaving(false);
    }
  };

  const headline = useMemo(() => {
    if (!overview) return 'Measuring this computer';
    const worst = overview.buckets.find((bucket) => bucket.status === 'critical')
      ?? overview.buckets.find((bucket) => bucket.status === 'hot')
      ?? overview.buckets.find((bucket) => bucket.status === 'busy');
    if (!worst) return 'This computer has room to work';
    return `${worst.label} is ${plainStatus(worst.status)}`;
  }, [overview]);

  if (loading && !overview) {
    return <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--pd-muted)' }}>Measuring resource use...</div>;
  }

  if (error && !overview) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--pd-accent)' }}>
        Resource overview unavailable: {error}
      </div>
    );
  }

  if (!overview) return null;

  const escalation = overview.policy.escalation;
  const showEscalation = escalation.recommended && !dismissedEscalation;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>RESOURCE GOVERNANCE</div>
          <div className="mt-1 text-xl font-semibold" style={{ color: 'var(--pd-text)' }}>{headline}</div>
          <div className="mt-1 max-w-3xl text-sm" style={{ color: 'var(--pd-muted)' }}>
            Advisory mode. Port Daddy is measuring itself, tools, local ports, rendering, spend, and local AI processes before enforcing anything.
          </div>
        </div>
        <button
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
        >
          <RefreshCw size={13} />
          <span>{loading ? 'Refreshing' : 'Refresh'}</span>
        </button>
      </div>

      {showEscalation && (
        <div className="mt-4 rounded-lg border p-4" style={{ backgroundColor: 'var(--pd-warning-surface)', borderColor: 'var(--pd-warning-border)' }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-warning)' }}>
                <AlertTriangle size={13} />
                <span>APPROVAL NEEDED</span>
              </div>
              <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>{escalation.title}</div>
              <div className="mt-1 text-xs" style={{ color: 'var(--pd-muted)' }}>{escalation.body}</div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDismissedEscalation(true)}
                className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
                style={{ color: 'var(--pd-muted)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
              >
                Keep cap
              </button>
              {onOpenYaml && (
                <button
                  type="button"
                  onClick={onOpenYaml}
                  className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
                  style={{ color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)', backgroundColor: 'var(--pd-bg)' }}
                >
                  Review cap
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>COMPUTER</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <span style={{ color: 'var(--pd-muted)' }}>Memory free</span>
            <span className="text-right font-mono" style={{ color: 'var(--pd-text)' }}>{formatBytes(overview.machine.memory.freeBytes)}</span>
            <span style={{ color: 'var(--pd-muted)' }}>CPUs</span>
            <span className="text-right font-mono" style={{ color: 'var(--pd-text)' }}>{overview.machine.cpuCount}</span>
            <span style={{ color: 'var(--pd-muted)' }}>Load</span>
            <span className="text-right font-mono" style={{ color: 'var(--pd-text)' }}>{overview.machine.loadAverage1m?.toFixed(2) ?? 'n/a'}</span>
          </div>
        </div>
        <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>FLEET</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <span style={{ color: 'var(--pd-muted)' }}>Agents visible</span>
            <span className="text-right font-mono" style={{ color: 'var(--pd-text)' }}>{overview.fleet.totalAgents}</span>
            <span style={{ color: 'var(--pd-muted)' }}>Launchable</span>
            <span className="text-right font-mono" style={{ color: 'var(--pd-text)' }}>{overview.fleet.launchableAgents}</span>
            <span style={{ color: 'var(--pd-muted)' }}>Suggested cap</span>
            <span className="text-right font-mono" style={{ color: 'var(--pd-text)' }}>{overview.policy.suggestedConcurrentSpawns}</span>
          </div>
        </div>
        <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>LOCAL AI + SPEND</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <span style={{ color: 'var(--pd-muted)' }}>Local AI processes</span>
            <span className="text-right font-mono" style={{ color: 'var(--pd-text)' }}>{overview.processes.localAi.length}</span>
            <span style={{ color: 'var(--pd-muted)' }}>Backend processes</span>
            <span className="text-right font-mono" style={{ color: 'var(--pd-text)' }}>{overview.processes.agentBackends.length}</span>
            <span style={{ color: 'var(--pd-muted)' }}>24h spend</span>
            <span className="text-right font-mono" style={{ color: 'var(--pd-text)' }}>${overview.cost.dailySpendUsd.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
              <SlidersHorizontal size={13} />
              <span>FLEET RUNTIME</span>
            </div>
            <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
              {readyBackends.length > 0 ? `${readyBackends.length} ready backend${readyBackends.length === 1 ? '' : 's'}` : 'No ready backends'}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-[10px] font-semibold" style={{ color: 'var(--pd-muted)' }}>
              <span>Backend</span>
              <select
                value={selectedRuntimeBackend?.id ?? ''}
                onChange={(event) => {
                  setRuntimeBackend(event.target.value);
                  setRuntimeMessage(null);
                  setRuntimeError(null);
                }}
                className="h-8 min-w-40 rounded-md px-2 text-xs"
                style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
                disabled={readyBackends.length === 0 || runtimeSaving}
              >
                {readyBackends.length === 0 && <option value="" disabled>No ready backend</option>}
                {readyBackends.map((backend) => (
                  <option key={backend.id} value={backend.id}>{backend.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[10px] font-semibold" style={{ color: 'var(--pd-muted)' }}>
              <span>Model</span>
              <select
                value={runtimeModel}
                onChange={(event) => {
                  setRuntimeModel(event.target.value);
                  setRuntimeMessage(null);
                  setRuntimeError(null);
                }}
                className="h-8 min-w-64 rounded-md px-2 text-xs"
                style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
                disabled={!selectedRuntimeBackend || runtimeSaving}
              >
                <option value="">default</option>
                {selectedRuntimeBackend?.models.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void applyRuntime()}
              disabled={!projectDir || !selectedRuntimeBackend || runtimeSaving}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold disabled:opacity-50"
              style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
            >
              <ServerCog size={13} />
              <span>{runtimeSaving ? 'Applying' : 'Apply to all agents'}</span>
            </button>
          </div>
        </div>
        {(runtimeMessage || runtimeError) && (
          <div className="mt-2 text-xs" style={{ color: runtimeError ? 'var(--pd-accent)' : 'var(--pd-success)' }}>
            {runtimeError || runtimeMessage}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {overview.buckets.map((bucket) => (
          <BucketCard key={bucket.id} bucket={bucket} samples={overview.history} />
        ))}
      </div>
    </div>
  );
}
