# Existing tooling survey: what already solves pieces of this

Load this when deciding whether to hand-roll a release-artifact manifest or
reach for (or borrow the shape of) an existing tool. The short version: no
single tool combines all three of {declarative artifact manifest, fail-loud
presence/size/exec verification, content-hash imprint} for a *polyglot*
release cargo the way this skill teaches -- but each piece has real prior
art, and a manifest-driven approach should borrow their proven shapes
instead of reinventing them badly.

## Comparison

| Tool | Declarative manifest? | Verifies built-artifact presence? | Content-hash output? | Scope |
|---|---|---|---|---|
| `cargo package` / `cargo publish --dry-run` | Yes (`Cargo.toml`) | No -- validates crate *metadata* and packages *source*, not a compiled binary | No | Single Rust crate, source-level |
| `npm pack` / `npm publish --dry-run` | Yes (`package.json` `files` field + `.npmignore`) | No -- packages whatever matches the file allowlist; an accidentally-excluded build output ships silently absent | No (npm computes an integrity hash at *publish* time, not pack time) | Single npm package, source/dist-level |
| [GoReleaser](https://goreleaser.com/) | Yes (`.goreleaser.yaml` `builds:`/`archives:` blocks) | Partially -- fails the release if a declared *build* errors, but does not independently re-verify the resulting archive's contents against an expectation | **Yes** -- the [`checksum:`](https://goreleaser.com/customization/checksum/) block sha256-hashes every archive into `dist/checksums.txt` automatically | Multi-platform Go (and increasingly polyglot) binary releases -- closest existing analog to what a release-artifact manifest should do |
| Homebrew formula `sha256` | Yes, one hash per formula | N/A (verifies the *tarball* downloaded at install time, not the build) | Yes, single-artifact | Install-time trust boundary, downstream of the release |
| Ad-hoc `test -s <path>` in a workflow step | No -- one line per artifact, added by hand, usually only after that specific artifact shipped missing once | Yes, but only for the one path someone remembered to add | No | Whatever the author happened to gate -- this is the anti-pattern the manifest pattern replaces |

## What to borrow from each

- **GoReleaser's `checksum:` block is the direct precedent for imprint.**
  It proves that "declarative build manifest → automatic sha256 manifest
  over every produced artifact" is a solved, boring, widely-adopted shape
  for a *single-language* release. A polyglot cargo (a Bun-compiled daemon
  binary, an npm-published CLI shim, a Rust supervisor binary, a shell
  install script) needs the same idea generalized across build systems --
  which is exactly the gap `pd batten` (proposed, PR pending) closes for
  Port Daddy: one manifest, one verify step, one imprint step, regardless
  of which toolchain produced which artifact.
- **`cargo package`'s dry-run habit is worth copying for the verify step's
  UX.** `cargo publish --dry-run` lets you see exactly what would ship
  without shipping it. A release-artifacts verify step should be safely
  runnable at any point in a build (even mid-development, against a partial
  `dist/`) without side effects -- it only reads and reports.
- **`npm pack`'s file-allowlist model is the cautionary tale, not the
  model.** An allowlist silently ships *nothing* for a name that's absent
  or misspelled -- there is no npm-native "this file was supposed to be
  here and isn't" failure. That's precisely the silent-drop failure mode
  release-artifact manifests exist to convert into a fail-loud one. Do not
  copy this shape.
- **The Homebrew `sha256` field is downstream of imprint, not a substitute
  for it.** It verifies a tarball the *user* downloads against a hash
  *you* computed once, by hand or in a release script, at publish time. If
  your own release process never produced a trustworthy hash of the sealed
  cargo, the formula's sha256 is only as good as whatever ad-hoc `shasum`
  invocation produced it. Imprint (this skill, `scripts/imprint_release_artifacts.mjs`)
  is the thing that should feed that field, not a parallel, disconnected
  hand-run command.

## Why not just use GoReleaser

If a release ships builds from exactly one toolchain (pure Go, or later
pure Rust via [`cargo-dist`](https://opensource.axo.dev/cargo-dist/)),
reach for the existing tool -- do not reinvent checksum generation and
multi-platform archive assembly that a mature tool already does well.
The manifest-driven pattern in this skill is for the case those tools do
not cover: a release cargo assembled from **multiple independent build
systems** (Bun/TypeScript, Cargo, a plain shell script, a signing step)
where no single tool's build graph spans all of them, so the *verify* and
*imprint* steps have to be toolchain-agnostic and operate on the sealed
output directory rather than a build graph.

## Sources

- GoReleaser -- *Checksum* customization (sha256 of every archive,
  `dist/checksums.txt`). https://goreleaser.com/customization/checksum/
- GoReleaser -- *Build* customization (declarative build matrix,
  fail-the-release-on-build-error semantics). https://goreleaser.com/customization/build/
- Cargo Book -- *cargo package* (packages source per `Cargo.toml`, does not
  touch compiled binaries). https://doc.rust-lang.org/cargo/commands/cargo-package.html
- npm CLI docs -- *npm-pack* (tarball contents driven by `files`/`.npmignore`,
  no presence-of-expected-file failure mode). https://docs.npmjs.com/cli/v10/commands/npm-pack
