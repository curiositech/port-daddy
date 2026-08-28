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
      lines.push(`| ${chunk.padEnd(inner)} |`);
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
