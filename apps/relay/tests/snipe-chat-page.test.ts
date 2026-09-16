/**
 * Tests for the Snipe chat window (src/snipe-chat-page.ts).
 *
 * The page owns a private `esc()` — every storefront page does, deliberately,
 * so that no page can be made unsafe by an edit to somebody else's module. The
 * cost of that choice is that coverage does not travel either: account-page,
 * billing-page, seamanship-page and parleys-page each prove their own copy, and
 * this page shipped without proving its.
 *
 * It also carries the only `script-src 'nonce-…'` relaxation among these
 * surfaces, because a streaming reply needs client JS. That makes the match
 * between the nonce in the header and the nonce in the tag a property worth
 * pinning rather than assuming: if they ever diverge the script is blocked and
 * the window silently stops working.
 */

import { describe, it, expect } from 'vitest';
import {
  SNIPE_CHAT_NOTICES,
  handleSnipeChatPage,
  renderSnipeChatPage,
  renderSnipeChatPanel,
} from '../src/snipe-chat-page.js';
import { resolveSession } from '../src/auth-github.js';
import { hashHex } from '../src/crypto.js';
import { makeTestD1, seedSession } from './support/d1-sqlite.js';
import type { Env } from '../src/types.js';
import type { UserRow } from '../src/db.js';

const BASE = 'https://portdaddy.dev';
const COOKIE = 'c'.repeat(64);
const CAPS = { messages: 25, tokens: 60_000 };

function userRow(login: string): UserRow {
  return { id: 'u_1', github_user_id: 1, login, created_at: 0, email_verified: 0 } as unknown as UserRow;
}

describe('snipe chat page — the page escapes what it interpolates', () => {
  // The only operator-controlled value the document interpolates is the login,
  // and a GitHub login cannot contain these characters — which is exactly why
  // the escape has to be proven rather than reasoned about. The page must not
  // depend on an upstream character policy for its safety.
  const HOSTILE = '<script>alert(1)</script>';

  it('renders a hostile login escaped, with no raw tag anywhere in the document', () => {
    const html = renderSnipeChatPage(userRow(HOSTILE), 'abc123', CAPS, null);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)');
  });

  it('escapes the quote characters that would break out of an attribute', () => {
    const html = renderSnipeChatPage(userRow(`a"b'c&d`), 'abc123', CAPS, null);
    expect(html).toContain('a&quot;b&#39;c&amp;d');
    expect(html).not.toContain(`a"b'c&d`);
  });

  it('a notice is chosen from the allowlist, never interpolated from the query', () => {
    // The handler maps the query value through SNIPE_CHAT_NOTICES and passes
    // the KEY, so an unknown key renders no notice at all rather than rendering
    // the attacker's string escaped. This pins the allowlist, not the escape.
    expect(renderSnipeChatPanel(CAPS, '<script>')).not.toContain('snipe-notice');
    expect(renderSnipeChatPanel(CAPS, 'nope')).not.toContain('snipe-notice');
    expect(renderSnipeChatPanel(CAPS, 'cross_origin')).toContain(
      SNIPE_CHAT_NOTICES.cross_origin as string,
    );
  });
});

describe('snipe chat page — transport', () => {
  async function signedIn(): Promise<{ res: Response; close: () => void }> {
    const t = makeTestD1();
    seedSession(t, { tokenHash: hashHex(COOKIE) });
    const env = { DB: t.db, PUBLIC_BASE_URL: BASE } as unknown as Env;
    const res = await handleSnipeChatPage(
      new Request(`${BASE}/account/seamanship/chat`, {
        headers: { Cookie: `__Host-pd_session=${COOKIE}` },
      }),
      env,
    );
    return { res, close: () => t.close() };
  }

  it('redirects to /login when signed out', async () => {
    const t = makeTestD1();
    try {
      const env = { DB: t.db, PUBLIC_BASE_URL: BASE } as unknown as Env;
      const res = await handleSnipeChatPage(new Request(`${BASE}/account/seamanship/chat`), env);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/login');
      expect(await resolveSession(new Request(`${BASE}/x`), env)).toBeNull();
    } finally {
      t.close();
    }
  });

  it('the nonce in the script tag is the one the CSP header grants', async () => {
    const { res, close } = await signedIn();
    try {
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      const granted = /script-src 'nonce-([0-9a-f]+)'/.exec(csp)?.[1];
      expect(granted).toBeTruthy();

      const html = await res.text();
      const used = /<script nonce="([0-9a-f]+)">/.exec(html)?.[1];
      expect(used).toBe(granted);
    } finally {
      close();
    }
  });

  it('a fresh request gets a fresh nonce', async () => {
    // A constant nonce is a nonce in name only: one leaked value would let an
    // injected tag execute on every later render.
    const a = await signedIn();
    const b = await signedIn();
    try {
      const one = /nonce-([0-9a-f]+)/.exec(a.res.headers.get('Content-Security-Policy') ?? '')?.[1];
      const two = /nonce-([0-9a-f]+)/.exec(b.res.headers.get('Content-Security-Policy') ?? '')?.[1];
      expect(one).toBeTruthy();
      expect(two).not.toBe(one);
    } finally {
      a.close();
      b.close();
    }
  });

  it('is no-store and noindex — a chat window is not a cacheable page', async () => {
    const { res, close } = await signedIn();
    try {
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    } finally {
      close();
    }
  });
});
