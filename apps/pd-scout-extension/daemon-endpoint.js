(function installScoutEndpoint(globalScope) {
  'use strict';

  const MISSING_ENDPOINT_MESSAGE =
    'Scout has no published Port Daddy endpoint. Open Port Daddy and reconnect Scout.';

  function normalizePublishedEndpoint(value) {
    const candidate = typeof value === 'string' ? value.trim() : '';
    if (!candidate) throw new Error(MISSING_ENDPOINT_MESSAGE);

    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error('Scout received an invalid Port Daddy endpoint. Reconnect it from Port Daddy.');
    }

    const host = parsed.hostname.toLowerCase();
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (parsed.protocol !== 'http:' || !loopback || !parsed.port) {
      throw new Error('Scout only accepts a published local HTTP endpoint with an explicit port.');
    }
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('Scout endpoint must be an origin, without credentials, a path, query, or fragment.');
    }

    return parsed.origin;
  }

  const api = Object.freeze({ MISSING_ENDPOINT_MESSAGE, normalizePublishedEndpoint });
  globalScope.PortDaddyScoutEndpoint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'undefined' ? self : globalThis);
