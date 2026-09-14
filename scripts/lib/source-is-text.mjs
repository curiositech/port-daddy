/**
 * The "source stays text" invariant, and the primitives that enforce it.
 *
 * INVARIANT: every tracked source file in this repo is free of literal NUL
 * bytes, repo-wide, at every offset.
 *
 * WHY: a literal NUL byte in a source file is legal TypeScript/JavaScript and
 * compiles fine, so nothing catches it — but git classifies any blob with a
 * NUL in its first 8000 bytes as BINARY, and every consequence is silent:
 *
 *   - ripgrep prints `binary file matches (found "\0" byte around offset N)`
 *     with no line numbers and no content. To an agent navigating the repo by
 *     search, that is indistinguishable from "this symbol is used nowhere" —
 *     `rg createSuggestions lib/suggestions.ts` hid three real hits this way.
 *   - The three-way merge driver takes one side WHOLESALE instead of merging
 *     hunks. In 47964247a that silently discarded #9352's ADR-0086 planner
 *     columns from lib/roadmap-items.ts: no conflict marker, green build,
 *     work gone. Recovery took a hand-run `git merge-file` (2dcd80f9f).
 *   - Without `.gitattributes` saying otherwise, `git diff` degrades to
 *     `Bin 7463 -> 9147 bytes` and `git blame` has nothing to attribute.
 *
 * `.gitattributes` sets `text diff` and fixes the READING half. Nothing in
 * `.gitattributes` fixes the MERGE half — the binary check sits inside git's
 * built-in merge driver, ahead of the attribute (measured: `text diff`,
 * `text diff merge`, `merge=union`, and a custom driver all still refuse).
 * So NOT WRITING THE NUL is the only real defence, and the guard built on
 * these primitives is it.
 *
 * THE FIX when the guard fails: replace the raw NUL with the six-character
 * source escape `\u0000`. The runtime string is byte-identical — only the
 * bytes on disk change — so sentinel/join semantics are completely unaffected.
 *
 * SCOPE: driven off `git ls-files` rather than a directory walk, so the
 * guard's notion of "source" is exactly git's. A hand-rolled walk has to
 * enumerate directories, and the previous incarnation of this guard (in
 * apps/fleet-executor) only ever looked at two of them — every offender that
 * shipped lived outside its scope. Anything git tracks with an extension
 * `.gitattributes` calls text is covered, with no directory list to forget to
 * update.
 *
 * STRICTER THAN GIT, DELIBERATELY: `findNulOffenders` scans the WHOLE buffer,
 * not git's first-8000-bytes sniff window. A NUL at offset 8500 leaves git
 * still calling the file text — while ripgrep, which is not bound by that
 * window, still refuses to print the matching lines. The gap between the two
 * windows is exactly where the silent-search failure lives, so the guard
 * closes it rather than mirroring git's heuristic.
 *
 * WHY A MODULE: these were once private to tests/unit/source-is-text.test.js,
 * which left nothing importable to drive with a fixture. A "test" written
 * against that shape could only re-implement the check and assert on its own
 * re-implementation — which is what happened, and it passed with the guard
 * deleted from the tree. The seam exists so a test can point the scanner at a
 * fixture directory and watch it succeed or fail for real.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Extensions the guard treats as source.
 *
 * Kept in lockstep with the pattern list in .gitattributes, and that lockstep
 * is asserted BOTH ways by tests/unit/source-is-text.test.js: every extension
 * here must be declared text/diff/merge, and every extension declared there
 * must appear here. One direction alone is not enough — it would let a new
 * `*.mts` line in .gitattributes sit unguarded, which is the same blind-spot
 * shape that let the old per-workspace guard miss every offender it was
 * written to catch.
 *
 * @type {readonly string[]}
 */
export const TEXT_EXTENSIONS = ['ts', 'tsx', 'js', 'mjs', 'cjs', 'rs', 'json'];

/**
 * Tracked files that legitimately contain a raw NUL despite carrying a source
 * extension — a fixture that must hold real binary bytes, say.
 *
 * EMPTY ON PURPOSE. Every tracked source file in this repo is NUL-free, and a
 * genuine exception should be rare enough to argue for in review. If you add
 * one, give the path AND the reason on the same line, and prefer a `.bin`
 * fixture (which these patterns do not cover) over an entry here.
 *
 * @type {Set<string>}
 */
export const ALLOWED_BINARY_SOURCE = new Set([]);

/**
 * Extensions `.gitattributes` routes to git-lfs with a bare, repo-wide
 * `*.ext ... -text` glob.
 *
 * WHY THIS LIST HAS TO EXIST. `declaredExtensions` below maps every bare
 * `*.ext` pattern to "a source extension declared text", because until the
 * repo-wide LFS block landed that is the only thing a bare glob could be. A
 * bare `*.png ... -text` line would therefore be read as "png is a source
 * extension", `declaredNotGuarded` would list it, and the lockstep test would
 * fail on a correct change. (Measured before writing this: appending one bare
 * `*.png` line to .gitattributes produced exactly `declaredNotGuarded:
 * ['png']`.)
 *
 * So binary globs get their own side of the lockstep rather than an exemption.
 * The test asserts this list and the bare `-text` globs in .gitattributes match
 * EXACTLY, in both directions -- the same discipline TEXT_EXTENSIONS gets, for
 * the same reason: a list nobody cross-checks is a list that rots.
 *
 * The one thing this must never do is let a SOURCE extension be waved through
 * by writing `-text` beside it. `declaredExtensions` refuses that explicitly: a
 * bare glob whose extension is in TEXT_EXTENSIONS goes to `unparsed` even when
 * it declares `-text`, so `*.ts ... -text` fails the guard loudly instead of
 * silently removing TypeScript from the NUL scan.
 *
 * @type {readonly string[]}
 */
export const BINARY_MEDIA_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'tiff', 'mp4', 'mov', 'webm', 'pdf',
];

/**
 * `.gitattributes` patterns that are path-scoped (not a bare `*.ext`) and
 * explicitly mark their files `-text` (binary, LFS-tracked). These sit
 * outside this guard's invariant entirely — a "keep source text" scan has
 * nothing to say about a PNG or PDF that is deliberately non-text — so they
 * are named here rather than left to fall into `unparsed`, which exists to
 * catch a pattern nobody has looked at, not one that is intentionally binary.
 * Give the path AND the reason if you add one; do not use this list for a
 * pattern that declares `text` (positive) for a real source extension.
 *
 * @type {Set<string>}
 */
export const ALLOWED_NON_TEXT_PATTERNS = new Set([
  // Build-input exemptions: these two trees are read by a build, so their media
  // must stay ordinary blobs rather than LFS pointers. See the "BUILD INPUTS"
  // block in .gitattributes for why each tree is on the list, and ADR-0142
  // section 2.1 for the underlying rule.
  ...['website-v2/public', 'core/pd-console'].flatMap((dir) =>
    BINARY_MEDIA_EXTENSIONS.map((ext) => `${dir}/**/*.${ext}`),
  ),
  // Carve-out: stays in plain git because
  // tests/unit/spawn-whitepaper-contract.test.js pins the sha256 of two files
  // in it and parses the PNG IHDR for exact dimensions. Still `-text` (it is
  // binary media), so it belongs on this list for the same reason.
  'docs/artifacts/whitepaper-figure-semantics/**',
]);

/**
 * Every file git tracks under a source extension, minus the allowlist.
 *
 * @param {string} repoRoot Absolute path to the repository root.
 * @returns {string[]} Repo-relative paths, in `git ls-files` order.
 */
export function trackedSourceFiles(repoRoot) {
  const patterns = TEXT_EXTENSIONS.map((e) => `*.${e}`);
  const out = execFileSync('git', ['ls-files', '-z', '--', ...patterns], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((f) => !ALLOWED_BINARY_SOURCE.has(f));
}

/**
 * Files whose bytes contain a literal NUL, anywhere in the file.
 *
 * `root` is a parameter rather than a constant so a test can drive this over a
 * fixture directory instead of the working tree — that seam is the difference
 * between exercising the guard and re-implementing it.
 *
 * Scans the ENTIRE buffer on purpose: git only sniffs the first 8000 bytes,
 * ripgrep does not, and a NUL past 8000 is the case where git still calls the
 * file text while search has already gone quiet. Truncating this to
 * `buf.subarray(0, 8000)` would reopen exactly that hole.
 *
 * A file that cannot be read is NOT an offender: git can track a path that is
 * absent from the working tree (sparse checkout, mid-rebase), and the guard
 * should not fail on a checkout shape rather than on a real NUL.
 *
 * @param {readonly string[]} files Paths relative to `root`.
 * @param {string} root Directory the paths are resolved against.
 * @returns {string[]} The subset of `files` containing a NUL byte.
 */
export function findNulOffenders(files, root) {
  return files.filter((f) => {
    let buf;
    try {
      buf = readFileSync(resolve(root, f));
    } catch {
      return false; // tracked but absent (sparse checkout / mid-rebase)
    }
    return buf.includes(0);
  });
}

/**
 * Batch `git check-attr` over many paths.
 *
 * check-attr is pure pattern matching and does not require the file to exist,
 * so a synthetic probe path is a legitimate way to cover an extension with no
 * tracked members today.
 *
 * @param {readonly string[]} paths Paths to query.
 * @param {readonly string[]} attrs Attribute names, e.g. `['text','diff','merge']`.
 * @param {string} repoRoot Absolute path to the repository root.
 * @returns {Record<string, Record<string, string>>} `{ path: { attr: value } }`.
 */
export function checkTextAttributes(paths, attrs, repoRoot) {
  // `input` must be a Buffer: passing a string alongside a 'buffer' encoding
  // makes Node try Buffer.from(str, 'buffer') and throw "Unknown encoding".
  const stdin = Buffer.from(paths.join('\0') + '\0', 'utf8');
  const raw = execFileSync('git', ['check-attr', '-z', '--stdin', ...attrs], {
    cwd: repoRoot,
    input: stdin,
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');

  // -z output is a flat NUL-delimited stream of (path, attr, value) triples.
  const fields = raw.split('\0').filter((s) => s !== '');
  const result = {};
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const [path, attr, value] = [fields[i], fields[i + 1], fields[i + 2]];
    (result[path] ??= {})[attr] = value;
  }
  return result;
}

/**
 * Extensions `.gitattributes` declares via a bare `*.ext` pattern.
 *
 * A path-scoped or non-extension pattern cannot be probed by the synthetic
 * `__attribute_probe__/probe.<ext>` path the guard builds, so it is returned
 * in `unparsed` rather than silently ignored.
 *
 * A bare `*.ext` glob that declares `-text` is returned in `binary` instead of
 * `declared`: it routes media to git-lfs and says nothing about source. A bare
 * glob naming a TEXT_EXTENSIONS extension falls into `unparsed` even when it
 * says `-text`, so source cannot opt itself out of the scan.
 *
 * @param {string} repoRoot Absolute path to the repository root.
 * @returns {{declared: Set<string>, binary: Set<string>, unparsed: string[]}}
 */
export function declaredExtensions(repoRoot) {
  const declared = new Set();
  const binary = new Set();
  const unparsed = [];
  for (const raw of readFileSync(resolve(repoRoot, '.gitattributes'), 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [pattern, ...attrs] = line.split(/\s+/);
    const simple = /^\*\.([A-Za-z0-9]+)$/.exec(pattern);
    if (simple) {
      const ext = simple[1];
      // A bare glob that declares `-text` is a BINARY declaration, not a source
      // one. Tested before the `declared` branch, because the whole point is
      // that `*.png ... -text` must not be read as "png is a source extension".
      if (attrs.includes('-text')) {
        // ...but a SOURCE extension may never buy its way out of the NUL scan
        // by declaring itself binary. `*.ts ... -text` lands in `unparsed` and
        // fails the guard rather than quietly shrinking its own scope.
        if (TEXT_EXTENSIONS.includes(ext)) unparsed.push(pattern);
        else binary.add(ext);
        continue;
      }
      declared.add(ext);
      continue;
    }
    // The allowlist exempts a pattern only while its line still actually
    // declares `-text` — matching the pattern string alone would let a
    // later edit repurpose the same glob for a positive `text` declaration
    // and keep sailing through unnoticed, exactly what this list must not do.
    if (ALLOWED_NON_TEXT_PATTERNS.has(pattern) && attrs.includes('-text')) continue;
    unparsed.push(pattern);
  }
  return { declared, binary, unparsed };
}
