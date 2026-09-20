// Fixture: `clean.ts` plus route #14, added with a raw decodeURIComponent()
// call instead of routing through safeDecodeSegment -- the exact regression
// this guard exists to catch.

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
    // route #14 -- raw, unguarded
    if (pathname.startsWith('/v1/new-thing/')) {
      const id = decodeURIComponent(pathname.slice('/v1/new-thing/'.length));
      return notFound();
    }
    return notFound();
  },
};
