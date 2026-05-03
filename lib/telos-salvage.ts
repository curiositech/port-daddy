export type TelosVerdict = 'fulfilled' | 'partial' | 'not-fulfilled';
export type SelfSalvageDoable = 'yes' | 'no' | 'unknown';

export interface SelfSalvageCapsule {
  telosVerdict: TelosVerdict;
  doable: SelfSalvageDoable;
  whyStopped?: string;
  nextPlan: string[];
  wisdom?: string;
  evidence: string[];
  risk?: string;
  createdAt: number;
}

export interface NormalizeSelfSalvageOptions {
  telosVerdict?: unknown;
  doable?: unknown;
  whyStopped?: unknown;
  nextPlan?: unknown;
  wisdom?: unknown;
  evidence?: unknown;
  risk?: unknown;
  now?: number;
}

export interface NormalizeSelfSalvageResult {
  success: boolean;
  capsule?: SelfSalvageCapsule;
  shouldQueue: boolean;
  error?: string;
}

const MAX_TEXT = 1200;
const MAX_ITEMS = 12;

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, MAX_TEXT);
}

function splitTextList(value: string): string[] {
  return value
    .split(/\r?\n|;\s+/)
    .map((item) => item.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

function cleanList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => typeof item === 'string' ? splitTextList(item) : [])
      .map((item) => item.slice(0, MAX_TEXT))
      .slice(0, MAX_ITEMS);
  }

  if (typeof value === 'string') {
    return splitTextList(value).map((item) => item.slice(0, MAX_TEXT)).slice(0, MAX_ITEMS);
  }

  return [];
}

function normalizeVerdict(value: unknown, fallback: TelosVerdict): TelosVerdict | null {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'fulfilled' || normalized === 'complete' || normalized === 'completed') return 'fulfilled';
  if (normalized === 'partial' || normalized === 'partly-fulfilled' || normalized === 'partially-fulfilled') return 'partial';
  if (
    normalized === 'not-fulfilled'
    || normalized === 'unfulfilled'
    || normalized === 'not-done'
    || normalized === 'incomplete'
  ) {
    return 'not-fulfilled';
  }
  return null;
}

function normalizeDoable(value: unknown, fallback: SelfSalvageDoable): SelfSalvageDoable | null {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['yes', 'y', 'true', 'doable', 'resumable'].includes(normalized)) return 'yes';
  if (['no', 'n', 'false', 'blocked', 'impossible'].includes(normalized)) return 'no';
  if (['unknown', 'unsure', 'maybe'].includes(normalized)) return 'unknown';
  return null;
}

function hasAnyField(options: NormalizeSelfSalvageOptions): boolean {
  return [
    options.telosVerdict,
    options.doable,
    options.whyStopped,
    options.nextPlan,
    options.wisdom,
    options.evidence,
    options.risk,
  ].some((value) => value !== undefined);
}

export function normalizeSelfSalvage(
  input: unknown,
  options: NormalizeSelfSalvageOptions = {},
): NormalizeSelfSalvageResult {
  if (input === undefined && !hasAnyField(options)) {
    return { success: true, shouldQueue: false };
  }
  if (input === false) {
    return { success: true, shouldQueue: false };
  }

  const fromBoolean = input === true;
  const record = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};

  const verdict = normalizeVerdict(
    options.telosVerdict ?? record.telosVerdict ?? record.telos_verdict ?? record.verdict,
    fromBoolean ? 'not-fulfilled' : 'partial',
  );
  if (!verdict) {
    return { success: false, shouldQueue: false, error: 'self-salvage telosVerdict must be fulfilled, partial, or not-fulfilled' };
  }

  const doable = normalizeDoable(
    options.doable ?? record.doable,
    fromBoolean || verdict === 'not-fulfilled' ? 'yes' : 'unknown',
  );
  if (!doable) {
    return { success: false, shouldQueue: false, error: 'self-salvage doable must be yes, no, or unknown' };
  }

  const capsule: SelfSalvageCapsule = {
    telosVerdict: verdict,
    doable,
    whyStopped: cleanText(options.whyStopped ?? record.whyStopped ?? record.why_stopped ?? record.reason),
    nextPlan: cleanList(options.nextPlan ?? record.nextPlan ?? record.next_plan ?? record.plan),
    wisdom: cleanText(options.wisdom ?? record.wisdom),
    evidence: cleanList(options.evidence ?? record.evidence),
    risk: cleanText(options.risk ?? record.risk),
    createdAt: typeof options.now === 'number' ? options.now : Date.now(),
  };

  const shouldQueue = capsule.telosVerdict !== 'fulfilled' && capsule.doable === 'yes';
  if (shouldQueue && !capsule.whyStopped && capsule.nextPlan.length === 0 && !capsule.wisdom) {
    return {
      success: false,
      shouldQueue: false,
      error: 'queueable self-salvage needs whyStopped, nextPlan, or wisdom so the next agent can continue',
    };
  }

  return { success: true, capsule, shouldQueue };
}

export function formatSelfSalvageNote(capsule: SelfSalvageCapsule): string {
  const lines = [
    'Self-salvage capsule',
    `Telos verdict: ${capsule.telosVerdict}`,
    `Doable: ${capsule.doable}`,
  ];

  if (capsule.whyStopped) lines.push(`Why stopped: ${capsule.whyStopped}`);
  if (capsule.nextPlan.length > 0) {
    lines.push('Next plan:');
    capsule.nextPlan.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
  }
  if (capsule.wisdom) lines.push(`Wisdom: ${capsule.wisdom}`);
  if (capsule.evidence.length > 0) {
    lines.push('Evidence:');
    capsule.evidence.forEach((item) => lines.push(`- ${item}`));
  }
  if (capsule.risk) lines.push(`Risk: ${capsule.risk}`);

  return lines.join('\n');
}
