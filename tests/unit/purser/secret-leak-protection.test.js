export async function selectLiveToken(repository, {
  trainToken,
  tapToken,
  fetchImpl = fetch,
  timeoutMs = GITHUB_PERMISSION_PROBE_TIMEOUT_MS,
} = {}) {
  const candidates = [
    { source: RELEASE_TRAIN_TOKEN_SOURCE, token: trainToken },
    { source: HOMEBREW_TAP_TOKEN_SOURCE, token: tapToken },
  ];
  for (const candidate of candidates) {
    if (!candidate.token) continue;
    const ok = await probePushPermission(repository, candidate.token, { fetchImpl, timeoutMs });
    if (ok) return candidate.source;
    console.warn(`sanitized probe warning for ${candidate.source}`);
  }
  return null;
}