import { normalizeRoute, validateFeature } from '../../scripts/check-parity.ts';

function makeSurfaces(overrides = {}) {
  return {
    cliCommands: new Set(['feedback']),
    sdkMethods: new Set(),
    routes: new Set(),
    completions: {
      bash: new Set(['feedback']),
      zsh: new Set(['feedback']),
      fish: new Set(['feedback']),
    },
    readme: {
      cliCommands: new Set(),
      apiEndpoints: new Set(),
    },
    sdkDocs: {
      methods: new Set(),
    },
    mcpTools: new Set(),
    skillMd: {
      cliCommands: new Set(),
      mcpTools: new Set(),
    },
    dashboard: new Set(),
    ...overrides,
  };
}

function feedbackFeature(routes) {
  return {
    description: 'Tuple-backed feedback primitive',
    cli: ['feedback'],
    sdk: [],
    routes,
    completions: ['feedback'],
    docs: { readme: false, sdk: false },
  };
}

describe('check-parity dynamic route matching', () => {
  test('normalizes named route params without losing method or path shape', () => {
    expect(normalizeRoute('GET /feedback/:id')).toBe('GET /feedback/:param');
    expect(normalizeRoute('post /feedback/:feedbackId/harvest')).toBe('POST /feedback/:param/harvest');
    expect(normalizeRoute('GET /projects/:project/feedback/:feedbackId')).toBe('GET /projects/:param/feedback/:param');
  });

  test('does not report feedback routes missing when source and manifest use different param names', () => {
    const report = validateFeature(
      'feedback',
      feedbackFeature(['GET /feedback/:id', 'POST /feedback/:id/harvest']),
      makeSurfaces({
        routes: new Set(['GET /feedback/:param', 'POST /feedback/:param/harvest']),
      }),
    );

    expect(report.issues).toEqual([]);
  });

  test('still reports a real static route mismatch after param normalization', () => {
    const report = validateFeature(
      'feedback',
      feedbackFeature(['GET /feedback/:id', 'POST /feedback/:id/archive']),
      makeSurfaces({
        routes: new Set(['GET /feedback/:param', 'POST /feedback/:param/harvest']),
      }),
    );

    expect(report.issues).toEqual(["Route 'POST /feedback/:id/archive' not found in routes/*.ts"]);
  });
});
