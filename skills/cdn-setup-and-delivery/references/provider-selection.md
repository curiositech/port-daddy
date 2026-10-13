# CDN Provider Selection — Deep Dive

Read this when comparing hyperscaler vs. specialist CDN economics in detail, or
building a cost model for a specific traffic projection.

## The two tiers

### Hyperscaler CDNs (CloudFront, Cloudflare, Google Cloud CDN)

- **Strengths**: Already integrated with the rest of the cloud's IAM, compute,
  and storage primitives (e.g. CloudFront + S3 + Lambda@Edge; Cloudflare +
  Workers + R2 + DNS). Strong, mature global POP coverage. Best-documented,
  largest community, most Terraform/Pulumi provider coverage.
- **Cost shape**: On-demand egress pricing scales with volume and is not
  discounted meaningfully until committed-use/enterprise tiers. CloudFront's
  list on-demand price is roughly **$0.085/GB** for the first tier in the US
  (varies by region, drops at higher tiers, and Cloudflare's own CDN egress
  is bundled differently — often free when paired with their own compute/
  storage products, which changes the calculus entirely if you're all-in on
  Cloudflare).
- **Best fit**: Prototype/low-volume services; teams already deep in AWS/GCP
  and prioritizing integration over unit cost; services where CDN egress is
  a small fraction of total infra spend.

### Specialist / budget CDNs (BunnyCDN, Hetzner, DigitalOcean)

- **Strengths**: Purpose-built for content delivery at low unit cost. Simpler
  product surface (fewer knobs, but the ones that matter — purge, signed
  URLs, geoblocking, origin shield — are usually present).
- **Cost shape**: BunnyCDN and DigitalOcean CDN both land around **$0.01/GB**
  for standard tiers (DigitalOcean bundles a free egress pool before that
  rate kicks in). Hetzner offers **flat-rate dedicated bandwidth** on its own
  infrastructure rather than metered per-GB pricing, which can be dramatically
  cheaper at sustained high volume but requires more manual ops.
- **Tradeoff**: Less mature tooling — smaller Terraform provider ecosystems,
  fewer managed integrations with compute/edge-function platforms, smaller
  support organizations, less battle-tested at extreme scale than the
  hyperscalers.
- **Best fit**: Delivered bandwidth is the dominant line item in the infra
  bill (media-heavy apps, large file distribution, high-traffic static
  sites) and the team can absorb slightly more manual integration work.

## Worked example: the delta compounds

Assume 50 TB/month of delivered bandwidth (a mid-size media or file-hosting
product):

| Provider | $/GB | Monthly egress cost |
|----------|------|----------------------|
| CloudFront (on-demand) | $0.085 | ~$4,250 |
| BunnyCDN / DigitalOcean | $0.01 | ~$500 |

That's roughly an **8.5x** difference at this volume — real money, not a
rounding error. At 5 TB/month the same delta is ~$425 vs ~$50: still real,
but small enough that integration convenience may reasonably win. The
heuristic in SKILL.md ("re-evaluate at each order-of-magnitude traffic jump")
exists because the crossover point where cost should start driving the
decision arrives faster than most teams expect.

## Decision heuristic, restated

1. **Prototype / low, uncertain volume** → use whatever's already in your
   stack. Optimizing egress cost before you have real traffic is premature.
2. **Sustained high-bandwidth delivery** → re-evaluate specifically on $/GB.
   Don't let sunk familiarity with a dashboard justify a 5-10x cost multiple
   once the volume is real.
3. **Deep compute/storage/auth integration needs** (edge functions that need
   to share IAM with your API, KV/object storage co-located with the CDN)
   can outweigh a pure $/GB delta — but name that tradeoff explicitly rather
   than defaulting to it by inertia.

## What NOT to over-index on

- Marketing claims about "global POP count" without checking POP density in
  *your* actual user geography — a CDN with fewer total POPs but better
  coverage in your traffic's regions can outperform one with more POPs
  elsewhere.
- List/on-demand pricing pages without checking committed-use or volume
  discount tiers, which can shift the hyperscaler math meaningfully at
  enterprise scale.
