import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');
const metricsHtml = readFileSync(join(ROOT, 'public', 'metrics.html'), 'utf8');

describe('metrics dashboard html', () => {
  it('renders explicit loading and error states instead of blank panels', () => {
    expect(metricsHtml).toContain('function renderInitialState()');
    expect(metricsHtml).toContain('function renderMetricsUnavailable(error)');
    expect(metricsHtml).toContain('class="state-message');
    expect(metricsHtml).toContain('Skill distribution unavailable');
    expect(metricsHtml).toContain('Route histograms unavailable');
    expect(metricsHtml).not.toContain('catch {}');
  });

  it('uses the current Fleet Control Center visual tokens', () => {
    expect(metricsHtml).toContain('--pd-bg: #121210');
    expect(metricsHtml).toContain('--pd-surface: #1c1a17');
    expect(metricsHtml).toContain('html[data-theme="light"]');
    expect(metricsHtml).toContain('body.embed header { display: none; }');
    expect(metricsHtml).toContain('font-family: var(--pd-font-ui)');
  });

  it('detects file previews before issuing daemon API fetches', () => {
    expect(metricsHtml).toContain("window.location.protocol === 'file:'");
    expect(metricsHtml).toContain('This file preview cannot reach the daemon metrics API');
    expect(metricsHtml).toContain('async function fetchJson(path)');
    expect(metricsHtml).toMatch(/throw new Error\(apiErrorMessage\(\)\)/);
  });
});
