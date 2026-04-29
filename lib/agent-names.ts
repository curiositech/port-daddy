const MAX_DISPLAY_NAME = 72;
const MAX_SLUG = 48;

interface DisplayNameInput {
  name?: string | null;
  purpose?: string | null;
  identity?: string | null;
  type?: string | null;
  backend?: string | null;
  fallback?: string | null;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function cleanAgentDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = collapseWhitespace(value.replace(/[\u0000-\u001f\u007f]/g, ''));
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_DISPLAY_NAME);
}

function titleFromSlug(value: string): string {
  return value
    .split(/[:._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function shortPurpose(value: string): string {
  const cleaned = collapseWhitespace(value.replace(/[^\w\s:./-]+/g, ''));
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= 8) return cleaned;
  return `${words.slice(0, 8).join(' ')}...`;
}

export function deriveAgentDisplayName(input: DisplayNameInput): string {
  const explicit = cleanAgentDisplayName(input.name);
  if (explicit) return explicit;

  const purpose = cleanAgentDisplayName(input.purpose);
  if (purpose) return shortPurpose(purpose);

  const identity = cleanAgentDisplayName(input.identity);
  if (identity) {
    const parts = identity.split(':').filter(Boolean);
    const label = parts.length > 0 ? titleFromSlug(parts.slice(-2).join(':')) : titleFromSlug(identity);
    if (label) return label;
  }

  const backend = cleanAgentDisplayName(input.backend);
  const type = cleanAgentDisplayName(input.type);
  const fallback = cleanAgentDisplayName(input.fallback);
  return backend || type || fallback || 'Port Daddy Agent';
}

export function slugifyAgentName(value: unknown, fallback = 'fleet-agent'): string {
  const source = typeof value === 'string' && value.trim() ? value : fallback;
  const slug = source
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
  return slug || fallback;
}

export function deriveFleetAgentName(input: {
  name?: string | null;
  identity?: string | null;
  prompt?: string | null;
  backend?: string | null;
  index: number;
}): string {
  if (input.name && input.name.trim()) return slugifyAgentName(input.name, `fleet-agent-${input.index + 1}`);
  if (input.identity && input.identity.trim()) return slugifyAgentName(input.identity.split(':').filter(Boolean).slice(-2).join('-'), `fleet-agent-${input.index + 1}`);
  if (input.prompt && input.prompt.trim()) return slugifyAgentName(input.prompt, `fleet-agent-${input.index + 1}`);
  if (input.backend && input.backend.trim()) return slugifyAgentName(`${input.backend}-worker`, `fleet-agent-${input.index + 1}`);
  return `fleet-agent-${input.index + 1}`;
}
