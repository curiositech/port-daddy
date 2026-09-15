# Harbor Inventory

A local, dependency-free foundation for reconciling a sprawling repository:
enumerate planning sources, bind semantic-review receipts to exact bytes, and
materialize an independently approved smaller tree without changing the source.

This package does **not** decide which ideas are valuable or which plan is right.
Its successor command consumes a complete universe, an externally produced
selection manifest, a loss audit, and a separate approval; it never manufactures
those judgments. It shares its scanner with the existing Harbor Clearance
projection; there is not a second reconciliation engine.

## Try the distributable

Requires Node.js 22 or later. The package has no dependencies, installer hooks,
account, service, provider key, model download, or inference usage.

From this directory, build a local tarball:

```sh
npm pack --ignore-scripts --offline
```

Install that tarball in a separate tools directory, not the repository being
examined:

```sh
npm install --ignore-scripts --offline --no-audit --no-fund /absolute/path/curiositech-harbor-inventory-0.5.0.tgz
./node_modules/.bin/harbor-inventory --repo /absolute/path/to/repository --source-id my-project
./node_modules/.bin/harbor-review-audit --source /absolute/source.md --source-id my-project --source-revision COMMIT_OR_DIGEST --source-path docs/source.md --contract /absolute/review-contract.json --receipt /absolute/review.json
./node_modules/.bin/harbor-successor-export --source /absolute/source-repo --universe /absolute/universe.jsonl --manifest /absolute/successor-manifest.jsonl --loss-audit /absolute/loss-audit.json --approval /absolute/approval.json --authority-receipts /absolute/authority-receipts.jsonl --target-profile /absolute/target-filesystem-profile.json
```

The name is provisional. This is a locally installable tarball, not an npm
registry release. The manifest remains private to prevent accidental registry
publication. The included LICENSE is copied unchanged from the source
repository; this slice does not choose a new commercial license.

For contributors, the same command can run without installation:

```sh
node scripts/inventory.mjs --repo /absolute/path/to/repository --source-id my-project
node --test tests/artifact_inventory.test.mjs tests/review_receipt.test.mjs tests/successor_export.test.mjs
node tests/package_smoke.mjs
```

## What you receive

- A working-tree census of Markdown, MDX, HTML, skills named SKILL.md, JSON,
  YAML and TeX wherever they occur under the selected roots.
- Exact byte digests and all paths in byte-identical groups. Copy groups never
  authorize deletion: identical text can serve different audiences or installs.
- Explicit policy exclusions, unreadable sources, size limits and coverage
  state. No file's contents are evaluated, including HTML scripts and skills.
- Supplied registry exports retained with exact UTF-8 source, digest and native
  fields. Identical names in different harbors are not merged; timestamps do
  not choose a winning plan. Export authority is always unverified.
- A fail-closed successor verifier and separately authorized materializer. It
  copies only exact selected bytes, records approved omissions and aliases, and
  retains the complete input evidence inside the new tree.

Default output is Markdown on stdout; select JSON with `--format json`.
The program has no report writer and changes no files. Reports can contain
private paths and, in JSON, the registry content you explicitly supplied.
Treat captured output as private until you review disclosure.

Roots are repeatable, repository-relative selections:

```sh
harbor-inventory --repo /absolute/path/to/repository --source-id my-project --root docs --root skills --root prototypes
```

Whole-tree selection is the default. It does **not** consult gitignore, so
ignored planning files may be included. Explicit exclusions are .git, .cache,
node_modules, target, dist, build, vendor, virtual environments, Python caches,
and local Port Daddy private-state directories; common secret filenames are
also excluded. This is not a secret scanner. Symlinks are not followed, even
through ancestors of an explicitly selected path. Arbitrary nested Git refs,
PDFs, code semantics, remote services and private assistant histories are outside
this census. An HTML digest is not a rendered-page analysis.

The default ceilings are 100,000 traversal entries, 20,000 files, 4 MiB per file,
256 MiB of census text and depth 80. Separate registry imports share a 16 MiB
budget, at most 100 exports and 20,000 records per export. Limits are reported,
not quietly treated as complete coverage.

Exit 0 means traversal completed with declared exclusions, **not** that the
repository is reconciled. Exit 2 means partial coverage or an unavailable
requested registry. Exit 1 means invalid invocation or a fatal read failure.

Use a trusted, quiescent local checkout. Individual reads have path, identity and
change checks; the collection is not an atomic snapshot, and this process is
not a sandbox against a malicious user concurrently changing ancestor paths.
Nothing is sent elsewhere. There is no update checker or telemetry.

## Promote semantic review without pretending

Inventory and extraction never earn the `agent-reviewed` label by themselves.
`harbor-review-audit` checks one JSON receipt against the exact supplied UTF-8
source, a separately supplied expected source identity, and a separately supplied
review contract. The receipt must match the caller's source ID, revision and path
and bind the contract identity, revision and digest; it cannot choose its own required-field
set. Promotion requires a complete-source declaration, exact required-field
coverage, byte-true line anchors for present findings, distinct declared
producer/reviewer/quality-reviewer identities, and an accepted quality review.
The result binds the exact receipt, contract and source digests. Rejected prior
attempts remain listed by digest and reason.

This is a receipt-consistency gate, not an oracle. The expected source identity
is independently supplied but not authenticated or derived from the bytes. It cannot authenticate the
reviewers, prove they were independent, establish that a summary is logically
correct, or authorize deletion. Exit 2 leaves the result at
`machine-semantic-extracted`; malformed inputs exit 1. The command is local,
read-only and stdout-only.

## Materialize an approved successor without touching the source

`harbor-successor-export` requires six independently supplied declarations:

- `universe.jsonl`: every source path with exact SHA-256, byte count and
  executable mode;
- `successor-manifest.jsonl`: exactly one disposition for every universe path;
- `loss-audit.json`: exact universe/manifest bindings, zero unresolved blockers,
  and an explicit export authorization flag; and
- `approval.json`: a separate, exact approval bound to the same source revision
  and declaration digests;
- `authority-receipts.jsonl`: one exact, source-scoped authorization receipt for
  every manifest disposition, with each raw-row digest referenced exactly once;
  and
- `target-filesystem-profile.json`: the exact supported
  `portable-ascii-casefold-v1` contract. Successor paths are ASCII-only, at most
  100 bytes per segment and 240 bytes total, with reserved basenames and
  case-insensitive collisions rejected before writing.

This local v1 accepts only unconditional approval and disposition receipts:
their `limitations` arrays must be empty. Free-text conditions cannot be safely
interpreted or enforced, so any non-empty limitation holds materialization.

The only dispositions are `copy-exact`, `regenerate-alias`, and
`omit-approved`. There is deliberately no content-transform or inferred-omit
mode. Verification is the default and writes only JSON to stdout. Materialize
only into an absent, separate absolute path:

```sh
harbor-successor-export \
  --source /absolute/source-repo \
  --universe /absolute/universe.jsonl \
  --manifest /absolute/successor-manifest.jsonl \
  --loss-audit /absolute/loss-audit.json \
  --approval /absolute/approval.json \
  --authority-receipts /absolute/authority-receipts.jsonl \
  --target-profile /absolute/target-filesystem-profile.json \
  --materialize --output /absolute/new-successor-repo
```

The command re-audits immediately before writing, independently censuses every
regular source file except the exact top-level `.git` entry, and refuses source
symlinks, stale bytes, incomplete coverage, missing or unreferenced authority
receipts, unsupported target profiles, output collisions and existing output
paths. It reserves the absent output name before writing; a failed write remains
visibly incomplete instead of deleting or replacing anything.
`.harbor-reconciliation/` in the successor retains the exact universe,
manifest, loss audit, approval, authority-receipt bundle, target profile and
materialization receipt.

Trust boundary: the source and output parent must be locally controlled and
quiescent for the whole run. Node's path APIs are not descriptor-relative, so a
hostile same-user concurrent ancestor rename, symlink swap or mount replacement
is outside this v1 guarantee. Under that stated boundary the command never
intentionally changes the source; do not use it as a sandbox against an active
filesystem attacker. Approval and authorizer identities are declared rather
than cryptographically authenticated, and exact copying does not prove the
result is useful or builds.

For a failed run, retain the version, exit code, selected roots, coverage state
and a redacted error example. File a minimal reproduction in the source
repository's issue tracker; do not attach private registry exports by default.
There is no hosted account or support service in this slice.

## Bring registry evidence

For a Port Daddy Harbor snapshot, explicitly select its local export:

```sh
harbor-inventory --repo /absolute/path/to/port-daddy --source-id curiositech/port-daddy --harbor-snapshot docs/roadmap/roadmap.snapshot.json --format json
```

Other repositories can supply a portable JSON envelope with `--registry`:

```json
{
  "schemaVersion": 1,
  "namespace": "my-project-roadmap",
  "records": [
    { "id": "offline-capture", "revision": "3", "status": "proposed", "dependsOn": ["local-log"] }
  ]
}
```

Unknown native fields are retained. Use strings for large numeric identities
and revisions; unsafe numeric values are rejected. Missing, malformed or
unreadable exports remain unavailable, never evidence of an empty registry.
The adapter does not query the daemon, shards or remote register, or verify
that an export is current. The Harbor work register records ownership; the
roadmap registry records which work exists. Neither is replaced by this report.

## Delivery sequence

This is a delivery checklist within the existing
`project-epistemology-reconciliation` scope and
`port-daddy-unified-product-hypertree`, not another authoritative roadmap.
Existing item IDs and canonical records remain unchanged.
Neither scope name appears in the inspected 318-row committed Harbor snapshot.
They are proposed lineage, not proof of registered work. The remote work claim
also reports proposed; it cannot confer registry authority.

1. **Source discovery (this slice):** portable, bounded inventory, registry
   provenance, installation proof and explicit gaps.
2. **Evidence extraction:** cite exact passages and revisions, retain modality
   and authority, cover undiscovered planning families and supplied registry
   shards. Do not mistake a source census for completed reading.
3. **Reconciliation:** reuse the typed Clearance relations and loss audits;
   attach semantic findings only with scoped, approved hybrid retrieval and
   independently reviewed evidence. Preserve valuable alternatives.
4. **Necessary choices:** show consequences and preservation costs for genuinely
   incompatible options; leave decisions to their named owner.
5. **Smaller successor (safe materializer shipped in this slice):** produce an
   explicit selection manifest, provenance map, invariant tests, loss audit and
   separate approval before materializing a separate repo. The tool enforces
   those inputs but does not create the semantic selection. Leave the source
   repo intact; omit obsolete implementations rather than carrying every
   historical layer forward.
6. **Usable product:** reviewable UI, human task testing on unrelated repos,
   useful-findings/false-alarm/cost evidence, distribution and support policy.
   Pricing, licensing changes and public publication require separate decisions.

For Port Daddy, the next pass must join the committed Harbor snapshot,
unregistered proposals, supplied live-state exports and the wider Markdown,
HTML and skill corpus before claiming a unified roadmap. A missing live export
is an explicit gap. Nothing here turns Port Daddy on, authorizes a model run,
publishes source material or discards an idea.
