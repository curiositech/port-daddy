/**
 * Shared HMAC verification for inbound fleet webhooks (the generic
 * webhook trigger and the email-inbound envelope both authenticate the
 * relay this way). Constant-time comparison; header format
 * `sha256=<hex>` (bare hex tolerated).
 *
 * Remember the load-bearing ADR-0093 rule: a valid HMAC proves the RELAY
 * holds the shared secret — it is transport authentication, and must never
 * raise the trust tier of the CONTENT it carried.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhookHmac(rawBody: Buffer, secret: string, signatureHeader: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader;
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}
