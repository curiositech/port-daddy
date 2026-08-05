# Port Daddy Release Process

## Overview

Releasing Port Daddy (daemon, CLI, FleetBar, pd-console, and Homebrew distribution) requires passing an atomic **documentation council gate** that binds independent multi-agent review to cryptographic proof of exact candidate state.

This gate is **fail-closed**: absence or validation failure blocks GitHub Release, binary builds, FleetBar publication, pd-console deployment, and Homebrew updates. No partial shipments are possible.

## The Documentation Council Gate

### What It Does

The gate enforces that every release is validated by:

1. **At least 4 distinct Port Daddy reviewer agents** with unique identities and roles
2. **At least 3 substantive cross-steelman records** from ≥3 different reviewers (adversarial peer review)
3. **All 5 canonical instruction surfaces** reviewed:
   - `AGENTS.md` (agent registry and activation)
   - `CLAUDE.md` (Claude Code global instructions)
   - `README.md` (user-facing overview)
   - `skills/port-daddy-agent-skill/SKILL.md` (AI skill documentation)
   - `skills/port-daddy-internal-dev/SKILL.md` (internal development skill)
4. **Visual proof artifacts** with hashed conformance (daemon harness demos)
5. **A named non-stable feature daemon** at exact candidate version, running at `http://127.0.0.1:NNNN`
6. **Final synthesis SHIP verdict** with zero blockers (all concerns resolved)

### How It Works

#### 1. Pre-Release: Council Review Phase

Before opening a GitHub Release draft:

```bash
# Spin up a named feature daemon at the candidate version
npm run build:daemon:dist
dist/daemon/port-daddy-daemon --label squid-3-28-feature --port 3174

# In parallel, spawn 4+ Port Daddy reviewers with independent scope notes
# Each reviewer uses distinct role and identity
pd begin \
  --identity "port-daddy:docs:conformance" \
  --lifecycle ephemeral \
  --purpose "Review documentation conformance for v3.28.0"

# Reviewers validate independently against the daemon and candidate tree
# Capture cross-steelman records (peer adversarial reviews)
# Collect proof artifacts (visual demo conformance)
```

#### 2. Receipt Creation

Once all reviewers complete:

```bash
# Create receipt in docs/release-reviews/v3.28.0.json
node scripts/create-release-receipt.mjs \
  --release v3.28.0 \
  --reviewers "spawned-a,spawned-b,spawned-c,spawned-d" \
  --daemon-label squid-3-28-feature \
  --daemon-port 3174 \
  --daemon-binary-sha <sha256-of-daemon-binary>

# Receipt binds:
# - Exact candidate tree digest (SHA-256 of all files)
# - Reviewer identities and verdicts
# - Cross-steelman argument/disposition pairs
# - Visual proof artifact hashes
# - Named daemon endpoint and binary hash
# - Final synthesis verdict
```

#### 3. Gate Validation

When you create a GitHub Release:

```bash
# The GitHub Release workflow runs:
node scripts/check-release-doc-review.mjs

# This validates:
# - Receipt exists for the version
# - Receipt schema is valid (version 1)
# - Candidate digest matches current tree (fail-closed on edits)
# - 4+ unique reviewers with SHIP verdict
# - 3+ cross-steelman records from 3+ reviewers
# - All 5 surfaces reviewed
# - Proof artifacts match (hashes verified)
# - Daemon configuration is valid (loopback URL, non-stable label)
# - Synthesis verdict is SHIP with zero blockers

# If validation passes: GATE OPENS → binaries build → Homebrew publishes
# If validation fails: GATE CLOSES → all downstream jobs blocked
```

#### 4. Why This Design

| Threat | Defense |
|--------|---------|
| Partial shipment (reviewed code + unreviewed docs) | Candidate digest invalidates on ANY tree change post-review |
| Theater (one person reviewing 4 times) | 4+ unique agent IDs + cross-steelman from ≥3 reviewers |
| Soft consensus ("mostly OK") | Final synthesis requires explicit SHIP + zero blockers |
| Stale proof (old visual demo, mismatched binary) | SHA-256 hashes tied to exact candidate tree digest |
| Unvalidated daemon | Named daemon URL, version match, binary hash recorded |
| Schema drift | schemaVersion=1 required; forward compat via explicit upgrades |

## Receipt Schema

```typescript
{
  schemaVersion: 1,                    // Always 1 (forward compat gate)
  release: "v3.28.0",                  // Must match GitHub Release tag
  
  // Cryptographic proof of exact candidate tree
  candidateDigest: "<sha256>",         // Invalidates on any tree edit
  
  // Minor documentation review (push review before release)
  minorDocumentationReview: {
    agentId: "spawned-a",              // Port Daddy agent ID
    transcriptId: "transcript-a",      // Linked transcript
    candidateDigest: "<sha256>",       // Must match parent digest
    verdict: "SHIP",                   // Required: SHIP | SHIP-AFTER-FIX | DO-NOT-SHIP
  },
  
  // All 5 canonical surfaces reviewed
  reviewedSurfaces: [
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "skills/port-daddy-agent-skill/SKILL.md",
    "skills/port-daddy-internal-dev/SKILL.md",
  ],
  
  // Visual proof artifacts (hashed conformance demos)
  proofArtifacts: {
    "website-v2/public/demos/harness/harness-conformance-live.gif": "<sha256>",
    "website-v2/public/demos/harness/harness-conformance-live-dark.gif": "<sha256>",
    "website-v2/public/demos/harness/harness-attention-activation.gif": "<sha256>",
    "website-v2/public/demos/harness/harness-attention-activation-dark.gif": "<sha256>",
  },
  
  // 4+ unique reviewer agents
  reviewers: [
    {
      agentId: "spawned-a",            // Unique Port Daddy agent
      identity: "port-daddy:docs:a",   // Distinct role/identity
      role: "reviewer-conformance",    // Named role
      transcriptId: "transcript-a",    // Linked session transcript
      verdict: "SHIP",                 // SHIP | SHIP-AFTER-FIX | DO-NOT-SHIP
    },
    // ... 3+ more unique reviewers
  ],
  
  // 3+ cross-steelman records from 3+ different reviewers
  steelman: [
    {
      reviewerAgentId: "spawned-a",    // Reviewer author
      targetAgentId: "spawned-b",      // Peer being reviewed
      argument: "The strongest case against this gate is that it adds release overhead without preventing real issues. The gate validates instruction surfaces, not code correctness.",
      disposition: "The candidate addresses this by binding proof artifacts to the exact tree digest. If an instruction surface is stale, the daemon won't run or demos will fail. The overhead is amortized across the release window.",
    },
    // ... 2+ more steelman records from different reviewers
  ],
  
  // Final synthesis: SHIP with zero blockers
  synthesis: {
    agentId: "spawned-d",              // Synthesis author (must be a reviewer)
    verdict: "SHIP",                   // Must be SHIP
    blockers: [],                      // Must be empty (all issues resolved)
  },
  
  // Named daemon at candidate version
  namedFeatureDaemon: {
    label: "squid-3-28-feature",       // Non-stable feature name
    version: "3.28.0",                 // Must match release version
    url: "http://127.0.0.1:3174",     // Loopback only (no routing)
    binarySha256: "<sha256>",          // Exact daemon binary hash
  },
}
```

## Step-by-Step Release Workflow

### Step 1: Prepare Candidate

Ensure all features, fixes, and docs are merged to `main`:

```bash
git checkout main
git pull origin main
npm install
npm run build
npm run test
npm run lint
```

### Step 2: Spin Feature Daemon

Build and start the daemon at the candidate version:

```bash
npm run build:daemon:dist
./dist/daemon/port-daddy-daemon --label squid-3-28-feature --port 3174

# Verify daemon is healthy
curl http://127.0.0.1:3174/health
```

### Step 3: Spawn Review Council

Launch 4+ independent reviewers with distinct roles:

```bash
# Reviewer 1: Conformance / instruction surface alignment
pd begin --identity "port-daddy:docs:conformance" --purpose "..."

# Reviewer 2: Internal dev skill and agent coordination
pd begin --identity "port-daddy:docs:internal-dev" --purpose "..."

# Reviewer 3: User-facing documentation and examples
pd begin --identity "port-daddy:docs:user-facing" --purpose "..."

# Reviewer 4: Release readiness and daemon validation
pd begin --identity "port-daddy:docs:release-readiness" --purpose "..."
```

Each reviewer independently:
- Reads all 5 canonical surfaces
- Tests against the running daemon
- Captures visual proof artifacts (screenshots/demos)
- Records steelman argument/disposition for at least one peer reviewer
- Votes SHIP or DO-NOT-SHIP

### Step 4: Cross-Steelman Reviews

After initial review, each reviewer pens a steelman:

```
For review team:
I reviewed reviewerX's assessment and their strongest case is:
  "The daemon needs better documentation for the named daemon lifecycle."

My disposition is:
  "This is addressed in the updated RELEASING.md section on feature daemon 
   requirements. The docs now specify exact version matching, loopback-only 
   binding, and binary hash validation. I verified all three in the candidate 
   tree. DISPOSITION: addressed."
```

Gather ≥3 cross-steelman records covering different reviewer pairs.

### Step 5: Capture Proof Artifacts

Record visual conformance. Hashed artifacts include:

- `website-v2/public/demos/harness/harness-conformance-live.gif`
- `website-v2/public/demos/harness/harness-conformance-live-dark.gif`
- `website-v2/public/demos/harness/harness-attention-activation.gif`
- `website-v2/public/demos/harness/harness-attention-activation-dark.gif`

These must exist and their SHA-256 hashes must be recorded in the receipt.

### Step 6: Synthesis

A final reviewer (often a more senior agent) synthesizes:

```json
{
  "agentId": "spawned-d",
  "verdict": "SHIP",
  "blockers": [],
  "summary": "All five instruction surfaces reviewed. Cross-steelman records confirm 
   no unresolved concerns. Named daemon runs at exact version with valid 
   configuration. Proof artifacts match candidate tree digest. READY TO SHIP."
}
```

### Step 7: Create Receipt

Generate the receipt file:

```bash
node scripts/create-release-receipt.mjs \
  --release v3.28.0 \
  --reviewers "spawned-a,spawned-b,spawned-c,spawned-d" \
  --reviewers-verdicts "SHIP,SHIP,SHIP,SHIP" \
  --steelman-records steelman.json \
  --synthesis synthesis.json \
  --daemon-label squid-3-28-feature \
  --daemon-port 3174 \
  --daemon-binary-sha $(sha256sum dist/daemon/port-daddy-daemon | cut -d' ' -f1)

# Creates: docs/release-reviews/v3.28.0.json
git add docs/release-reviews/v3.28.0.json
git commit -m "docs(release): v3.28.0 documentation council receipt"
git push origin main
```

### Step 8: Create GitHub Release

On the GitHub releases page:

1. Click "Draft a new release"
2. Tag: `v3.28.0`
3. Title: `v3.28.0 — [theme]`
4. Release notes: Changelog + acknowledgments
5. Click "Publish release"

The workflow automatically:
- Validates the documentation council receipt
- Builds binaries for darwin-arm64 and linux-x64
- Uploads artifacts
- Updates Homebrew formula
- Publishes pd-console to npm

## Validation Checklist

Before opening a GitHub Release, ensure:

- [ ] Receipt file exists: `docs/release-reviews/v3.28.0.json`
- [ ] Receipt is valid JSON
- [ ] `schemaVersion === 1`
- [ ] `release` matches tag (e.g., `v3.28.0`)
- [ ] `candidateDigest` matches current tree: `node scripts/check-release-doc-review.mjs --digest`
- [ ] `minorDocumentationReview.verdict === "SHIP"`
- [ ] All 5 surfaces in `reviewedSurfaces`
- [ ] 4+ unique `reviewers` with `SHIP` verdicts
- [ ] 3+ `steelman` records from 3+ different reviewers
- [ ] Each steelman has ≥40 chars argument and disposition
- [ ] No self-authored steelman (reviewer ≠ target)
- [ ] All proof artifact hashes match candidate files
- [ ] `synthesis.verdict === "SHIP"`
- [ ] `synthesis.blockers === []`
- [ ] `namedFeatureDaemon.label !== "stable"`
- [ ] `namedFeatureDaemon.version === "3.28.0"`
- [ ] `namedFeatureDaemon.url` matches loopback format
- [ ] `namedFeatureDaemon.binarySha256` is valid SHA-256

Run before publishing:

```bash
node scripts/check-release-doc-review.mjs
# Should output: ✓ release-doc-review: PASS v3.28.0
```

## Troubleshooting

### Gate Fails: "candidateDigest does not match"

**Cause:** A file changed after the receipt was created.

**Fix:** Update the receipt by re-running the review and synthesis:

```bash
npm run build  # Ensure candidate is fresh
node scripts/check-release-doc-review.mjs --digest  # Get new digest
# Update receipt with new digest
# Re-run synthesis to confirm no issues
# Commit updated receipt
```

### Gate Fails: "missing reviewers"

**Cause:** Receipt has fewer than 4 unique reviewer IDs.

**Fix:** Add more independent reviewers. Each must:

```json
{
  "agentId": "spawned-X",              // Unique Port Daddy agent
  "identity": "port-daddy:docs:X",     // Distinct identity
  "role": "reviewer-X",                 // Named role
  "transcriptId": "transcript-X",       // Linked transcript
  "verdict": "SHIP"
}
```

### Gate Fails: "steelman records from fewer than 3 reviewers"

**Cause:** Cross-steelman records all come from same reviewer(s).

**Fix:** Collect steelman from different reviewers:

- Reviewer A steelmans Reviewer B's assessment
- Reviewer B steelmans Reviewer C's assessment
- Reviewer C steelmans Reviewer A's assessment

(Ensures cyclic adversarial review with independent perspectives.)

### Gate Fails: "proof artifact hash does not match"

**Cause:** Proof artifact file is missing or content changed.

**Fix:**

```bash
# Regenerate proof artifacts (visual demos)
npm run build:demos

# Update receipt with new hashes
node scripts/update-proof-artifacts.mjs docs/release-reviews/v3.28.0.json

# Commit both
git add website-v2/public/demos/ docs/release-reviews/v3.28.0.json
git commit -m "fix: update proof artifacts for v3.28.0"
```

## FAQ

**Q: Can I skip the documentation review for a patch release?**

A: No. Every release (major, minor, patch) requires council review. For patch releases, the review can be faster if only a small surface changed, but all 5 surfaces must still be explicitly reviewed.

**Q: What if a reviewer votes DO-NOT-SHIP?**

A: That blocks the release. The synthesis agentId must be a reviewer who voted SHIP and must confirm all DO-NOT-SHIP concerns are addressed or can be deferred.

**Q: Can the same agent review multiple roles?**

A: No. The gate requires 4+ unique agent IDs. Each reviewer is a distinct Port Daddy session/agent.

**Q: Do I need the named daemon to ship?**

A: Yes. The gate requires explicit daemon configuration with version match, loopback binding, and binary hash. This ensures release artifacts can be traced to exact binary versions.

**Q: What if a reviewer's transcript is lost?**

A: The receipt records `transcriptId`, which should link to Port Daddy's transcripts. If a transcript is unavailable, the gate fails until the review is redone and recorded.

**Q: Can this gate ever be disabled?**

A: No. It is baked into the GitHub Release workflow and requires modification of the workflow file itself. Any such change must pass code review and CI.
