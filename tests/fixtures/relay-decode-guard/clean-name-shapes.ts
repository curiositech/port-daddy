// Fixture for tests/unit/relay-decode-guard.test.js -- pins the PR #10156
// review-finding fix: identifiers spelled `decodeURIComponent` that are
// purely a NAME (they can never be a value-read of the global builtin) and
// so must NOT be flagged. Every shape here was verified empirically against
// the guard before and after the fix; see the `isPureNameNode` doc comment
// in scripts/check-relay-decode-guard.mjs for the full case list and the
// reasoning that keeps destructuring OUT of this allowlist on purpose
// (see dirty-destructuring-bind.ts for that half).

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

// Object-literal property key (non-shorthand `key: value` form).
const handlers = { decodeURIComponent: (s: string) => s.toUpperCase() };
void handlers;

// Import specifier names -- renamed and bare. These bind a name from a
// LOCAL module, never the global builtin.
import { decodeURIComponent as importedHelper } from './helpers';

// Export specifier names -- renamed and bare.
export { importedHelper as decodeURIComponent };

// Type-member names: interface property signature and type-literal member.
interface DecodeShape {
  decodeURIComponent: string;
}
type DecodeAlias = {
  decodeURIComponent: string;
};

// Class-member names: method, field, and accessor, each in its own class to
// avoid an unrelated duplicate-member collision inside one class body.
class DecodeMethodHolder {
  decodeURIComponent(): string {
    return '';
  }
}
class DecodeFieldHolder {
  decodeURIComponent: string = '';
}
class DecodeAccessorHolder {
  get decodeURIComponent(): string {
    return '';
  }
}

// Plain (non-destructuring) declaration names: a parameter and a
// block-scoped variable. Left UNREFERENCED on purpose -- referencing a
// same-named shadow afterwards is a separate, deliberately-still-flagged
// case (see the guard's doc comment); this fixture only pins the
// declaration-name side, so it must stay a name with no subsequent read.
function withParam(decodeURIComponent: string): void {}
{
  const decodeURIComponent = 'not-the-builtin';
}

function notFound(): Response {
  return Response.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    safeDecodeSegment(pathname.slice(1));
    return notFound();
  },
};
