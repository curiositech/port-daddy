/**
 * Pure helpers for the email ingress Worker — factored out of worker.ts so
 * they unit-test without workerd.
 */

export interface InboundEnvelope {
  from: string;
  to: string[];
  subject: string;
  /** ISO-8601. */
  date: string;
  bodyText: string;
  hasHtml: boolean;
  messageId?: string;
  references?: string[];
  /** DMARC verdict parsed from Authentication-Results: 'pass' | 'fail' | 'none'. */
  dmarc: string;
}

/**
 * Parse the DMARC verdict out of an Authentication-Results header value.
 * Cloudflare Email Routing stamps this after evaluating SPF/DKIM/DMARC on
 * ingest. Anything unparseable reads as 'none' — never guess 'pass'.
 */
export function parseDmarc(authenticationResults: string | null | undefined): string {
  if (!authenticationResults) return 'none';
  // Anchored to a token start (string start, whitespace, or `;` separator)
  // so a hyphenated look-alike like `x-fake-dmarc=pass` cannot match.
  const m = /(?:^|[\s;])dmarc=([a-z]+)/i.exec(authenticationResults);
  if (!m) return 'none';
  const verdict = m[1].toLowerCase();
  return verdict === 'pass' || verdict === 'fail' ? verdict : 'none';
}

export interface BuildEnvelopeInput {
  from: string;
  to: string;
  subject: string | null;
  date: string | null;
  bodyText: string | null;
  hasHtml: boolean;
  messageId: string | null;
  references: string | null;
  authenticationResults: string | null;
}

/** Cap the body so a 20MB attachment-laden message cannot balloon the
 *  envelope past the daemon's request limits. Agents get the head. */
const MAX_BODY_CHARS = 64_000;

export function buildInboundEnvelope(input: BuildEnvelopeInput): InboundEnvelope {
  const bodyText = (input.bodyText ?? '').slice(0, MAX_BODY_CHARS);
  return {
    from: input.from,
    to: [input.to],
    subject: input.subject ?? '',
    date: input.date ?? new Date().toISOString(),
    bodyText,
    hasHtml: input.hasHtml,
    messageId: input.messageId ?? undefined,
    references: input.references
      ? input.references.split(/\s+/).filter(Boolean)
      : undefined,
    dmarc: parseDmarc(input.authenticationResults),
  };
}

/** HMAC-SHA256 over the exact body bytes, matching the daemon's
 *  verifyWebhookHmac (`sha256=<hex>` header format). WebCrypto flavor. */
export async function signBody(body: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256=${hex}`;
}

/** Constant-time-ish verify for /send requests (daemon → worker). */
export async function verifySignature(body: string, secret: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const expected = await signBody(body, secret);
  const provided = header.startsWith('sha256=') ? header : `sha256=${header}`;
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}
