// Fixture: the SAME shape as clean.ts -- a fail-closed decode helper whose
// own body calls the raw builtin, and every route going through it, zero
// stray raw references anywhere -- except the helper itself has been renamed
// from `safeDecodeSegment` to `decodeSegmentSafely`, consistently, at both
// its declaration and every call site. This is the regression fixture for
// "the guard fails closed if the sanctioned helper is renamed": the code
// here is internally consistent and would be perfectly safe at runtime, but
// the guard's own config still says `helperName: 'safeDecodeSegment'`, so it
// must find no anchor and exit 2 -- NOT silently report this file clean just
// because it also finds zero raw `decodeURIComponent` references outside a
// function it can no longer locate by name.

/**
 * This comment MENTIONS decodeURIComponent by name -- it must never trip the
 * guard, renamed helper or not.
 */
function decodeSegmentSafely(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

function notFound(): Response {
  return Response.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/v1/fleet/runs/')) {
      decodeSegmentSafely(pathname.slice('/v1/fleet/runs/'.length));
      return notFound();
    }
    if (pathname.startsWith('/v1/harbors/')) {
      pathname.slice('/v1/harbors/'.length).split('/').map(decodeSegmentSafely);
      return notFound();
    }
    return notFound();
  },
};
