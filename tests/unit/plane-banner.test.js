/**
 * CLI plane banner (S1 — daemon plane identity).
 *
 * Before a MUTATING command writes through a resolved daemon, the CLI fetches
 * `/version` once and warns on stderr when the daemon's state plane is not
 * `prod`. Read-only commands never trigger the probe; fetch failures and
 * legacy daemons (no plane field) stay silent.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  maybeWarnNonProdPlane,
  formatPlaneWarning,
  isMutatingMethod,
  resetPlaneBannerForTests,
  PLANE_BANNER_DISABLE_ENV,
} from '../../cli/utils/plane-banner.js';

function harness({ plane, fail = false } = {}) {
  const fetchVersion = jest.fn(async () => {
    if (fail) throw new Error('daemon unreachable');
    return plane === undefined ? {} : { plane };
  });
  const write = jest.fn();
  return { fetchVersion, write };
}

beforeEach(() => {
  resetPlaneBannerForTests();
});

describe('isMutatingMethod', () => {
  test('POST/PUT/PATCH/DELETE are mutating; GET/HEAD/OPTIONS/undefined are not', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'delete']) {
      expect(isMutatingMethod(m)).toBe(true);
    }
    for (const m of ['GET', 'get', 'HEAD', 'OPTIONS', undefined, '']) {
      expect(isMutatingMethod(m)).toBe(false);
    }
  });
});

describe('formatPlaneWarning', () => {
  test('renders the one-line stderr warning', () => {
    expect(formatPlaneWarning('dev-latest', 'http://127.0.0.1:9886'))
      .toBe('⚠ writes → dev-latest (http://127.0.0.1:9886)');
    expect(formatPlaneWarning('ephemeral:pd-feat-x', 'http://127.0.0.1:4242'))
      .toBe('⚠ writes → ephemeral:pd-feat-x (http://127.0.0.1:4242)');
  });
});

describe('maybeWarnNonProdPlane', () => {
  test('warns once on stderr for a mutating command against a non-prod daemon', async () => {
    const { fetchVersion, write } = harness({ plane: 'dev-latest' });
    await maybeWarnNonProdPlane({
      method: 'POST', fetchVersion, daemonUrl: () => 'http://127.0.0.1:9886', write, env: {},
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('⚠ writes → dev-latest (http://127.0.0.1:9886)\n');
  });

  test('probes at most once per process, even across many mutating calls', async () => {
    const { fetchVersion, write } = harness({ plane: 'ephemeral:x' });
    for (let i = 0; i < 3; i += 1) {
      await maybeWarnNonProdPlane({
        method: 'DELETE', fetchVersion, daemonUrl: () => 'http://u', write, env: {},
      });
    }
    expect(fetchVersion).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  test('read-only commands never probe or warn', async () => {
    const { fetchVersion, write } = harness({ plane: 'dev-latest' });
    await maybeWarnNonProdPlane({
      method: 'GET', fetchVersion, daemonUrl: () => 'http://u', write, env: {},
    });
    await maybeWarnNonProdPlane({
      fetchVersion, daemonUrl: () => 'http://u', write, env: {},
    });
    expect(fetchVersion).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  test('prod plane stays silent', async () => {
    const { fetchVersion, write } = harness({ plane: 'prod' });
    await maybeWarnNonProdPlane({
      method: 'POST', fetchVersion, daemonUrl: () => 'http://u', write, env: {},
    });
    expect(write).not.toHaveBeenCalled();
  });

  test('legacy daemon without a plane field stays silent', async () => {
    const { fetchVersion, write } = harness({});
    await maybeWarnNonProdPlane({
      method: 'POST', fetchVersion, daemonUrl: () => 'http://u', write, env: {},
    });
    expect(write).not.toHaveBeenCalled();
  });

  test('fetch failure stays silent and never throws', async () => {
    const { fetchVersion, write } = harness({ fail: true });
    await expect(maybeWarnNonProdPlane({
      method: 'POST', fetchVersion, daemonUrl: () => 'http://u', write, env: {},
    })).resolves.toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  test(`${PLANE_BANNER_DISABLE_ENV}=1 disables the banner entirely`, async () => {
    const { fetchVersion, write } = harness({ plane: 'dev-latest' });
    await maybeWarnNonProdPlane({
      method: 'POST', fetchVersion, daemonUrl: () => 'http://u', write,
      env: { [PLANE_BANNER_DISABLE_ENV]: '1' },
    });
    expect(fetchVersion).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
