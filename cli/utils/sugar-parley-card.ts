/**
 * Rendering contract for the normal Sugar coordination prompt.
 *
 * It deliberately receives a fully typed card from the daemon. The CLI does
 * not decide whether two agents overlap; it only makes the already-grounded
 * evidence legible in TTY, no-color, and narrow-terminal modes.
 */

import type { SugarParleyCard } from '../../lib/sugar-parley.js';
import * as ui from './ui.js';
import type { CliColorLevel } from './output.js';

export interface SugarParleyCardRenderOptions {
  width?: number;
  colorLevel?: CliColorLevel;
  styled?: boolean;
}

interface SugarParleyAttentionFrame {
  title: string;
  subtitle: string;
  tone: ui.LineworkTone;
  zone: string;
  rows: Array<{ state: ui.LineworkState; label: string; text: string }>;
  footer: string;
}

/**
 * Decide whether an unknown inbox value is a plain object before reading a
 * sealed Sugar contract from it. The purpose is to keep ordinary messages on
 * their existing renderer instead of treating lookalike values as protocol.
 *
 * @param value Untrusted inbox content to inspect.
 * @returns Whether the value can safely be read as a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a required, human-facing string without accepting empty protocol
 * fields. This keeps the attention card useful while refusing partial payloads
 * whose purpose or provenance cannot be established.
 *
 * @param value Candidate text from a typed Sugar payload.
 * @returns Trimmed text when it is present, otherwise null.
 */
function requiredText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Validate reference arrays that are part of Sugar's sealed transport shape.
 * The renderer never displays these implementation details; checking them is
 * intentional so a merely similar JSON object cannot opt into the special UI.
 *
 * @param value Candidate list from an inbox payload.
 * @returns Whether every entry is a non-empty string.
 */
function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

/**
 * Turn only complete, versioned Sugar attention payloads into product-language
 * frames. The design deliberately seals the boundary here: generic Parley
 * traffic and malformed lookalikes remain ordinary attention messages.
 *
 * @param content Decoded JSON content from an attention item.
 * @returns A compact human-facing frame, or null when the payload is not sealed Sugar traffic.
 */
function sugarParleyAttentionFrame(content: unknown): SugarParleyAttentionFrame | null {
  if (!isRecord(content)) return null;

  if (content.kind === 'parley_summons') {
    const hook = content.sugarHookContext;
    if (!isRecord(hook)
      || hook.kind !== 'sugar_parley_hook_context'
      || hook.schemaVersion !== 1
      || hook.origin !== 'sugar-parley'
      || !isTextList(hook.evidenceRefs)) {
      return null;
    }
    const parleyId = requiredText(content.parleyId);
    const surface = requiredText(content.surface);
    const reason = requiredText(content.reason);
    const hookParleyId = requiredText(hook.parleyId);
    const hookCardId = requiredText(hook.cardId);
    const hookSurface = requiredText(hook.surface);
    const hookMessage = requiredText(hook.message);
    if (!parleyId || !surface || !reason || !hookParleyId || !hookCardId || !hookSurface || !hookMessage
      || parleyId !== hookParleyId || surface !== hookSurface) {
      return null;
    }
    return {
      title: '⚑ PARLEY BEGUN ⚑',
      subtitle: 'Shared work needs a quick decision',
      tone: 'warning',
      zone: 'A short Sugar-guided conversation is ready',
      rows: [
        { state: 'conflict', label: 'shared work', text: surface },
        { state: 'active', label: 'why now', text: reason },
        { state: 'info', label: 'next', text: 'Reply in plain language and keep the shared work in view.' },
      ],
      footer: 'This conversation is bounded and will leave a clear result.',
    };
  }

  if (content.kind === 'sugar_parley_message') {
    const parleyId = requiredText(content.parleyId);
    const cardId = requiredText(content.cardId);
    const surface = requiredText(content.surface);
    const fromActorId = requiredText(content.fromActorId);
    const message = requiredText(content.message);
    if (content.schemaVersion !== 1
      || content.origin !== 'sugar-parley'
      || !parleyId
      || !cardId
      || !surface
      || !fromActorId
      || !message
      || !isTextList(content.evidenceRefs)
      || !Number.isInteger(content.turnSequence)
      || (content.turnSequence as number) < 1
      || typeof content.at !== 'number'
      || !Number.isFinite(content.at)) {
      return null;
    }
    return {
      title: 'PARLEY UPDATE',
      subtitle: 'A teammate replied about shared work',
      tone: 'running',
      zone: 'There is a new update to consider together',
      rows: [
        { state: 'active', label: 'shared work', text: surface },
        { state: 'info', label: 'update', text: message },
      ],
      footer: 'Reply in plain language when you are ready.',
    };
  }

  if (content.kind === 'sugar_parley_settlement_receipt') {
    const parleyId = requiredText(content.parleyId);
    const proposalId = requiredText(content.proposalId);
    const surface = requiredText(content.surface);
    const reason = requiredText(content.reason);
    const outcome = content.outcome;
    const outcomeParleyId = isRecord(outcome) ? requiredText(outcome.parleyId) : null;
    const outcomeStatus = isRecord(outcome) ? outcome.status : null;
    if (content.schemaVersion !== 1
      || content.state !== 'settled'
      || content.origin !== 'sugar-parley'
      || !parleyId
      || !proposalId
      || !surface
      || !reason
      || !isTextList(content.evidenceRefs)
      || !Array.isArray(content.claimUpdates)
      || !Array.isArray(content.planUpdates)
      || content.remindersSuppressed !== true
      || content.replayed !== false
      || outcomeParleyId !== parleyId
      || (outcomeStatus !== 'COLLAPSED' && outcomeStatus !== 'ESCALATED' && outcomeStatus !== 'VOIDED')) {
      return null;
    }
    return {
      title: 'PARLEY SETTLED',
      subtitle: 'Shared work has a clear path',
      tone: 'confirmed',
      zone: 'The shared-work conversation is complete',
      rows: [
        { state: 'confirmed', label: 'shared work', text: surface },
        { state: 'confirmed', label: 'result', text: reason },
        { state: 'info', label: 'next', text: 'Continue with the agreed work; the result is recorded.' },
      ],
      footer: 'No further coordination is needed for this exchange.',
    };
  }

  return null;
}

function plainWrap(value: string, width: number): string[] {
  const safeWidth = Math.max(8, width);
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (ui.visibleWidth(word) > safeWidth) {
      if (line) {
        lines.push(line);
        line = '';
      }
      for (let index = 0; index < word.length; index += safeWidth) {
        lines.push(word.slice(index, index + safeWidth));
      }
      continue;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (ui.visibleWidth(candidate) <= safeWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function renderPlainCard(
  title: string,
  subtitle: string,
  zone: string,
  rows: Array<{ label: string; text: string }>,
  footer: string,
  requestedWidth?: number,
): string {
  const width = Math.max(20, Math.min(requestedWidth ?? process.stderr.columns ?? 88, 120));
  const inner = width - 4;
  const lines = [`+${'-'.repeat(width - 2)}+`];
  const write = (value: string) => {
    for (const chunk of plainWrap(value, inner)) {
      // `padEnd()` measures UTF-16 code units, not terminal cells. The Parley
      // fanfare includes a double-width flag, so display-width padding is what
      // keeps the no-color narrow layout inside its requested border.
      const padding = ' '.repeat(Math.max(0, inner - ui.visibleWidth(chunk)));
      lines.push(`| ${chunk}${padding} |`);
    }
  };
  write(`${title}: ${subtitle}`);
  write(zone);
  lines.push(`| ${'-'.repeat(inner)} |`);
  for (const row of rows) write(`${row.label}: ${row.text}`);
  lines.push(`| ${'-'.repeat(inner)} |`);
  write(footer);
  lines.push(`+${'-'.repeat(width - 2)}+`);
  return lines.join('\n');
}

function peer(card: SugarParleyCard): string {
  return card.participants
    .filter((participant) => participant.actorId === card.semanticEvidence.peerActorId)
    .map((participant) => participant.agentId)[0]
    ?? card.participants[0]?.agentId
    ?? 'another active agent';
}

function structuralTarget(card: SugarParleyCard): string {
  const { filePath, symbolPath, startLine, endLine } = card.structuralEvidence.address;
  if (symbolPath) return `${filePath}#${symbolPath}`;
  if (startLine !== null || endLine !== null) return `${filePath}#L${startLine ?? '*'}-${endLine ?? '*'}`;
  return filePath;
}

/**
 * Render a sealed Sugar attention payload as a compact, visibly separate
 * product update. Its purpose is to give normal agents a clear coordination
 * moment without exposing JSON fields, protocol verbs, or receipt plumbing.
 *
 * @param content Decoded JSON content from a single attention item.
 * @param options Terminal width and color capabilities for this render.
 * @returns A rendered frame, or null when the value is not a sealed Sugar payload.
 */
export function renderSugarParleyAttention(
  content: unknown,
  options: SugarParleyCardRenderOptions = {},
): string | null {
  const frame = sugarParleyAttentionFrame(content);
  if (!frame) return null;
  if (options.styled === false || options.colorLevel === 'none') {
    return renderPlainCard(
      frame.title,
      frame.subtitle,
      frame.zone,
      frame.rows.map(({ label, text }) => ({ label, text })),
      frame.footer,
      options.width,
    );
  }
  return ui.renderLineworkPanel({
    title: frame.title,
    subtitle: frame.subtitle,
    tone: frame.tone,
    zone: frame.zone,
    rows: frame.rows,
    footer: frame.footer,
    width: options.width,
    colorLevel: options.colorLevel,
    styled: options.styled,
  });
}

/**
 * Render the card as bounded linework. Passing `styled: false` produces the
 * deterministic, ANSI-free plain form for NO_COLOR and incapable terminals.
 */
export function renderSugarParleyCard(
  card: SugarParleyCard,
  options: SugarParleyCardRenderOptions = {},
): string {
  const decision = card.decision.convene
    ? `bounded: ${card.bounds.maxParleyRounds} rounds, ${card.bounds.turnsPerParty} turns per party`
    : card.decision.reason;
  const actions = card.actions
    .map((item) => (item.enabled ? item.label : `${item.label} (unavailable)`))
    .join('  ·  ');
  const zone = card.decision.convene ? 'shared surface detected' : 'coordination held';
  const rows = [
    { label: 'surface', text: structuralTarget(card) },
    {
      label: 'evidence',
      text: `semantic fit ${card.semanticEvidence.similarity.toFixed(2)} + verified claim overlap`,
    },
    { label: 'bounds', text: decision },
    { label: 'actions', text: actions },
  ];
  const footer = 'Choose an action; the coordination receipt keeps this surface bounded.';
  if (options.styled === false || options.colorLevel === 'none') {
    return renderPlainCard('Coordination', peer(card), zone, rows, footer, options.width);
  }
  return ui.renderLineworkPanel({
    title: 'Coordination',
    subtitle: peer(card),
    tone: card.decision.convene ? 'warning' : 'muted',
    zone,
    rows: [
      { state: 'conflict', label: 'surface', text: structuralTarget(card) },
      {
        state: 'active',
        label: 'evidence',
        text: `semantic fit ${card.semanticEvidence.similarity.toFixed(2)} + verified claim overlap`,
      },
      { state: card.decision.convene ? 'pending' : 'muted', label: 'bounds', text: decision },
      { state: 'info', label: 'actions', text: actions },
    ],
    footer,
    width: options.width,
    colorLevel: options.colorLevel,
    styled: options.styled,
  });
}
