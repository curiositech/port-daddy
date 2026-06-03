/**
 * macOS notification output sink — fires a banner via osascript.
 *
 * This is one of the few sinks that's safe to wire fully: osascript is
 * always available on macOS and doesn't require operator setup beyond
 * the standard "allow notifications for Terminal/osascript" prompt the
 * OS shows on first use.
 *
 * On non-macOS platforms `available()` returns false so the fleet engine
 * surfaces a clear error instead of silently no-oping.
 *
 * Consent posture:
 *   Notifications never leave the local machine, so pii=low payloads can
 *   pass without a consent grant. pii=high still requires opt-in because
 *   a notification can include calendar attendee names, message excerpts,
 *   etc. that the operator may not want appearing on a lock screen.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSharedConsentGate } from '../consent-gate.js';
import type {
  OutputAvailability,
  OutputPayload,
  OutputResult,
  OutputSink,
} from '../types.js';

const execFileAsync = promisify(execFile);

export class MacOSNotificationSink implements OutputSink {
  readonly kind = 'notify' as const;

  async available(): Promise<OutputAvailability> {
    if (process.platform !== 'darwin') {
      return {
        ready: false,
        reason: 'notify:os sink only works on macOS. For Linux/Windows use a webhook to a desktop notifier.',
      };
    }
    return { ready: true };
  }

  async dispatch(payload: OutputPayload): Promise<OutputResult> {
    if (payload.sink !== 'notify') {
      throw new Error(`MacOSNotificationSink received payload for sink="${payload.sink}"`);
    }

    // pii=high payloads need consent (notification body might include
    // private details). pii=low is fine.
    if (payload.pii === 'high') {
      getSharedConsentGate().assertAllowed('notify', payload);
    }

    const title = sanitize(payload.title ?? 'Fleet');
    const body = sanitize(payload.body ?? '');
    // The classic osascript route. Sub-second latency, no extra deps.
    const script = `display notification "${body}" with title "${title}"`;

    try {
      await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
      return {
        id: payload.idempotency_key ?? `notify:${Date.now()}`,
        deliveredAt: Date.now(),
        receipt: { title, body },
      };
    } catch (err) {
      throw new Error(`notify:os dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Strip characters that would break the AppleScript string literal.
 * Notifications support only a plain string, so newlines collapse and
 * double quotes / backslashes are escaped.
 */
function sanitize(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
    .slice(0, 256);
}
