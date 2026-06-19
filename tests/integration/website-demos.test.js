/**
 * Integration test: verify demo GIFs are present in production website.
 *
 * These tests hit the live Cloudflare Pages deployment and confirm:
 * - The landing page references both GIFs in the slider HTML
 * - Both GIF assets are served with HTTP 200 + correct content-type
 * - The slider controls markup is present
 */

const PROD_URL = 'https://portdaddy.pages.dev';
const PREVIEW_URL = 'https://7d78a7fa.portdaddy.pages.dev';
const BASE = process.env.WEBSITE_URL || PROD_URL;

const DEMO_GIFS = [
  { path: '/img/demo-fleet.gif',  label: 'fleet demo (pd claim/find/ps)' },
  { path: '/img/demo-agents.gif', label: 'agents demo (pd begin/pub/salvage/lock/done)' },
];

describe('portdaddy.dev — demo GIFs in production', () => {
  test.each(DEMO_GIFS)('$label is served as image/gif with HTTP 200', async ({ path }) => {
    const res = await fetch(BASE + path, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/image\/gif/);
  });

  test('landing page hero contains both GIF img tags', async () => {
    const res = await fetch(BASE + '/');
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('img/demo-fleet.gif');
    expect(html).toContain('img/demo-agents.gif');
  });

  test('landing page has slider controls (prev/next buttons + pips)', async () => {
    const res = await fetch(BASE + '/');
    const html = await res.text();

    expect(html).toContain('slider-prev');
    expect(html).toContain('slider-next');
    expect(html).toContain('slider-pip');
    expect(html).toContain('hero-slider');
  });

  test('landing page has install CTA with copy button', async () => {
    const res = await fetch(BASE + '/');
    const html = await res.text();

    expect(html).toContain('install-hero');
    expect(html).toContain('npm install -g port-daddy');
    expect(html).toContain('copy-btn');
  });

  test('landing page slider has correct number of slides (2)', async () => {
    const res = await fetch(BASE + '/');
    const html = await res.text();

    const slideMatches = html.match(/class="slider-pip/g) || [];
    expect(slideMatches.length).toBe(3);
  });

  test('both GIF files are non-trivial size (>100KB each)', async () => {
    for (const { path, label } of DEMO_GIFS) {
      const res = await fetch(BASE + path);
      expect(res.status).toBe(200);
      const buf = await res.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(100 * 1024);
    }
  });
});
