const GITHUB_API = 'https://api.github.com';

export async function fetchRepositoryPermissions(token, repository, { timeoutMs = GITHUB_PERMISSION_PROBE_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${GITHUB_API}/repos/${repository}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'port-daddy-release-train',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} for ${repository}`);
    }
    const body = await response.json();
    return body.permissions ?? null;
  } finally {
    clearTimeout(timer);
  }
}

export async function selectLiveTokenSource(repository, env = process.env) {
  const candidates = [
    { source: RELEASE_TRAIN_TOKEN_SOURCE, token: env.RELEASE_TRAIN_TOKEN },
    { source: HOMEBREW_TAP_TOKEN_SOURCE, token: env.HOMEBREW_TAP_TOKEN },
  ];
  for (const { source, token } of candidates) {
    if (!token) continue;
    try {
      const permissions = await fetchRepositoryPermissions(token, repository);
      if (permissions?.push === true) {
        return source;
      }
      console.warn(`${source} cannot push to ${repository}; trying fallback.`);
    } catch (error) {
      console.warn(`Probe failed for ${source}: ${error.message}`);
    }
  }
  return null;
}