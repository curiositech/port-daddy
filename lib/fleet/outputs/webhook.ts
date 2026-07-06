/**
 * Webhook output sink — POSTs the payload to an arbitrary URL.
 *
 * Fully wired (no stub) — Node's built-in fetch is enough. The recipient
 * is the URL, the body is JSON-encoded, and we forward `correlation_id`
 * as `X-PD-Correlation-Id` so downstream services can thread.
 *
 * Subtypes:
 *   url      — POST to payload.recipient
 *   slack    — alias that wraps payload.body in Slack's {text: ...} shape
 *   discord  — same idea, Discord shape
 *
 * Consent posture:
 *   Outbound webhooks can leak anything if the operator doesn't audit
 *   what they're sending. We refuse `pii=high` unless the URL host is in
 *   the recipientAllowlist for the `webhook` sink.
 */

import { getSharedConsentGate } from '../consent-gate.js';
import { assertSafeOutboundUrl } from '../url-guard.js';
import type {
  OutputAvailability,
  OutputPayload,
  OutputResult,
  OutputSink,
} from '../types.js';

/** Bound every outbound call; a hung receiver fails fast. */
const OUTBOUND_FETCH_TIMEOUT_MS = 15_000;

export class WebhookOutputSink implements OutputSink {
  readonly kind = 'webhook' as const;

  async available(): Promise<OutputAvailability> {
    // fetch is available in Node 18+, which is our floor.
    if (typeof fetch !== 'function') {
      return { ready: false, reason: 'global fetch is not available in this Node runtime.' };
    }
    return { ready: true };
  }

  async dispatch(payload: OutputPayload): Promise<OutputResult> {
    if (payload.sink !== 'webhook') {
      throw new Error(`WebhookOutputSink received payload for sink="${payload.sink}"`);
    }
    if (!payload.recipient) {
      throw new Error('webhook output requires payload.recipient (URL)');
    }

    // Always consent-gate; even pii=low can include enough context to
    // identify the operator when correlated with the receiving service.
    getSharedConsentGate().assertAllowed('webhook', payload);

    // SSRF guard (ADR-0093): the recipient URL is attacker-influenceable when
    // an untrusted trigger drives the agent. Block private/loopback/link-local/
    // cloud-metadata targets and obfuscated-IP forms BEFORE fetch(). An
    // operator may tighten further via extras.allowlist (exact host allowlist).
    const allowlist = Array.isArray(payload.extras?.allowlist)
      ? (payload.extras!.allowlist as unknown[]).filter((h): h is string => typeof h === 'string')
      : undefined;
    assertSafeOutboundUrl(payload.recipient, allowlist ? { allowlist } : {});

    const body = this.shapeBody(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'port-daddy-fleet/1.0',
    };
    if (payload.correlation_id) headers['X-PD-Correlation-Id'] = payload.correlation_id;
    if (payload.idempotency_key) headers['Idempotency-Key'] = payload.idempotency_key;

    // Explicit timeout — an unresponsive receiver must fail the dispatch,
    // never hang it (no infinite waits on any outbound call).
    const res = await fetch(payload.recipient, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`webhook dispatch to ${payload.recipient} returned HTTP ${res.status}`);
    }

    return {
      url: payload.recipient,
      id: payload.idempotency_key ?? `webhook:${Date.now()}`,
      deliveredAt: Date.now(),
      receipt: { status: res.status },
    };
  }

  private shapeBody(payload: OutputPayload): unknown {
    switch (payload.type) {
      case 'slack':
        return { text: `*${payload.title ?? ''}*\n${payload.body ?? ''}`.trim() };
      case 'discord':
        return { content: `**${payload.title ?? ''}**\n${payload.body ?? ''}`.trim() };
      case 'url':
      default:
        return {
          title: payload.title,
          body: payload.body,
          correlation_id: payload.correlation_id,
          extras: payload.extras ?? {},
        };
    }
  }
}
