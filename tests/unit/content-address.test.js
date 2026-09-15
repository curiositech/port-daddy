/**
 * scripts/lib/content-address.mjs — the one derivation from bytes to address.
 *
 * Two things are under test, and they are under test together on purpose.
 *
 * The derivation: a sha256 and an extension determine a key, and a key
 * determines a URL. Nothing else in the repository may spell that out
 * independently, because two spellings of one derivation is the drift this
 * module exists to prevent.
 *
 * The refusal: a git-LFS pointer must never be hashed into an address. A
 * pointer is ~131 bytes of text that `git ls-files` still lists and whose
 * extension still matches, so hashing it produces a record that looks
 * completely valid — right path, right extension, a real sha256, a plausible
 * size — addressing a text stub that claims to be an image or a PDF. A
 * regenerate-and-diff check cannot catch it, because regeneration reproduces the
 * same wrong hash. A hard stop is the only thing that can.
 */

import { createHash } from 'node:crypto';
import {
  LFS_POINTER_MAGIC,
  MEDIA_CACHE_CONTROL,
  MEDIA_PUBLIC_BASE,
  assertNotLfsPointer,
  isLfsPointer,
  objectKeyFor,
  publicUrlFor,
} from '../../scripts/lib/content-address.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

describe('the content address is derived, never chosen', () => {
  test('the key shards on the first two hex characters and keeps the extension', () => {
    const digest = sha256('hello');
    expect(objectKeyFor(digest, '.pdf')).toBe(`sha256/${digest.slice(0, 2)}/${digest}.pdf`);
  });

  test('the same bytes always produce the same key, and different bytes do not', () => {
    expect(objectKeyFor(sha256('a'), '.png')).toBe(objectKeyFor(sha256('a'), '.png'));
    expect(objectKeyFor(sha256('a'), '.png')).not.toBe(objectKeyFor(sha256('b'), '.png'));
  });

  test('the extension is normalised, so .PDF and .pdf are one object', () => {
    const digest = sha256('x');
    expect(objectKeyFor(digest, '.PDF')).toBe(objectKeyFor(digest, '.pdf'));
  });

  test('a digest that is not a 64-character lowercase hex sha256 is refused', () => {
    expect(() => objectKeyFor('abc', '.pdf')).toThrow(/64-character lowercase hex/u);
    expect(() => objectKeyFor(sha256('x').toUpperCase(), '.pdf')).toThrow(/64-character lowercase hex/u);
  });

  test('an extension without its dot is refused rather than silently joined', () => {
    expect(() => objectKeyFor(sha256('x'), 'pdf')).toThrow(/must start with a dot/u);
  });

  test('the URL is derived from the key, so the two cannot disagree', () => {
    const key = objectKeyFor(sha256('x'), '.pdf');
    expect(publicUrlFor(key)).toBe(`${MEDIA_PUBLIC_BASE}/${key}`);
  });

  test('the public base is the custom domain, never r2.dev', () => {
    expect(MEDIA_PUBLIC_BASE).toBe('https://media.portdaddy.dev');
    expect(MEDIA_PUBLIC_BASE).not.toMatch(/r2\.dev/u);
  });

  test('the cache policy is the immutable one content addressing earns', () => {
    expect(MEDIA_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
  });
});

describe('a git-LFS pointer is refused, never hashed', () => {
  // A real pointer, byte-for-byte in shape. Writing one needs no git-lfs.
  const POINTER = Buffer.from(
    `${LFS_POINTER_MAGIC}\noid sha256:${'a'.repeat(64)}\nsize 555965\n`,
  );

  test('the fixture is pointer-sized, as a real one is', () => {
    expect(POINTER.length).toBeGreaterThan(120);
    expect(POINTER.length).toBeLessThan(200);
  });

  test('a pointer is recognised', () => {
    expect(isLfsPointer(POINTER)).toBe(true);
  });

  test('real media is not mistaken for a pointer', () => {
    expect(isLfsPointer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false);
    expect(isLfsPointer(Buffer.from('%PDF-1.5\n'))).toBe(false);
    expect(isLfsPointer(Buffer.alloc(0))).toBe(false);
  });

  test('the check is bounded: a large file starting with the magic is not a pointer', () => {
    const big = Buffer.concat([POINTER, Buffer.alloc(4096)]);
    expect(isLfsPointer(big)).toBe(false);
  });

  test('assertNotLfsPointer passes real media through silently', () => {
    expect(() => assertNotLfsPointer(Buffer.from('%PDF-1.5\n'), 'a.pdf')).not.toThrow();
  });

  test('assertNotLfsPointer names the file and the byte count', () => {
    expect(() => assertNotLfsPointer(POINTER, 'docs/pr-assets/smudged.png'))
      .toThrow(/docs\/pr-assets\/smudged\.png is a git-LFS POINTER \(\d+ bytes of text\)/u);
  });

  test('the error explains the fix, not only the symptom', () => {
    expect(() => assertNotLfsPointer(POINTER, 'a.png')).toThrow(/git lfs install && git lfs pull/u);
  });

  test('the error warns about `git show`, which is the silent way in', () => {
    // `git show <ref>:<path>` returns the POINTER for an LFS-tracked path even
    // when the working tree holds the real bytes. A tool that reads blobs that
    // way, rather than reading the working tree, gets stubs and cannot tell.
    expect(() => assertNotLfsPointer(POINTER, 'a.png')).toThrow(/git show/u);
  });

  test('hashing a pointer would produce a plausible-looking address, which is why this is a hard stop', () => {
    // Demonstrating the hazard rather than describing it: the address derived
    // from a pointer is structurally indistinguishable from a real one.
    const key = objectKeyFor(sha256(POINTER), '.png');
    expect(key).toMatch(/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/u);
    // Nothing about the key betrays that its object is 131 bytes of text — so
    // the refusal has to happen before the hash, not after it.
    expect(isLfsPointer(POINTER)).toBe(true);
  });
});
