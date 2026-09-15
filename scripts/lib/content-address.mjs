// Content addressing for published media, in one place.
//
// WHY THIS IS A MODULE AND NOT THREE LINES INLINE. A content address is a
// derivation: given the sha256 of some bytes and the extension they are served
// under, there is exactly one key and exactly one URL. The moment two callers
// each spell that derivation out, they are two sources of truth for the same
// answer and one of them will drift — which is the failure this repository keeps
// re-discovering and which the manifest work exists to end. So the derivation
// lives here, and everything that needs a key or a URL imports it.
//
// Node stdlib only, and no side effects, so a CI checker, a TypeScript build
// script and a test can all import it with no install step.

/**
 * The bucket's public custom domain.
 *
 * Not `r2.dev`: Cloudflare documents that subdomain as rate-limited,
 * development-only, and not subject to cache rules. A custom domain bound to the
 * bucket is the supported way to serve objects publicly.
 */
export const MEDIA_PUBLIC_BASE = 'https://media.portdaddy.dev';

/**
 * Cache policy for a content-addressed object.
 *
 * `immutable` is a promise, and content addressing is what makes it true rather
 * than hopeful: the bytes at a key cannot change, because changing the bytes
 * changes the key. A year is therefore safe and a revalidation request is never
 * needed.
 */
export const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * The object key for some bytes: `sha256/<first two hex>/<64 hex><ext>`.
 *
 * The two-character shard keeps any single listing prefix small. The extension
 * rides on the end so a browser following a direct link gets a sensible
 * download name and so the object's Content-Type is derivable from its key
 * alone.
 *
 * @param {string} sha256 lowercase hex digest of the object's bytes
 * @param {string} extension including the leading dot, e.g. `.pdf`
 */
export function objectKeyFor(sha256, extension) {
  if (!/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new Error(`content-address: expected a 64-character lowercase hex sha256, got ${JSON.stringify(sha256)}`);
  }
  const ext = extension.toLowerCase();
  if (ext !== '' && !ext.startsWith('.')) {
    throw new Error(`content-address: extension must start with a dot, got ${JSON.stringify(extension)}`);
  }
  return `sha256/${sha256.slice(0, 2)}/${sha256}${ext}`;
}

/** The URL a reader follows. Derived from the key, so the two cannot disagree. */
export function publicUrlFor(key, publicBase = MEDIA_PUBLIC_BASE) {
  return `${publicBase}/${key}`;
}

/**
 * The first bytes of a git-LFS pointer file. A pointer is ~130 bytes of text:
 *
 *     version https://git-lfs.github.com/spec/v1
 *     oid sha256:<64 hex>
 *     size <n>
 */
export const LFS_POINTER_MAGIC = 'version https://git-lfs.github.com/spec/v1';

/**
 * True when these bytes are a git-LFS pointer rather than the media they name.
 *
 * THE BUG THIS EXISTS TO MAKE IMPOSSIBLE. Content addressing hashes whatever is
 * on disk. In a checkout where the LFS smudge filter did not run — no `git lfs`
 * installed, `GIT_LFS_SKIP_SMUDGE=1`, or a blob read straight out of the object
 * store with `git show <ref>:<path>`, which returns the pointer for an
 * LFS-tracked path — a tracked PNG is present as ~131 bytes of text. It is still
 * listed by `git ls-files` and its extension is still `.png`. Hashing it yields
 * a record with the right path, the right extension, a real sha256 and a
 * plausible size, addressing an object that is a text stub claiming to be an
 * image. Nothing downstream can tell: a regenerate-and-diff check PASSES,
 * because regeneration reproduces the same wrong hash.
 *
 * A wrong-but-plausible record is worse than a hard stop. Callers that address
 * media must refuse a pointer rather than hash it.
 *
 * The check is bounded by length because a pointer is never large; that keeps it
 * from scanning a multi-megabyte file and keeps real media that happens to begin
 * with ASCII from being misread.
 *
 * @param {Buffer|Uint8Array} bytes
 */
export function isLfsPointer(bytes) {
  if (bytes.length > 1024) return false;
  const head = Buffer.from(
    bytes.buffer ?? bytes,
    bytes.byteOffset ?? 0,
    Math.min(bytes.length, LFS_POINTER_MAGIC.length),
  );
  return head.toString('latin1') === LFS_POINTER_MAGIC;
}

/** Throw a message that names the fix, not just the symptom. */
export function assertNotLfsPointer(bytes, repoRelativePath) {
  if (!isLfsPointer(bytes)) return;
  throw new Error(
    `${repoRelativePath} is a git-LFS POINTER (${bytes.length} bytes of text), not the media it names. `
    + 'Addressing it would publish a text stub under a key that claims to be the real file, and a '
    + 'regenerate-and-diff check could never tell, because regeneration reproduces the same wrong hash.\n'
    + '  Fix the checkout:  git lfs install && git lfs pull\n'
    + '  (and make sure GIT_LFS_SKIP_SMUDGE is not set; note that `git show <ref>:<path>` returns the\n'
    + '   pointer for an LFS-tracked path even when the working tree holds the real bytes).',
  );
}
