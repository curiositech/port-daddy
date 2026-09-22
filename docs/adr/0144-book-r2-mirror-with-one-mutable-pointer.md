# 0144. Book release mirror uses one conditional manifest pointer

## Status

Proposed; source and offline witnesses implemented. Protected production
promotion remains a separate acceptance step.

## Context

The Book is built in `.github/workflows/whitepaper-build.yml`, while its
committed PDF remains the source used by the website build. The abandoned
#10265 publisher wrote an immutable archive, `book/current.pdf`, and
`book/current.json` independently. A manifest failure after the PDF write
could therefore expose a PDF that did not match the public metadata. A
per-ref workflow lock also could not serialize runs that publish the same
bucket keys.

There are no Book consumers of `media.portdaddy.dev` or `book/current.*` in
the main tree. The website continues to consume the committed
`website-v2/public/whitepaper/` PDF, so this source slice does not silently
change the website URL or claim that a public Book release exists.

## Decision

The release mirror has exactly two object classes:

| Key | Mutability | Purpose |
| --- | --- | --- |
| `book/archive/sha256/<sha256>.pdf` | immutable | Content-addressed Book bytes |
| `book/current.json` | one mutable pointer | The authoritative current release manifest |

The manifest contains the schema, PDF SHA-256, byte count, page count, source
commit, publication time, archive key, and archive URL. It does not name a
mutable PDF URL. Readers resolve the archive URL from the manifest and may
cache those bytes forever.

Promotion is S3-only. Cloudflare's R2 S3 API documents conditional
`If-None-Match` and `If-Match` writes; the R2 REST upload endpoint does not
provide the same documented conditional-write contract. The publisher fails
closed before making a request when given the REST transport. It creates a
missing archive with `If-None-Match: *`, verifies an existing archive byte for
byte, then conditionally replaces the manifest with the ETag bound by the
accepted release record. Before the archive write, it HEADs the manifest and
requires that the live pointer still equals that expected ETag, or is still
absent. It never refreshes that generation after the archive check. A 412
means the run is stale and leaves the newer manifest untouched. Every write is
followed by an exact readback before success is reported.

The accepted record binds the exact PDF digest, byte count, page count, source
commit, source tree, source commit time, repository, `refs/heads/main` push,
protected `book-release` environment, workflow authority, and expected prior
manifest ETag. `publishBook()` also requires an injected protected-authority
verifier. A caller-supplied JSON record is treated as metadata until that
verifier accepts it; the current offline tests provide only a synthetic
verifier. The PDF bytes and acceptance record are synchronously cloned before
validation or the verifier's first await, and the record passed to the
verifier is deep-frozen. The live GitHub workflow verifier and protected
promotion are deliberately outside this source-only slice.

The implementation is `scripts/publish-book-to-r2.mjs`. Its tests use an
offline fake S3 bucket and cover:

- archive and manifest ordering, cache controls, and exact manifest shape;
- invalid source metadata and undocumented transport rejection before network;
- rejected unverified acceptance records, digest mismatches, and an older
  accepted generation starting after a newer winner, before archive writes;
- caller mutation during asynchronous authority verification cannot change the
  stored bytes or the manifest's source record;
- reuse of a matching archive and rejection of an archive whose bytes changed;
- stale conditional promotion and provider failure preserving the old pointer;
- post-upload archive tampering rejected before manifest promotion; and
- absence of any `book/current.pdf` write.

The workflow does not promote a public release in this slice. A later change
must run only after the build and Book QA have passed, on protected main with
an approved `book-release` environment, and must pass an accepted immutable
source/PDF handoff. Preview branches, pull requests, and manual preview runs
must not have release credentials or a promotion path.

## Consequences

### Positive

- A current release is one manifest read plus one immutable archive read.
- Concurrent runs cannot silently move the pointer after observing stale state.
- Existing archive bytes are checked before a manifest can refer to them.
- The committed website PDF and the optional mirror have explicit, auditable
  URL ownership.

### Negative

- A release cannot be safely promoted through the REST transport.
- A protected workflow and accepted Book artifact handoff are still required
  before any public mirror state is changed.
- Existing clients that expect `book/current.pdf` need an explicit migration;
  none are present in the main tree today.

## References

- [R2 S3 API conditional writes](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 REST object upload](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/upload/)
- [ADR-0142](0142-r2-media-offload.md)
