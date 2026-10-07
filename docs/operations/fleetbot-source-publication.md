# Publish committed source through Fleetbot

The protected workload accepts a compressed data package describing committed
source relative to an exact base. Existing files can use bounded prefix/suffix
edits or DEFLATE with the identified base blob as a dictionary, keeping sparse
edits to large files small in transit. Relay creates the blobs, tree, App-authored
commit, governed branch and ready-for-review PR. The runner never executes code
from the package and never receives a GitHub App installation token.

This is a source capability until the reviewed workflow is on `main`, its
protected workload grant and trusted Relay verification key are configured,
and a real publication receipt is read back. It does not create a local proposal
broker or grant authority to a local agent. An authorized dispatcher still owns
the protected invocation. The local Port Daddy halt remains in force.

## Prepare the exact change

In a clean linked worktree, commit the intended paths, fetch current main with
hooks inert, and reconcile against that base. Keep the title, PR body and output
package outside the source checkout. The body must have exactly one roadmap
trailer matching the workflow's roadmap item or explicit sidequest reason.

```sh
node scripts/fleetbot-publication.mjs prepare \
  --repository curiositech/port-daddy \
  --base <exact-main-sha> \
  --title-file <persistent-title-file> \
  --body-file <persistent-pr-body-file> \
  --output <persistent-publication-package-file>
```

The builder reads committed Git blobs, preserving bytes, executable modes and
symlink text without following symlinks. It rejects dirty source, a stale head,
a non-ancestor base, submodules, unsafe paths, empty blobs unsupported by the
present Relay parser, and excessive changes or bytes. It does not push, install
hooks, read credentials or contact a provider. Oversize packages fail; split the
source change instead of substituting an unverified remote download.

The protected runner resolves each base blob through the repository's read-only
Git API, verifies its Git object hash and byte count, then reconstructs the full
changed content under the same per-file and total byte limits. Only the expanded
Relay payload is signed. Fractional or overlapping copy lengths, wrong base
objects, malformed encodings, trailing compressed data and excessive reconstructed output fail before
publication. Transport input remains bound by the recovery manifest's digest.

## Protected invocation and proof

The authorized dispatcher selects **Fleetbot actuator** on `main`, operation
`publish`, leaves the existing PR number empty, and supplies the package token
and bounded authorship fields. The protected `fleetbot-workload` environment
supplies the signing key, standing grant and pinned Relay receipt key. The
Actions token has read permissions only; Relay alone performs GitHub writes.

Workflow-file changes require a separate authority check: the current Relay
publisher requests `contents:write` and `pull_requests:write`, without
`workflows:write`. The client rejects packages changing `.github/workflows/`
before dispatch; the generic builder can still export them for review.
Do not assume this path can publish its own workflow changes
or widen that token during bootstrap. The publisher owner must verify the
approved workflow-write route first; GitHub documents the additional permission
set for reference creation in its
[Git references API](https://docs.github.com/en/rest/git/refs#create-a-reference).

The package is capped at 48,000 encoded characters, leaving room for other
fields under GitHub's 65,535-character input limit. Decompression and decoded
change limits are independent; compression does not enlarge authority.
[GitHub workflow input limits](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatchinputs).

The runner checks the live base before signing; Relay checks it again before
creating Git objects and requires the resulting tree to equal the source tree.
The tree API receives an exact base tree plus changed entries, preserving
unchanged files. [GitHub Git tree API](https://docs.github.com/en/rest/git/trees#create-a-tree).

A signed recovery manifest is uploaded before the effect. A successful response
must carry the pinned Relay signature, expected App, account-bound branch,
source head, PR URL/number and confirmed token cleanup. Readback then checks the
App author, exact base/head, source tree, single parent, title, readiness and
the complete body produced by Relay's shared provenance stamper. Keeping a
receipt marker while changing the description or roadmap trailer fails readback.
The local source head and App-authored GitHub commit differ;
tree equality connects their content.

## Lost responses

Never rerun a mutation job. Use **Fleetbot receipt recovery** with the original
run id. Its signed sanitized manifest retains source head/tree identifiers, not
contents, title, body, credentials or a reusable capability. Recovery contacts
only the existing receipt endpoint; it never republishes or reads new PR state.
Expired, revoked or incomplete authority fails closed. B3 cross-rotation
recovery remains a separate change.

Both required OS jobs run the package, client and flow fixtures. They reject
wrong bases/grants, malformed packages, mismatched receipts, altered manifests
and mutation retries using fake transports. Local tests are not production
publication proof. This path introduces no queue bypass, branch adoption,
closure operation or personal-credential fallback.
