/**
 * PWA polish for the fleet's HTML surfaces — Phase 5 of
 * docs/FLEET-SESSION-TRANSCRIPTS.md ("make the web viewer fully responsive
 * and PWA-installable first; SwiftUI later, if demanded").
 *
 * The invariants under test:
 *   1. The manifest and icon routes are PUBLIC static assets: they answer
 *      without any credential, because they carry only app metadata — while
 *      the fleet pages themselves stay no-store and uniform-404.
 *   2. The manifest is well-formed: installable display mode, a start_url on
 *      the one stable fleet surface (/account/runs), scope "/" so per-run
 *      capability URLs open inside the installed app, and icons that resolve
 *      to the PNG routes served here.
 *   3. The HTML shell advertises the PWA: manifest link, apple-touch-icon,
 *      theme-color for both schemes, and a CSP that actually permits the
 *      manifest fetch (manifest-src 'self') — a manifest link behind
 *      default-src 'none' would be decoration.
 */

import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import {
  handleFleetAppleTouchIcon,
  handleFleetIcon192,
  handleFleetIcon512,
  handleFleetManifest,
} from '../src/fleet-pwa.js';
import type { Env } from '../src/types.js';

function req(path: string): Request {
  return new Request(`https://relay.example${path}`);
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('fleet web app manifest', () => {
  it('is served as manifest JSON with installable, honestly-scoped contents', async () => {
    const res = handleFleetManifest();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/manifest+json');
    const manifest = JSON.parse(await res.text());
    expect(manifest.name).toBe('Port Daddy Fleet');
    expect(manifest.display).toBe('standalone');
    // The runs index is the only fleet surface with a stable URL — run
    // receipts are per-run capability URLs, so THE app pins the index.
    expect(manifest.start_url).toBe('/account/runs');
    // Scope "/" keeps opened run receipts and transcript viewers inside the
    // installed app instead of bouncing to the browser.
    expect(manifest.scope).toBe('/');
    const sizes = (manifest.icons as Array<{ src: string; sizes: string; type: string }>).map(
      i => i.sizes,
    );
    expect(sizes).toEqual(['192x192', '512x512']);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.src.startsWith('/fleet/')).toBe(true);
    }
  });

  it('is cacheable — public app metadata, unlike the no-store fleet pages', () => {
    expect(handleFleetManifest().headers.get('Cache-Control')).toContain('public');
  });
});

/** PNG IHDR: width and height are big-endian u32s at byte offsets 16 and 20. */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('fleet icons', () => {
  it('every icon route answers a real PNG at its declared size', async () => {
    const cases: Array<[Response, number]> = [
      [handleFleetAppleTouchIcon(), 180],
      [handleFleetIcon192(), 192],
      [handleFleetIcon512(), 512],
    ];
    for (const [res, size] of cases) {
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_MAGIC);
      // The declared sizes are a contract with the manifest and the
      // apple-touch convention — a mislabeled icon installs blurry.
      expect(pngDimensions(bytes)).toEqual({ width: size, height: size });
    }
  });
});

describe('router: PWA assets are public', () => {
  it('answers all four routes with 200 and no credential of any kind', async () => {
    const env = {} as Env;
    const cases: Array<[string, string]> = [
      ['/fleet/manifest.webmanifest', 'application/manifest+json'],
      ['/fleet/apple-touch-icon.png', 'image/png'],
      ['/fleet/icon-192.png', 'image/png'],
      ['/fleet/icon-512.png', 'image/png'],
    ];
    for (const [path, contentType] of cases) {
      const res = await worker.fetch(req(path), env, {} as ExecutionContext);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe(contentType);
      // Exact cache posture on every asset: public and day-long — these are
      // app metadata, the one thing on /fleet that is ALLOWED to cache — and
      // nosniff so nothing reinterprets them.
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('the asset routes are GET-only — other methods fall through to the 404 posture', async () => {
    const env = {} as Env;
    for (const path of [
      '/fleet/manifest.webmanifest',
      '/fleet/apple-touch-icon.png',
      '/fleet/icon-192.png',
      '/fleet/icon-512.png',
    ]) {
      const res = await worker.fetch(
        new Request(`https://relay.example${path}`, { method: 'POST' }),
        env,
        {} as ExecutionContext,
      );
      expect(res.status).toBe(404);
    }
  });

  it('the fleet HTML shell advertises the PWA and its CSP permits the manifest fetch', async () => {
    // The uniform-404 page goes through the same shell()/htmlResponse pair as
    // every receipt and transcript viewer, so it proves the shared <head> and
    // CSP without needing a captured run.
    const env = {} as Env;
    const res = await worker.fetch(req('/fleet/runs/%zz/transcript/qa'), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("manifest-src 'self'");
    const html = await res.text();
    expect(html).toContain('<link rel="manifest" href="/fleet/manifest.webmanifest">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/fleet/apple-touch-icon.png">');
    expect(html).toContain('viewport-fit=cover');
    // Both schemes get a matching browser-chrome color.
    expect(html).toContain('<meta name="theme-color" content="#f2eee6" media="(prefers-color-scheme: light)">');
    expect(html).toContain('<meta name="theme-color" content="#101216" media="(prefers-color-scheme: dark)">');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="PD Fleet">');
    // viewport-fit=cover without safe-area padding would tuck content under
    // the notch — the two ship together or not at all.
    expect(html).toContain('env(safe-area-inset-top');
    expect(html).toContain('env(safe-area-inset-bottom');
  });

  it('manifest icon srcs resolve to routes this router actually serves', async () => {
    const env = {} as Env;
    const manifest = JSON.parse(
      await (await worker.fetch(req('/fleet/manifest.webmanifest'), env, {} as ExecutionContext)).text(),
    );
    for (const icon of manifest.icons as Array<{ src: string }>) {
      const res = await worker.fetch(req(icon.src), env, {} as ExecutionContext);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
    }
  });
});
