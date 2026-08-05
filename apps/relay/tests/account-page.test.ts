/**
 * Tests for the storefront login + account pages (src/account-page.ts,
 * ADR-0101 Phase 1). Coverage:
 *   - login page: real "Continue with GitHub" link, script-free, honest about
 *     unbuilt magic-link/pairing (marked "Coming soon", not fake-functional).
 *   - account page: renders the REAL identity (login, email, verified state),
 *     escapes user data (XSS guard), wires export/delete/logout to the real
 *     endpoints, and carries NO fabricated device/receipt rows (empty-states
 *     teach instead — the no-Potemkin law).
 *   - handleAccountPage: no session → 302 to /login (session gate).
 */

import { describe, it, expect } from 'vitest';
import {
  renderLoginPage,
  renderAccountPage,
  handleLoginPage,
  handleAccountPage,
} from '../src/account-page.js';
import type { UserRow } from '../src/db.js';
import type { Env } from '../src/types.js';

const baseUser: UserRow = {
  id: 'u_abc',
  github_user_id: 123456,
  login: 'erichowens',
  display_name: 'Erich Owens',
  avatar_url: 'https://avatars.githubusercontent.com/u/123456',
  primary_email: 'erich@example.com',
  email_verified: 1,
  created_at: 1_700_000_000,
  last_login_at: null,
  deleted_at: null,
};

describe('renderLoginPage', () => {
  const html = renderLoginPage();
  it('offers the real GitHub sign-in path', () => {
    expect(html).toContain('Continue with GitHub');
    expect(html).toContain('href="/auth/github/login"');
  });
  it('is script-free (ships under a no-script CSP)', () => {
    expect(html).not.toContain('<script');
  });
  it('is honest about unbuilt affordances (no fake-functional forms)', () => {
    expect(html).toContain('Coming soon');
    // the mockup's magic-link <input type=email> + pairing digits are NOT shipped
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain('Pairing digit');
  });
  it('carries the story-linework identity (cobalt + local-first creed)', () => {
    expect(html).toContain('#003fb8'); // cobalt storefront accent
    expect(html).toContain('Local-first');
  });
  it('keeps the signature color-blocking + signal flags', () => {
    expect(html).toContain('hero ko'); // cobalt knockout slab on the headline
    expect(html).toContain('ko-over'); // cream knockout overlay
    expect(html).toContain('slug-hoist'); // /login spelled in flags
    expect(html).toContain('fl-lima'); // ICS flag glyphs
    expect(html).toContain('Quebec — I request free pratique'); // QUEBEC pairing masthead
  });
});

describe('renderAccountPage', () => {
  it('renders the real identity from the users row', () => {
    const html = renderAccountPage(baseUser);
    expect(html).toContain('Erich Owens');
    expect(html).toContain('github.com/erichowens');
    expect(html).toContain('id 123456');
    expect(html).toContain('erich@example.com');
    expect(html).toContain('verified');
  });
  it('marks an unverified email distinctly', () => {
    const html = renderAccountPage({ ...baseUser, email_verified: 0 });
    expect(html).toContain('unverified');
  });
  it('wires leaving actions to the REAL endpoints', () => {
    const html = renderAccountPage(baseUser);
    expect(html).toContain('href="/account/export"');
    expect(html).toContain('action="/account/delete"');
    expect(html).toContain('action="/auth/logout"');
  });
  it('links prominently to the billing page (rail + Plan & caps door)', () => {
    const html = renderAccountPage(baseUser);
    const matches = html.match(/href="\/account\/billing"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2); // rail nav + section CTA
    expect(html).toContain('Billing &amp; credits');
    expect(html).toContain('Free until enrolled');
  });
  it('contains NO fabricated device/receipt rows (no Potemkin)', () => {
    const html = renderAccountPage(baseUser);
    expect(html).not.toContain('MacBook Pro M4'); // mockup's fake device
    expect(html).not.toContain('01JZC8KQ4M'); // mockup's fake receipt id
    expect(html).toContain('No devices paired yet'); // empty-state teaches instead
  });
  it('keeps the signature color-blocking + Kilo flag', () => {
    const html = renderAccountPage(baseUser);
    expect(html).toContain('flag-kilo'); // KILO devices pairing flag
    expect(html).toContain('Kilo — I wish to communicate with you');
    expect(html).toContain('class="ko"'); // Receipts cobalt knockout slab
    expect(html).toContain('ko-over');
  });
  it('HTML-escapes user data (XSS guard)', () => {
    const html = renderAccountPage({
      ...baseUser,
      display_name: '<script>alert(1)</script>',
      login: 'a"b',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a&quot;b');
  });
});

describe('handleLoginPage', () => {
  it('serves HTML with a script-free CSP', async () => {
    const res = handleLoginPage();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });
});

describe('handleAccountPage', () => {
  it('redirects to /login when there is no session cookie', async () => {
    const req = new Request('https://relay.example/account');
    const res = await handleAccountPage(req, {} as Env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });
});
