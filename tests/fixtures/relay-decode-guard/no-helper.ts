// Fixture: no safeDecodeSegment anywhere -- the guard's one exemption anchor
// is missing. Must fail loud (exit 2, distinct from a real violation's exit 1)
// rather than silently pass because it found nothing to flag against.

export default {
  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const id = decodeURIComponent(pathname.slice(1));
    return Response.json({ id });
  },
};
