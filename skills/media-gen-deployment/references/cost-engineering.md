# Cost Engineering — When Self-Hosting Wins (May 2026)

Real numbers. The thresholds at which moving off Replicate/fal to Modal/RunPod is worth the eng time.

---

## Workload 1: 10K FLUX-dev images / day (~300K / month)

| Path | Cost / mo | Notes |
|---|---|---|
| **Replicate FLUX-dev pay-per** | $0.030 × 300K = **$9,000** | Zero ops; just works |
| **fal hosted FLUX dev** | ~$0.025 × 300K = **$7,500** | Faster, similar effort |
| **BFL direct API** | ~$0.025 × 300K = **$7,500** | Source of truth |
| **Modal H100 self-hosted** | H100 at $3.95/hr, ~6s/image FP8 = ~600 imgs/hr/GPU. 300K imgs = 500 GPU-hr = **$1,975** | Plus eng time + cold start tax |
| **RunPod Serverless H100 Active** | $0.00093/s × 6s × 300K = **$1,674** | Best price/perf if you can run the model |
| **RunPod Pod H100 Spot reserved** | $1.25/hr × 730hr × 1 GPU at ~70% util = **$913** | Capacity risk; needs queue |

**Verdict at 10K/day**: self-hosting on RunPod beats Replicate by **5–10×** *if* you have the engineering bandwidth. Below ~2K/day, Replicate is cheaper than your time.

---

## Workload 2: 1K Wan 2.2 videos / day

Wan 2.2 I2V on H100 SXM5 at $2.90/hr generates ~80–100 seconds of video per hour. At 5s clips:

| Path | Cost / mo |
|---|---|
| **fal Wan 2.5** | $0.05/s × 5s × 1K × 30 = **$7,500/mo** |
| **Self-host RunPod H100 Spot** | 1K × 5s = 5,000 sec output / day. At 90s/sec output ≈ 125 GPU-hr/day × $1.25 × 30 = **$4,680/mo**. With 4× H100 to hit latency SLOs. |
| **Replicate per-prediction** | Highly variable; typically $0.05–$0.15/sec ⇒ **$7,500–$22,500/mo** |

**Verdict**: Video is where self-hosting wins fast. The economics break above **~150 clips/day**.

---

## Workload 3: One-off batch of 100K images

| Path | Wall clock | Cost |
|---|---|---|
| **Modal `.map()`** with 50 concurrent H100s | 100K × 6s / 50 = 12K sec = 200 min | 100K × 6s × $0.001097 = **$658**. Best UX. |
| **RunPod Pods** rented 8 H100 Spot for 4 hours | 4 hr | $40 — but you write the orchestration |
| **fal queue** | Easy but slow (queue depth) | $2,500+ at $0.025/image |

**Verdict**: **Modal `.map()` is unbeatable for one-off batch. Period.**

---

## Hidden Costs

### Egress
- **AWS / GCP / Azure**: $0.09/GB. Will eat you alive.
- **Cloudflare R2**: $0/GB. **The killer feature.**
- If outputs leave the cloud, egress dominates the bill.

### Storage
- 100K 1MB images = 100GB.
- R2: $1.50/mo. S3: $2.30/mo.
- Storage isn't the issue — egress is.

### Per-request overhead
- Replicate "starts" charge implicitly; cold cog boots eat your latency budget.
- fal hosted has no per-request fee but per-output is opaque.

### Volume read costs
- Modal volume reads, RunPod network volume IOPS — usually free but watch enterprise tiers.

---

## Why "Free" Tiers Don't Scale

**CF Workers AI free tier** (10K neurons/day) ≈ 1,000 FLUX-schnell images/day. Beyond that, $0.0004/image — fine. **But the real gotcha**: CF rate-limits per Worker invocation count on the Free plan; you'll hit Workers limits before Workers AI limits.

**fal free tier**: limited credits, throttled queue.
**Replicate free tier**: enough to test; not enough to ship.
**Modal free tier**: $30/mo credit; vanishes on first H100 hour.

Plan for paid from day one if you intend to ship.

---

## Cost Budget Worksheet

For a project producing N media gens / month:

### Image (FLUX dev tier)
| N / mo | Replicate | Modal H100 | RunPod Spot Pod |
|---|---|---|---|
| 1K | $30 | ~$10 | n/a (overhead) |
| 10K | $300 | ~$70 | ~$30 |
| 100K | $3,000 | ~$700 | ~$300 |
| 1M | $30,000 | ~$7,000 | ~$3,000 |

### Video (Wan 2.2 5s clips)
| N / mo | fal | RunPod Spot |
|---|---|---|
| 100 | $25 | electricity |
| 1K | $250 | ~$160 |
| 10K | $2,500 | ~$1,600 |
| 30K | $7,500 | ~$4,700 |

---

## The Engineering Time Equation

Self-hosting costs eng time. Roughly:

- **Initial setup** (Modal / RunPod, weights on volume, basic worker, deploy): 1–2 days.
- **Production hardening** (queue, webhooks, observability, multi-vendor failover): 1–2 weeks.
- **Ongoing** (model updates, capacity outages, cost monitoring): ~10% of one engineer's time.

If your cloud bill is **$2K/mo** and an engineer costs **$10K/mo loaded**, self-hosting saves money only if it cuts the bill by >$1K and takes <10% of that engineer.

**Rule of thumb**:
- **<$1K/mo cloud bill** → use Replicate / fal. Don't optimize.
- **$1K–$5K/mo** → measure both. Often still Replicate wins.
- **$5K–$20K/mo** → self-host the hot models, keep Replicate for tail.
- **>$20K/mo** → self-host most things, multi-vendor for failover.

---

## When Per-Prediction Beats GPU-Time

Counterintuitive cases:
- **Spiky workload, idle most of the time**: per-prediction wins because you're not paying for idle GPU.
- **Long-tail many models**: paying for warm replicas of 30 different models is worse than per-prediction.
- **Geographic spread**: per-prediction at the edge (Workers AI) often wins for latency vs region-pinned GPU.

---

## Cost Monitoring & Kill Switches

Production must have:
1. **Vendor billing alerts** (Modal, Replicate, RunPod, fal — all support email/webhook).
2. **Per-user rate limits** at the gateway.
3. **Max-spend-per-user-per-day** kill switch.
4. **Anomaly detection** on cost-per-conversion (if cost/user spikes 5×, page someone).

Better Stack / Datadog dashboards for ML cost are immature in 2026 — most teams build their own. Prometheus + Grafana with cost metrics scraped from each vendor's API works well.

---

## TL;DR

- **<2K media gens/day** → API. Eng time costs more.
- **>10K/day** → self-hosted RunPod / Modal with snapshots.
- **In between** → measure both.
- **Cold start rule**: Sub-5s p99 → memory snapshots + warm replica. Sub-500ms → Active worker, ~$70/mo idle.
- **Egress rule**: Outputs land in R2. Always.
- **Don't trust any benchmark you didn't run.** Vendors switch checkpoints quietly. Re-run your own A/B every 60 days.
