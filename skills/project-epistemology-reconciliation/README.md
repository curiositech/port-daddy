# Harbor Inventory

A small, local first step toward reconciling a sprawling repository: find the
planning sources you have, keep their provenance, and show what was not covered.

This package starts with source inventory and adds a narrow review-receipt gate;
it is **not yet a semantic reconciliation product**. It does not find genius,
decide which plan is right, or generate a smaller repo. It shares its scanner
with the existing Harbor Clearance projection; there is not a second
reconciliation engine.

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
npm install --ignore-scripts --offline --no-audit --no-fund /absolute/path/curiositech-harbor-inventory-0.2.0.tgz
./node_modules/.bin/harbor-inventory --repo /absolute/path/to/repository --source-id my-project
./node_modules/.bin/harbor-review-audit --source /absolute/source.md --contract /absolute/review-contract.json --receipt /absolute/review.json
```

The name is provisional. This is a locally installable tarball, not an npm
registry release. The manifest remains private to prevent accidental registry
publication. The included LICENSE is copied unchanged from the source
repository; this slice does not choose a new commercial license.

For contributors, the same command can run without installation:

```sh
node scripts/inventory.mjs --repo /absolute/path/to/repository --source-id my-project
node --test tests/artifact_inventory.test.mjs
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
source and a separately supplied review contract. The receipt must bind the
contract identity, revision and digest; it cannot choose its own required-field
set. Promotion requires a complete-source declaration, exact required-field
coverage, byte-true line anchors for present findings, distinct declared
producer/reviewer/quality-reviewer identities, and an accepted quality review.
The result binds the exact receipt, contract and source digests. Rejected prior
attempts remain listed by digest and reason.

This is a receipt-consistency gate, not an oracle. It cannot authenticate the
reviewers, prove they were independent, establish that a summary is logically
correct, or authorize deletion. Exit 2 leaves the result at
`machine-semantic-extracted`; malformed inputs exit 1. The command is local,
read-only and stdout-only.

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
5. **Smaller successor:** produce an explicit selection manifest, provenance map,
   invariant tests and a loss audit before materializing a separate repo. Leave
   the source repo intact; omit obsolete implementations rather than carrying
   every historical layer forward.
6. **Usable product:** reviewable UI, human task testing on unrelated repos,
   useful-findings/false-alarm/cost evidence, distribution and support policy.
   Pricing, licensing changes and public publication require separate decisions.

For Port Daddy, the next pass must join the committed Harbor snapshot,
unregistered proposals, supplied live-state exports and the wider Markdown,
HTML and skill corpus before claiming a unified roadmap. A missing live export
is an explicit gap. Nothing here turns Port Daddy on, authorizes a model run,
publishes source material or discards an idea.
