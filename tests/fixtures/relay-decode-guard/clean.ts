// Fixture for tests/unit/relay-decode-guard.test.js. Mimics the real shape of
// apps/relay/src/index.ts closely enough to exercise the guard: a
// safeDecodeSegment helper whose own body calls the raw builtin, and routes
// that all go through it.

/**
 * This comment MENTIONS decodeURIComponent by name (like the real docstring
 * above the real helper) — it must never trip the guard.
 */
function safeDecodeSegment(segment: string): string {
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
      const runId = safeDecodeSegment(pathname.slice('/v1/fleet/runs/'.length));
      return notFound();
    }
    if (pathname.startsWith('/v1/harbors/')) {
      pathname.slice('/v1/harbors/'.length).split('/').map(safeDecodeSegment);
      return notFound();
    }
    return notFound();
  },
};
