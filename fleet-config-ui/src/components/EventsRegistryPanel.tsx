import { useCallback, useEffect, useMemo, useState } from 'react';
import { ListChecks, PlusCircle, RefreshCw, RadioTower, Send } from 'lucide-react';
import { discoverChannels, ensureChannel } from '../api';
import type { ChannelScope, DeclaredChannel, FleetConfig, ResolvedChannelTarget } from '../types';

interface Props {
  channels: ResolvedChannelTarget[];
  fleetConfig: FleetConfig | null;
  projectDir?: string;
  projectName?: string;
  onOpenTube?: (channel: string) => void;
}

const DEFAULT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    summary: { type: 'string' },
    url: { type: 'string' },
  },
  required: ['summary'],
}, null, 2);

const DEFAULT_SAMPLE = JSON.stringify({
  summary: 'test failed in checkout.spec.ts',
  url: 'https://example.test/run/123',
}, null, 2);

function metadataString(metadata: Record<string, unknown> | null, key: string): string {
  const value = metadata?.[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').join(', ');
  return '';
}

function metadataObject(metadata: Record<string, unknown> | null, key: string): unknown {
  return metadata?.[key];
}

function parseJsonObject(label: string, raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function scopeBadgeStyle(scope: ChannelScope) {
  if (scope === 'global') {
    return { backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', borderColor: 'var(--pd-warning-border)' };
  }
  if (scope === 'repo') {
    return { backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', borderColor: 'var(--pd-success-border)' };
  }
  return { backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', borderColor: 'var(--pd-border)' };
}

function isEventChannel(channel: DeclaredChannel): boolean {
  return channel.metadata?.kind === 'event'
    || channel.logicalName.includes(':')
    || Boolean(channel.description?.toLowerCase().includes('event'));
}

export default function EventsRegistryPanel({ channels, fleetConfig, projectDir, projectName, onOpenTube }: Props) {
  const [rows, setRows] = useState<DeclaredChannel[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('ci:test-failed');
  const [description, setDescription] = useState('CI failed and needs an agent to inspect logs.');
  const [scope, setScope] = useState<ChannelScope>('branch');
  const [aliases, setAliases] = useState('ci.failed,test:failed');
  const [producer, setProducer] = useState('github-actions');
  const [consumers, setConsumers] = useState('');
  const [payloadSchema, setPayloadSchema] = useState(DEFAULT_SCHEMA);
  const [samplePayload, setSamplePayload] = useState(DEFAULT_SAMPLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdChannel, setCreatedChannel] = useState<DeclaredChannel | null>(null);

  const configChannelRows = useMemo<DeclaredChannel[]>(() => {
    if (!fleetConfig) return [];
    const physicalByLogical = new Map(channels.map((channel) => [channel.logical, channel.physical]));
    return Object.entries(fleetConfig.channels).map(([logicalName, config]) => ({
      logicalName,
      physicalName: physicalByLogical.get(logicalName) ?? logicalName,
      description: config.description || null,
      aliases: [],
      scope: 'branch',
      projectDir: projectDir ?? null,
      metadata: {
        kind: 'event',
        source: 'pd-fleet.yml',
        consumers: config.consumers ?? [],
      },
      createdAt: 0,
      updatedAt: 0,
      activeCount: 0,
      lastMessage: null,
      active: false,
      source: 'declared',
    }));
  }, [channels, fleetConfig, projectDir]);

  const loadChannels = useCallback(async () => {
    try {
      const discovered = await discoverChannels({ projectDir, includeObserved: true, query: query.trim() || undefined });
      setRows(discovered);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [projectDir, query]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  const mergedRows = useMemo(() => {
    const byPhysical = new Map<string, DeclaredChannel>();
    for (const row of [...configChannelRows, ...rows]) {
      const existing = byPhysical.get(row.physicalName);
      byPhysical.set(row.physicalName, existing ? { ...row, activeCount: Math.max(row.activeCount, existing.activeCount), active: row.active || existing.active } : row);
    }
    return Array.from(byPhysical.values())
      .filter((row) => isEventChannel(row))
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
        return a.logicalName.localeCompare(b.logicalName);
      });
  }, [configChannelRows, rows]);

  const createEvent = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setBusy(true);
    setError(null);
    try {
      const schema = parseJsonObject('Payload schema', payloadSchema);
      const sample = parseJsonObject('Sample payload', samplePayload);
      const result = await ensureChannel({
        name: trimmedName,
        description: description.trim() || null,
        aliases: splitList(aliases),
        scope,
        projectDir: projectDir ?? null,
        metadata: {
          kind: 'event',
          producer: producer.trim() || null,
          consumers: splitList(consumers),
          payloadSchema: schema,
          samplePayload: sample,
          projectName: projectName ?? null,
          createdFrom: 'fleet-ui-events',
        },
      });
      setCreatedChannel(result.channel);
      await loadChannels();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full min-h-0 gap-4 overflow-hidden p-4 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)]">
      <aside className="pd-card min-h-0 overflow-y-auto p-4">
        <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
          <PlusCircle size={13} />
          <span>DECLARE EVENT</span>
        </div>
        <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>Canonical channel metadata</div>

        <label className="mt-4 block">
          <span className="pd-label">Event channel</span>
          <input className="pd-input font-mono" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="mt-3 block">
          <span className="pd-label">Description</span>
          <textarea className="pd-textarea" value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>
            <span className="pd-label">Scope</span>
            <select className="pd-select" value={scope} onChange={(event) => setScope(event.target.value as ChannelScope)}>
              <option value="branch">branch</option>
              <option value="worktree">worktree</option>
              <option value="repo">repo</option>
              <option value="global">global</option>
            </select>
          </label>
          <label>
            <span className="pd-label">Producer</span>
            <input className="pd-input font-mono" value={producer} onChange={(event) => setProducer(event.target.value)} />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="pd-label">Aliases</span>
          <input className="pd-input font-mono" value={aliases} onChange={(event) => setAliases(event.target.value)} />
        </label>
        <label className="mt-3 block">
          <span className="pd-label">Consumers</span>
          <input className="pd-input font-mono" value={consumers} onChange={(event) => setConsumers(event.target.value)} placeholder="spark,qa,release-bot" />
        </label>
        <label className="mt-3 block">
          <span className="pd-label">Payload schema</span>
          <textarea className="pd-textarea font-mono" value={payloadSchema} onChange={(event) => setPayloadSchema(event.target.value)} />
        </label>
        <label className="mt-3 block">
          <span className="pd-label">Sample payload</span>
          <textarea className="pd-textarea font-mono" value={samplePayload} onChange={(event) => setSamplePayload(event.target.value)} />
        </label>
        <button type="button" className="pd-button pd-button-primary mt-4 w-full" disabled={busy || !name.trim()} onClick={() => void createEvent()}>
          <ListChecks size={14} />
          Declare event
        </button>
        {createdChannel ? (
          <div className="pd-card-inset mt-3 p-3 text-xs" style={{ color: 'var(--pd-success)' }}>
            Saved {createdChannel.logicalName} → {createdChannel.physicalName}
          </div>
        ) : null}
        {error ? (
          <div className="pd-card-inset mt-3 p-3 text-xs" style={{ color: 'var(--pd-accent)' }}>{error}</div>
        ) : null}
      </aside>

      <section className="pd-card min-h-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--pd-border)' }}>
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
              <RadioTower size={13} />
              <span>EVENT REGISTRY</span>
            </div>
            <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
              {mergedRows.length} declared or observed event channel{mergedRows.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <input
              className="pd-input min-w-[16rem] font-mono"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="filter events"
            />
            <button type="button" className="pd-button pd-button-secondary" onClick={() => void loadChannels()}>
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </div>

        <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 pb-20">
          {mergedRows.length === 0 ? (
            <div className="pd-card-inset p-6 text-center text-sm" style={{ color: 'var(--pd-muted)' }}>
              No event channels match this project yet.
            </div>
          ) : mergedRows.map((row) => {
            const producerValue = metadataString(row.metadata, 'producer') || metadataString(row.metadata, 'source') || 'external';
            const consumerValue = metadataString(row.metadata, 'consumers');
            const sample = metadataObject(row.metadata, 'samplePayload');
            return (
              <article key={row.physicalName} className="rounded-xl border p-4" style={{ borderColor: 'var(--pd-border)', backgroundColor: row.active ? 'var(--pd-bg)' : 'var(--pd-surface-3)' }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>{row.logicalName}</div>
                    <div className="mt-1 break-all text-[11px] font-mono" style={{ color: 'var(--pd-muted)' }}>{row.physicalName}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <span className="pd-chip" style={scopeBadgeStyle(row.scope)}>{row.scope}</span>
                    <span className="pd-chip" style={{ backgroundColor: row.active ? 'var(--pd-success-surface)' : 'var(--pd-bg)', color: row.active ? 'var(--pd-success)' : 'var(--pd-muted)', borderColor: row.active ? 'var(--pd-success-border)' : 'var(--pd-border)' }}>
                      {row.activeCount} msg
                    </span>
                    <span className="pd-chip" style={{ backgroundColor: row.source === 'observed' ? 'var(--pd-warning-surface)' : 'var(--pd-bg)', color: row.source === 'observed' ? 'var(--pd-warning)' : 'var(--pd-muted)', borderColor: row.source === 'observed' ? 'var(--pd-warning-border)' : 'var(--pd-border)' }}>
                      {row.source}
                    </span>
                  </div>
                </div>
                {row.description ? (
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--pd-muted)' }}>{row.description}</p>
                ) : null}
                <div className="mt-3 grid gap-2 text-[11px] md:grid-cols-2">
                  <div className="pd-card-inset p-3">
                    <div className="pd-kicker">Producer</div>
                    <div className="mt-1 font-mono" style={{ color: 'var(--pd-text)' }}>{producerValue}</div>
                  </div>
                  <div className="pd-card-inset p-3">
                    <div className="pd-kicker">Consumers</div>
                    <div className="mt-1 font-mono" style={{ color: 'var(--pd-text)' }}>{consumerValue || 'none declared'}</div>
                  </div>
                </div>
                {sample ? (
                  <pre className="mt-3 max-h-36 overflow-auto rounded-lg border p-3 text-[11px]" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-code)', color: 'var(--pd-muted)' }}>
                    {JSON.stringify(sample, null, 2)}
                  </pre>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="pd-button pd-button-secondary min-h-0 px-3 py-2 text-[11px]" onClick={() => onOpenTube?.(row.logicalName)}>
                    <Send size={13} />
                    Open in Tube
                  </button>
                  <button
                    type="button"
                    className="pd-button pd-button-secondary min-h-0 px-3 py-2 text-[11px]"
                    onClick={() => {
                      setName(row.logicalName);
                      setDescription(row.description ?? '');
                      setScope(row.scope);
                      setAliases(row.aliases.join(','));
                      setProducer(producerValue);
                      setConsumers(consumerValue);
                      setPayloadSchema(JSON.stringify(metadataObject(row.metadata, 'payloadSchema') ?? JSON.parse(DEFAULT_SCHEMA), null, 2));
                      setSamplePayload(JSON.stringify(sample ?? JSON.parse(DEFAULT_SAMPLE), null, 2));
                    }}
                  >
                    Edit metadata
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
