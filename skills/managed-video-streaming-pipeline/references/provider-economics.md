# Provider Economics: Pricing Model Shapes and Cost Projection

Read this when comparing Cloudflare Stream, Mux, BunnyCDN Stream, and a
self-hosted FFmpeg + object-storage + CDN stack, or when you need to justify
a platform choice with numbers instead of a pricing-page skim.

## Why "shape" matters more than "rate"

Every managed video platform bills differently *structurally* — not just at
a different rate. Comparing a single quoted number ("$1 per 1000 minutes
delivered") against another platform's number without normalizing for what
each dimension actually charges for produces a meaningless comparison.

| Platform | Storage dimension | Delivery dimension | Other billed dimensions | Notes |
|---|---|---|---|---|
| Cloudflare Stream | minutes stored/month | minutes delivered | none — flat, resolution-agnostic | ~$5 / 1,000 min stored/mo, ~$1 / 1,000 min delivered (2026 approximate). Minute-based billing means a 4K video and a 240p video cost the same to store and deliver — this is generous for low-res content and expensive for high-res. |
| Mux | GB stored | GB delivered | encoding (per input minute), analytics (per view or per API call) | Multi-dimensional. Teams frequently model storage + delivery and forget encoding and analytics line items, which can be 15-30% of the bill at moderate view volume. |
| BunnyCDN Stream | GB stored | GB delivered | DRM issuance bundled | Flat per-GB rate, bundled feature set, lowest absolute $/GB of the three managed options. Fewer built-in analytics/webhooks than Cloudflare Stream or Mux — you trade developer convenience for unit cost. |
| Self-hosted (FFmpeg + S3/R2 + generic CDN) | object storage $/GB (S3 ~$0.023/GB, R2 has no egress fee) | CDN egress $/GB | compute for transcoding (spot/batch, or one-time per upload) | No video-specific markup at all — you pay commodity rates for storage and egress. Requires you to build/own encoding orchestration, webhook plumbing, and a player. |

## The 10-40x egress spread

This is the single biggest lever in self-hosted vs. managed economics:

- **Hyperscaler CDN on-demand egress** (e.g., AWS CloudFront, first 10 TB/mo,
  North America): approximately **$0.085/GB**.
- **Purpose-built / specialist video CDNs at volume**: approximately
  **$0.002-$0.01/GB** — a **10-40x** difference per GB delivered.

A platform's *minutes-delivered* pricing is effectively hiding a $/GB rate
inside it. Back it out: `$/GB implied = ($ per 1000 min delivered) / (avg GB
per 1000 min at your bitrate)`. At 3 Mbps average bitrate, 1000 minutes is
roughly 22.5 GB, so $1/1000 min-delivered implies about **$0.044/GB** — cheap
relative to hyperscaler on-demand egress, but expensive relative to a
specialist video CDN's volume rate once you're serving hundreds of thousands
of minutes/month.

## Rule of thumb

- **Low-to-moderate volume, velocity matters more than unit cost**: managed
  platforms (Cloudflare Stream, Mux) win. Webhook-driven transcode, a
  built-in player, and analytics save weeks of engineering time that is worth
  far more than the marginal $/GB at this scale.
- **High hundreds of thousands of delivered-minutes/month or more, margin
  matters**: self-hosted FFmpeg + object storage + a generic/specialist CDN
  wins on unit economics, because you pay commodity egress instead of a
  video-specific markup. The crossover point depends on your engineering cost
  to build and maintain the pipeline, but the *unit* cost crossover is
  usually well below where the migration becomes worth it — model both
  before committing.
- **Mid-range volume, still want bundled features but margin is tightening**:
  BunnyCDN Stream is a middle path — lower absolute rate than Cloudflare
  Stream/Mux, still bundled storage/delivery/encoding/DRM.

## Building your own projection

Use `scripts/cost_projector.py` to convert your own stored-minutes,
delivered-minutes, and average bitrate into a side-by-side monthly cost
across all four options, rather than trusting a single quoted rate. Re-run it
quarterly — the crossover point moves as your volume grows, and a platform
choice that was right at launch is not automatically right a year later.

## What the projection will NOT tell you

- Engineering time to build/maintain a self-hosted transcode pipeline
  (queueing, retry, monitoring, codec updates) — this is real and ongoing,
  not a one-time cost.
- Player quality and cross-browser/cross-device compatibility — managed
  platforms' built-in players handle a long tail of device quirks.
- Analytics fidelity — self-hosted requires wiring your own view/QoE
  analytics; Mux in particular is strong here.

Cost projection answers "which is cheaper at this volume," not "which is the
right choice overall." Weigh it against these qualitative factors explicitly.
