// tests/unit/purser/header-validation.test.ts
import { parleyNotFoundPage } from '../../../apps/relay/src/parleys-page.js';

describe('parleyNotFoundPage', () => {
  it('returns a 404 with the required headers and a script‑free CSP', async () => {
    const resp = parleyNotFoundPage();

    // Status
    expect(resp.status).toBe(404);

    // Cache‑Control
    expect(resp.headers.get('Cache-Control')).toBe('no-store');

    // X‑Robots‑Tag
    expect(resp.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');

    // Content‑Security‑Policy
    const csp = resp.headers.get('Content-Security-Policy');
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');

    // Body sanity check
    const body = await resp.text();
    expect(body).toContain('Not found');
    // Ensure the body is not an empty or truncated page
    expect(body.length).toBeGreaterThan(200);
  });
});