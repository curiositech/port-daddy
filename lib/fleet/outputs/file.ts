/**
 * File output sink — writes the payload body to a local file.
 *
 * The recipient is the destination path. `{date}`, `{time}`, `{iso}`
 * template tokens are substituted so a yml entry like
 *   file:write(~/notes/morning-{date}.md)
 * lands in `~/notes/morning-2026-05-20.md` without the agent having to
 * compute the filename at runtime.
 *
 * Subtypes:
 *   write   — overwrite the file (default)
 *   append  — append (creates if missing)
 *
 * Consent posture:
 *   Writing to the local filesystem under the operator's home dir is
 *   their own machine — pii=low passes without an explicit grant.
 *   pii=high (e.g. an exported transcript including message excerpts)
 *   still requires opt-in so the operator has to acknowledge that the
 *   file might end up in backups or sync services.
 */

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { getSharedConsentGate } from '../consent-gate.js';
import type {
  OutputAvailability,
  OutputPayload,
  OutputResult,
  OutputSink,
} from '../types.js';

export class FileOutputSink implements OutputSink {
  readonly kind = 'file' as const;

  async available(): Promise<OutputAvailability> {
    return { ready: true };
  }

  async dispatch(payload: OutputPayload): Promise<OutputResult> {
    if (payload.sink !== 'file') {
      throw new Error(`FileOutputSink received payload for sink="${payload.sink}"`);
    }
    if (!payload.recipient) throw new Error('file output requires payload.recipient (path)');
    if (typeof payload.body !== 'string') throw new Error('file output requires payload.body as string');

    if ((payload.pii ?? 'low') === 'high') {
      getSharedConsentGate().assertAllowed('file', payload);
    }

    const expanded = expandPath(payload.recipient);
    const dir = dirname(expanded);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (payload.type === 'append') {
      appendFileSync(expanded, payload.body, 'utf8');
    } else {
      writeFileSync(expanded, payload.body, 'utf8');
    }

    return {
      url: `file://${expanded}`,
      id: payload.idempotency_key ?? expanded,
      deliveredAt: Date.now(),
      receipt: { path: expanded, mode: payload.type ?? 'write', bytes: Buffer.byteLength(payload.body, 'utf8') },
    };
  }
}

function expandPath(input: string): string {
  const now = new Date();
  const iso = now.toISOString();
  const date = iso.slice(0, 10);            // 2026-05-20
  const time = iso.slice(11, 19).replace(/:/g, '-'); // 17-38-16
  const withTokens = input
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time)
    .replace(/\{iso\}/g, iso.replace(/[:.]/g, '-'));
  if (withTokens.startsWith('~/')) return resolve(homedir(), withTokens.slice(2));
  if (withTokens === '~') return homedir();
  return resolve(withTokens);
}
