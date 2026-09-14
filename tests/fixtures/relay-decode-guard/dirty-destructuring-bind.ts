// Fixture for tests/unit/relay-decode-guard.test.js -- pins that destructuring
// BINDS `decodeURIComponent` stays flagged on purpose, in both its shorthand
// and renamed forms, even though a review bot on PR #10156 argued the guard
// should exclude these as false positives.
//
// `const { decodeURIComponent } = globalThis` (or any object) is a genuine,
// real way to get the actual banned global function into scope under any
// alias you like -- exactly the defect class this guard exists to stop from
// being smuggled back in. A guard that waves through the aliasing shape is
// worse than no guard, so both forms below must keep failing the guard, both
// named. Contrast with clean-name-shapes.ts, where a same-shaped-looking
// object-literal KEY (not a destructuring bind) is correctly let through.

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

declare const anything: any;

// Shorthand destructuring bind.
const { decodeURIComponent } = anything;

// Renamed (aliased) destructuring bind -- still pulls the value out of
// `anything` under the banned name first, then renames the LOCAL binding.
const { decodeURIComponent: aliased } = anything;

function notFound(): Response {
  return Response.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const seg = safeDecodeSegment(pathname.slice(1));
    return notFound();
  },
};
