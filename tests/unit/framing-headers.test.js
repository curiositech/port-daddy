import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_TS = readFileSync(join(__dirname, '../../server.ts'), 'utf8');

describe('framing headers (regression guard for fleet-ui Metrics iframe)', () => {
  test('X-Frame-Options is SAMEORIGIN, not DENY', () => {
    // fleet-ui (/fleet-ui/) embeds /metrics.html in an iframe via MetricsPanel.
    // Tightening this back to DENY breaks the in-app Metrics tab.
    expect(SERVER_TS).toMatch(/reply\.header\(\s*['"]X-Frame-Options['"]\s*,\s*['"]SAMEORIGIN['"]/);
    expect(SERVER_TS).not.toMatch(/reply\.header\(\s*['"]X-Frame-Options['"]\s*,\s*['"]DENY['"]/);
  });

  test("CSP frame-ancestors is 'self', not 'none'", () => {
    // Same reason as X-Frame-Options above. The daemon is bound to localhost
    // by the DNS rebinding hook, so same-origin framing is the strictest policy
    // that still allows the embedded Metrics dashboard to render.
    expect(SERVER_TS).toMatch(/frame-ancestors\s+'self'/);
    expect(SERVER_TS).not.toMatch(/frame-ancestors\s+'none'/);
  });
});
