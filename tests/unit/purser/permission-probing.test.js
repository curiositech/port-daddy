export const RELEASE_TRAIN_TOKEN_SOURCE = 'RELEASE_TRAIN_TOKEN';
export const HOMEBREW_TAP_TOKEN_SOURCE = 'HOMEBREW_TAP_TOKEN';
export const GITHUB_PERMISSION_PROBE_TIMEOUT_MS = 10_000;

export function parseStableVersion(value) { ... }

function parseBooleanFlag(value, label) { ... }

export function selectTokenSource(hasTrainToken, hasTapToken) {
  if (parseBooleanFlag(hasTrainToken, 'RELEASE_TRAIN_TOKEN')) {
    return RELEASE_TRAIN_TOKEN_SOURCE;
  }
  if (parseBooleanFlag(hasTapToken, 'HOMEBREW_TAP_TOKEN')) {
    return HOMEBREW_TAP_TOKEN_SOURCE;
  }
  return null;
}

function permissionProbeUrl(repository) {
  return `https://api.github.com/repos/${repository}`;
}

async function probeRepositoryPushPermission({ repository, token, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? GITHUB_PERMISSION_PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(permissionProbeUrl(repository), {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'port-daddy-release-train',
      },
      signal: controller.signal,
    });
    if (response.status === 403 || response.status === 401) return { ok: false, status: response.status, reason: 'unauthorized' };
    if (!response.ok) return { ok: false, status: response.status, reason: 'http_error' };
    const body = await response.json();
    const permissions = body?.permissions;
    return { ok: permissions?.push === true, permissions, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

export async function selectLiveTokenSource(repository, { trainToken, tapToken, fetchImpl = globalThis.fetch } = {}) {
  if (!trainToken && !tapToken) return null;
  if (trainToken) {
    const probe = await probeRepositoryPushPermission(repository, trainToken, fetchImpl);
    if (probe.ok) return RELEASE_TRAIN_TOKEN_SOURCE;
    console.warn(`...${RELEASE_TRAIN_TOKEN_SOURCE}...`);
  }
  if (tapToken) {
    const probe = await probeRepositoryPushPermission(repository, tapToken, fetchImpl);
    if (probe.ok) return HOMEBREW_TAP_TOKEN_SOURCE;
    console.warn(`...${HOMEBREW_TAP_TOKEN_SOURCE}...`);
  }
  return null;
}