/** Safety policy for daemon-unavailable recovery. */

export function hasExplicitDaemonEndpoint(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.PD_URL || env.PORT_DADDY_URL || env.PORT_DADDY_PROFILE);
}

export function isLoopbackDaemonUrl(targetUrl: string): boolean {
  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Auto-start is valid only for the implicit local daemon. An explicit URL or
 * profile is an operator-selected peer; replacing its outage with a new local
 * daemon would silently redirect writes into the wrong coordination ledger.
 */
export function shouldAutoStartLocalDaemon(
  targetUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // The compatibility PORT_DADDY_URL export is empty when discovery is using
  // the implicit local socket/port file. Preserve that canonical first-run
  // auto-start path while refusing every explicitly selected endpoint.
  return !hasExplicitDaemonEndpoint(env)
    && (targetUrl.length === 0 || isLoopbackDaemonUrl(targetUrl));
}

export function configuredDaemonUnavailableMessage(targetUrl: string): string {
  try {
    const target = new URL(targetUrl);
    return `Configured Port Daddy peer at ${target.origin} is unavailable; no local daemon was started.`;
  } catch {
    return 'Configured Port Daddy peer is unavailable; no local daemon was started.';
  }
}
