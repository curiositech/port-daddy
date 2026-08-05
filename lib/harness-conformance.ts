import type { DatabaseInstance } from './sqlite-runtime.js';
import {
  BACKEND_CATALOG,
  type BackendCatalogEntry,
  type HarnessAdapterCapabilities,
} from './backend-catalog.js';
import type {
  HarnessAdapterProbeReport,
  HarnessProbeCheck,
} from './harness-adapter-probe.js';

export const HARNESS_CONTINUATION_MATRIX_SCHEMA = 'pd.agent-harbor.harness-continuation-matrix.v0' as const;
export const DEFAULT_HARNESS_WITNESS_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;

export type HarnessConformanceCapability =
  | 'catalog'
  | 'discovery'
  | 'spawn'
  | 'live-interaction'
  | 'native-resume'
  | 'handoff';

export type HarnessConformanceStatus =
  | 'declared'
  | 'discovered'
  | 'witnessed'
  | 'unverified'
  | 'unavailable'
  | 'unsupported';

export interface HarnessConformanceEvidence {
  status: HarnessConformanceStatus;
  basis:
    | 'catalog'
    | 'side-effect-free-help'
    | 'durable-transcript'
    | 'control-receipt'
    | 'continuation-receipt'
    | 'none';
  detail: string;
  witnessId: string | null;
  observedAt: string | null;
  ageMs: number | null;
  freshness: 'fresh' | 'stale' | 'none';
}

export interface HarnessConformanceWitness {
  capability: Extract<HarnessConformanceCapability, 'spawn' | 'live-interaction' | 'native-resume' | 'handoff'>;
  adapterFamily: string;
  sourceAdapterFamily?: string | null;
  witnessId: string;
  observedAt: string;
  detail: string;
}

export interface HarnessConformanceAdapterRow {
  family: string;
  backendIds: string[];
  interactiveChannels: string[];
  predicates: Record<HarnessConformanceCapability, HarnessConformanceEvidence>;
}

export interface HarnessContinuationCompatibilityCell {
  sourceFamily: string;
  targetFamily: string;
  autoMode: 'native' | 'handoff' | 'unsupported';
  native: 'declared' | 'unsupported';
  handoff: 'declared' | 'unsupported';
  witness: HarnessConformanceEvidence | null;
  detail: string;
}

export interface HarnessContinuationMatrixReport {
  schema: typeof HARNESS_CONTINUATION_MATRIX_SCHEMA;
  generatedAt: string;
  evidencePolicy: {
    numericBadgeGranted: false;
    selfReportCanAdvance: false;
    discoveryProvesRuntime: false;
    staleAfterMs: number;
    detail: string;
  };
  adapters: HarnessConformanceAdapterRow[];
  compatibility: HarnessContinuationCompatibilityCell[];
  summary: {
    adapterFamilies: number;
    paths: number;
    nativePaths: number;
    handoffPaths: number;
    unsupportedPaths: number;
    witnessedPaths: number;
    witnessedPredicates: number;
  };
}

export interface BuildHarnessContinuationMatrixOptions {
  catalog?: readonly BackendCatalogEntry[];
  discovery?: HarnessAdapterProbeReport | null;
  witnesses?: readonly HarnessConformanceWitness[];
  now?: Date;
  staleAfterMs?: number;
}

interface FamilyRecord {
  adapter: HarnessAdapterCapabilities;
  backendIds: string[];
}

function groupCatalog(catalog: readonly BackendCatalogEntry[]): Map<string, FamilyRecord> {
  const grouped = new Map<string, FamilyRecord>();
  for (const backend of catalog) {
    const existing = grouped.get(backend.adapter.family);
    if (existing) {
      existing.backendIds.push(backend.id);
    } else {
      grouped.set(backend.adapter.family, {
        adapter: backend.adapter,
        backendIds: [backend.id],
      });
    }
  }
  return grouped;
}

function emptyEvidence(
  status: Extract<HarnessConformanceStatus, 'declared' | 'unverified' | 'unsupported' | 'unavailable'>,
  basis: HarnessConformanceEvidence['basis'],
  detail: string,
): HarnessConformanceEvidence {
  return {
    status,
    basis,
    detail,
    witnessId: null,
    observedAt: null,
    ageMs: null,
    freshness: 'none',
  };
}

function witnessedEvidence(
  witness: HarnessConformanceWitness,
  nowMs: number,
  staleAfterMs: number,
): HarnessConformanceEvidence | null {
  const observedAtMs = Date.parse(witness.observedAt);
  if (!Number.isFinite(observedAtMs)) return null;
  const ageMs = Math.max(0, nowMs - observedAtMs);
  const basis = witness.capability === 'spawn'
    ? 'durable-transcript'
    : witness.capability === 'live-interaction'
      ? 'control-receipt'
      : 'continuation-receipt';
  return {
    status: 'witnessed',
    basis,
    detail: witness.detail,
    witnessId: witness.witnessId,
    observedAt: new Date(observedAtMs).toISOString(),
    ageMs,
    freshness: ageMs <= staleAfterMs ? 'fresh' : 'stale',
  };
}

function discoveryEvidence(check: HarnessProbeCheck | undefined): HarnessConformanceEvidence {
  if (!check) {
    return emptyEvidence('unverified', 'none', 'local discovery was not requested');
  }
  if (check.status === 'discovered') {
    return {
      ...emptyEvidence('unverified', 'side-effect-free-help', check.detail),
      status: 'discovered',
    };
  }
  if (check.status === 'unavailable') {
    return emptyEvidence('unavailable', 'side-effect-free-help', check.detail);
  }
  if (check.status === 'not-supported') {
    return emptyEvidence('unsupported', 'side-effect-free-help', check.detail);
  }
  return emptyEvidence('unverified', 'side-effect-free-help', check.detail);
}

function latestWitness(
  witnesses: readonly HarnessConformanceWitness[],
  capability: HarnessConformanceWitness['capability'],
  adapterFamily: string,
  sourceAdapterFamily?: string,
): HarnessConformanceWitness | null {
  let selected: HarnessConformanceWitness | null = null;
  let selectedAt = -1;
  for (const witness of witnesses) {
    if (witness.capability !== capability || witness.adapterFamily !== adapterFamily) continue;
    if (sourceAdapterFamily !== undefined && witness.sourceAdapterFamily !== sourceAdapterFamily) continue;
    const observedAt = Date.parse(witness.observedAt);
    if (!Number.isFinite(observedAt) || observedAt <= selectedAt) continue;
    selected = witness;
    selectedAt = observedAt;
  }
  return selected;
}

function predicateEvidence(
  witnesses: readonly HarnessConformanceWitness[],
  capability: HarnessConformanceWitness['capability'],
  family: string,
  nowMs: number,
  staleAfterMs: number,
  unsupportedDetail: string | null,
  unverifiedDetail: string,
): HarnessConformanceEvidence {
  if (unsupportedDetail) return emptyEvidence('unsupported', 'catalog', unsupportedDetail);
  const witness = latestWitness(witnesses, capability, family);
  return witness
    ? witnessedEvidence(witness, nowMs, staleAfterMs) ?? emptyEvidence('unverified', 'none', unverifiedDetail)
    : emptyEvidence('unverified', 'none', unverifiedDetail);
}

export function buildHarnessContinuationMatrix(
  options: BuildHarnessContinuationMatrixOptions = {},
): HarnessContinuationMatrixReport {
  const catalog = options.catalog ?? BACKEND_CATALOG;
  const grouped = groupCatalog(catalog);
  const discoveryByFamily = new Map(
    (options.discovery?.adapters ?? []).map((adapter) => [adapter.family, adapter]),
  );
  const witnesses = options.witnesses ?? [];
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_HARNESS_WITNESS_STALE_AFTER_MS;

  const adapters: HarnessConformanceAdapterRow[] = [];
  for (const [family, record] of grouped) {
    const { adapter } = record;
    const discovery = discoveryByFamily.get(family);
    const stableNativeResume = adapter.resume.native && adapter.resume.scope === 'session';
    const hasLiveChannel = adapter.interactiveChannels.some((channel) => channel !== 'none');
    adapters.push({
      family,
      backendIds: [...record.backendIds],
      interactiveChannels: [...adapter.interactiveChannels],
      predicates: {
        catalog: emptyEvidence(
          'declared',
          'catalog',
          'mechanical adapter contract is registered; this is not runtime proof',
        ),
        discovery: discoveryEvidence(discovery?.spawn),
        spawn: predicateEvidence(
          witnesses,
          'spawn',
          family,
          nowMs,
          staleAfterMs,
          null,
          'no completed durable spawn transcript witnesses this adapter family',
        ),
        'live-interaction': predicateEvidence(
          witnesses,
          'live-interaction',
          family,
          nowMs,
          staleAfterMs,
          hasLiveChannel ? null : 'adapter declares no exact live interaction channel',
          `channels are declared (${adapter.interactiveChannels.join(', ')}) but no daemon-witnessed control receipt exists`,
        ),
        'native-resume': predicateEvidence(
          witnesses,
          'native-resume',
          family,
          nowMs,
          staleAfterMs,
          stableNativeResume
            ? null
            : adapter.resume.scope === 'history'
              ? 'history replay does not preserve a stable native session identity'
              : 'adapter does not declare session-scoped native resume',
          'native resume is declared but no completed continuation receipt witnesses it',
        ),
        handoff: predicateEvidence(
          witnesses,
          'handoff',
          family,
          nowMs,
          staleAfterMs,
          adapter.acceptsInitialPrompt ? null : 'adapter cannot receive a successor initialization prompt',
          'handoff input is declared but no completed successor continuation receipt witnesses it',
        ),
      },
    });
  }

  const compatibility: HarnessContinuationCompatibilityCell[] = [];
  for (const [sourceFamily] of grouped) {
    for (const [targetFamily, target] of grouped) {
      const native = sourceFamily === targetFamily
        && target.adapter.resume.native
        && target.adapter.resume.scope === 'session';
      const handoff = target.adapter.acceptsInitialPrompt;
      const autoMode = native ? 'native' : handoff ? 'handoff' : 'unsupported';
      const capability = autoMode === 'native' ? 'native-resume' : autoMode === 'handoff' ? 'handoff' : null;
      const witness = capability
        ? latestWitness(witnesses, capability, targetFamily, sourceFamily)
        : null;
      compatibility.push({
        sourceFamily,
        targetFamily,
        autoMode,
        native: native ? 'declared' : 'unsupported',
        handoff: handoff ? 'declared' : 'unsupported',
        witness: witness ? witnessedEvidence(witness, nowMs, staleAfterMs) : null,
        detail: native
          ? 'auto may restore the daemon-witnessed native session inside the same adapter family'
          : handoff
            ? 'auto creates a successor from the sanitized handoff capsule'
            : 'target cannot accept native session identity or successor initialization context',
      });
    }
  }

  return {
    schema: HARNESS_CONTINUATION_MATRIX_SCHEMA,
    generatedAt: now.toISOString(),
    evidencePolicy: {
      numericBadgeGranted: false,
      selfReportCanAdvance: false,
      discoveryProvesRuntime: false,
      staleAfterMs,
      detail: 'Catalog declarations are mechanical ceilings. Only durable daemon evidence marks spawn or continuation predicates witnessed; live interaction remains unverified without a dedicated control receipt.',
    },
    adapters,
    compatibility,
    summary: {
      adapterFamilies: adapters.length,
      paths: compatibility.length,
      nativePaths: compatibility.filter((cell) => cell.autoMode === 'native').length,
      handoffPaths: compatibility.filter((cell) => cell.autoMode === 'handoff').length,
      unsupportedPaths: compatibility.filter((cell) => cell.autoMode === 'unsupported').length,
      witnessedPaths: compatibility.filter((cell) => cell.witness !== null).length,
      witnessedPredicates: adapters.reduce(
        (count, adapter) => count + Object.values(adapter.predicates).filter((item) => item.status === 'witnessed').length,
        0,
      ),
    },
  };
}

function tableExists(db: DatabaseInstance, name: string): boolean {
  const row = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(name) as { present?: number } | undefined;
  return row?.present === 1;
}

function isoTimestamp(value: unknown): string | null {
  const timestamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function collectHarnessConformanceWitnesses(
  db: DatabaseInstance,
  catalog: readonly BackendCatalogEntry[] = BACKEND_CATALOG,
): HarnessConformanceWitness[] {
  const backendFamilies = new Map(catalog.map((entry) => [entry.id, entry.adapter.family]));
  const witnesses: HarnessConformanceWitness[] = [];

  if (tableExists(db, 'fleet_transcripts')) {
    const rows = db.prepare(`
      SELECT id, backend_id, observed_at
      FROM (
        SELECT id,
               COALESCE(effective_backend, backend) AS backend_id,
               COALESCE(ended_at, started_at) AS observed_at,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(effective_backend, backend)
                 ORDER BY COALESCE(ended_at, started_at) DESC, id DESC
               ) AS recency_rank
        FROM fleet_transcripts
        WHERE status = 'completed'
      )
      WHERE recency_rank = 1
      ORDER BY observed_at DESC
    `).all() as Array<{ id: string; backend_id: string; observed_at: number }>;
    for (const row of rows) {
      const adapterFamily = backendFamilies.get(row.backend_id);
      const observedAt = isoTimestamp(row.observed_at);
      if (!adapterFamily || !observedAt) continue;
      witnesses.push({
        capability: 'spawn',
        adapterFamily,
        witnessId: row.id,
        observedAt,
        detail: `completed durable transcript for backend ${row.backend_id}`,
      });
    }
  }

  if (tableExists(db, 'agent_continuations')) {
    const rows = db.prepare(`
      SELECT id, mode, source_adapter, target_adapter, completed_at
      FROM (
        SELECT id, mode, source_adapter, target_adapter, completed_at,
               ROW_NUMBER() OVER (
                 PARTITION BY mode, source_adapter, target_adapter
                 ORDER BY completed_at DESC, id DESC
               ) AS recency_rank
        FROM agent_continuations
        WHERE status = 'completed' AND completed_at IS NOT NULL
      )
      WHERE recency_rank = 1
      ORDER BY completed_at DESC
    `).all() as Array<{
      id: string;
      mode: 'native' | 'handoff';
      source_adapter: string;
      target_adapter: string;
      completed_at: number;
    }>;
    for (const row of rows) {
      const observedAt = isoTimestamp(row.completed_at);
      if (!observedAt || (row.mode !== 'native' && row.mode !== 'handoff')) continue;
      witnesses.push({
        capability: row.mode === 'native' ? 'native-resume' : 'handoff',
        adapterFamily: row.target_adapter,
        sourceAdapterFamily: row.source_adapter,
        witnessId: row.id,
        observedAt,
        detail: row.mode === 'native'
          ? `completed native continuation from ${row.source_adapter}`
          : `completed sanitized successor handoff from ${row.source_adapter}`,
      });
    }
  }

  return witnesses;
}

export function renderHarnessContinuationMatrix(
  report: HarnessContinuationMatrixReport = buildHarnessContinuationMatrix(),
): string {
  const families = report.adapters.map((adapter) => adapter.family);
  const indexByFamily = new Map(families.map((family, index) => [family, index]));
  const cellByPair = new Map(
    report.compatibility.map((cell) => [`${cell.sourceFamily}\0${cell.targetFamily}`, cell]),
  );
  const labelWidth = Math.max(...families.map((family) => family.length), 6);
  const lines = [
    `${'Source'.padEnd(labelWidth + 4)}${families.map((_, index) => String(index + 1).padStart(2, '0')).join(' ')}`,
  ];
  for (const sourceFamily of families) {
    const sourceIndex = indexByFamily.get(sourceFamily) ?? 0;
    const cells = families.map((targetFamily) => {
      const cell = cellByPair.get(`${sourceFamily}\0${targetFamily}`);
      if (!cell || cell.autoMode === 'unsupported') return '—';
      return cell.autoMode === 'native' ? 'N' : 'H';
    }).map((symbol) => symbol.padStart(2, ' ')).join(' ');
    lines.push(`${String(sourceIndex + 1).padStart(2, '0')} ${sourceFamily.padEnd(labelWidth)} ${cells}`);
  }
  lines.push('');
  lines.push('N = same-family native session path is mechanically available; H = sanitized successor handoff; — = unsupported.');
  lines.push('Symbols describe mechanics only. Runtime proof appears separately as durable witnesses.');
  return `${lines.join('\n')}\n`;
}
