// Fixture: a raw BARE REFERENCE to decodeURIComponent (no trailing "("),
// the exact shape of `.map(decodeURIComponent)` -- proves the guard is
// AST-based, not a text search for "decodeURIComponent(".

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
    // Bare callback reference: no "(" immediately after decodeURIComponent.
    const seg = pathname.slice(1).split('/').filter(Boolean).map(decodeURIComponent);
    return notFound();
  },
};
