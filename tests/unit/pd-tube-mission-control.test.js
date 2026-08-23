import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

const ROOT = join(import.meta.dirname, '..', '..');
const SOURCE_PATH = 'examples/pd-tube/mission-control.html';
const BUNDLED_PATH = 'public/samples/files/examples/pd-tube/mission-control.html';
const RESPONDER_PATH = 'examples/pd-tube/agent-responder.py';
const BUNDLED_RESPONDER_PATH = 'public/samples/files/examples/pd-tube/agent-responder.py';

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('PD Tube Mission Control sample', () => {
  it('redirects opaque file previews through the daemon sample route', () => {
    const html = read(SOURCE_PATH);
    const redirect = 'window.location.replace(`${DEFAULT_DAEMON}${SAMPLE_PATH}${window.location.search}`)';

    expect(html).toContain("const DEFAULT_DAEMON = 'http://127.0.0.1:9876'");
    expect(html).toContain("const SAMPLE_PATH = '/samples/files/examples/pd-tube/mission-control.html'");
    expect(html).toContain("['http:', 'https:'].includes(window.location.protocol)");
    expect(html).toContain(redirect);
    expect(html.indexOf(redirect)).toBeLessThan(html.indexOf("document.querySelectorAll('button[data-action]')"));
  });

  it('uses the serving daemon origin and keeps the public bundle byte-identical', () => {
    const source = read(SOURCE_PATH);
    const bundled = read(BUNDLED_PATH);
    const manifest = JSON.parse(read('public/samples/manifest.json'));
    const entry = manifest.files.find(({ path }) => path === SOURCE_PATH);

    expect(source).toContain('const DAEMON = servedByDaemon ? window.location.origin : DEFAULT_DAEMON');
    expect(bundled).toBe(source);
    expect(entry).toEqual(expect.objectContaining({
      bytes: Buffer.byteLength(source),
      sha256: createHash('sha256').update(source).digest('hex'),
    }));
  });

  it('ships the portable responder without claiming work it did not perform', () => {
    const source = read(RESPONDER_PATH);
    const bundled = read(BUNDLED_RESPONDER_PATH);
    const manifest = JSON.parse(read('public/samples/manifest.json'));
    const entry = manifest.files.find(({ path }) => path === RESPONDER_PATH);

    expect(source).toContain('PORT_DADDY_DAEMON_URL');
    expect(source).toContain('This sample did not push or run smoke checks');
    expect(source).toContain('except KeyboardInterrupt:');
    expect(source).not.toContain('Pushed to staging, smoke check green');
    expect(bundled).toBe(source);
    expect(entry).toEqual(expect.objectContaining({
      bytes: Buffer.byteLength(source),
      sha256: createHash('sha256').update(source).digest('hex'),
    }));
  });
});
