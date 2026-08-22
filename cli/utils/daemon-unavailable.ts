type ErrorLike = {
  code?: unknown;
  syscall?: unknown;
  cause?: unknown;
};

/**
 * Distinguish daemon transport failures from ordinary command errors.
 *
 * A missing Unix socket is surfaced by Node as ENOENT with syscall=connect.
 * Filesystem operations use the same error code, so matching ENOENT alone
 * turns missing inputs into a misleading daemon auto-start loop.
 */
export function isDaemonUnavailableError(error: unknown): boolean {
  const seen = new Set<object>();

  function visit(candidate: unknown): boolean {
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) {
      return false;
    }

    seen.add(candidate);
    const errorLike = candidate as ErrorLike;
    if (errorLike.code === 'ECONNREFUSED') return true;
    if (errorLike.code === 'ENOENT' && errorLike.syscall === 'connect') return true;
    return visit(errorLike.cause);
  }

  return visit(error);
}
