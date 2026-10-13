#!/usr/bin/env python3
"""
cost_projector.py -- Compare monthly video hosting cost across managed
platforms and a self-hosted stack, given your own stored/delivered minutes.

Stdlib only, no dependencies. Rates are 2026 approximate public list-price
figures for illustration and rough comparison, NOT a quote -- always check
current provider pricing pages before committing. This script exists to
force an actual volume-based projection instead of picking a platform off a
per-unit rate on a pricing page (see the "Picking a Minutes-Billed Platform
Without a Volume Projection" anti-pattern in SKILL.md).

Usage:
    python3 cost_projector.py --stored-minutes 50000 --delivered-minutes 400000 --avg-bitrate-mbps 3

Options:
    --stored-minutes FLOAT       Total minutes of video stored per month (default: 10000)
    --delivered-minutes FLOAT    Total minutes of video delivered/streamed per month (default: 50000)
    --avg-bitrate-mbps FLOAT     Average encoded bitrate across your rendition ladder, in Mbps
                                  (default: 3.0). Used to convert minutes to GB for GB-billed
                                  platforms and self-hosted egress.
    --json                       Emit machine-readable JSON instead of a table.
"""

import argparse
import json
import sys

CLOUDFLARE_STREAM_STORAGE_PER_1000_MIN = 5.00
CLOUDFLARE_STREAM_DELIVERY_PER_1000_MIN = 1.00

MUX_STORAGE_PER_GB = 0.02
MUX_DELIVERY_PER_GB = 0.05
MUX_ENCODING_PER_MIN_INPUT = 0.03

BUNNY_STORAGE_PER_GB = 0.005
BUNNY_DELIVERY_PER_GB = 0.005

SELFHOST_STORAGE_PER_GB = 0.023
SELFHOST_EGRESS_PER_GB_HYPERSCALER = 0.085
SELFHOST_EGRESS_PER_GB_SPECIALIST = 0.006


def minutes_to_gb(minutes, bitrate_mbps):
    bits = minutes * 60 * bitrate_mbps * 1_000_000
    return bits / 8 / 1_000_000_000


def project(stored_minutes, delivered_minutes, bitrate_mbps):
    stored_gb = minutes_to_gb(stored_minutes, bitrate_mbps)
    delivered_gb = minutes_to_gb(delivered_minutes, bitrate_mbps)

    cloudflare = (
        (stored_minutes / 1000) * CLOUDFLARE_STREAM_STORAGE_PER_1000_MIN
        + (delivered_minutes / 1000) * CLOUDFLARE_STREAM_DELIVERY_PER_1000_MIN
    )

    mux = (
        stored_gb * MUX_STORAGE_PER_GB
        + delivered_gb * MUX_DELIVERY_PER_GB
        + stored_minutes * MUX_ENCODING_PER_MIN_INPUT
    )

    bunny = stored_gb * BUNNY_STORAGE_PER_GB + delivered_gb * BUNNY_DELIVERY_PER_GB

    selfhost_hyperscaler_cdn = (
        stored_gb * SELFHOST_STORAGE_PER_GB + delivered_gb * SELFHOST_EGRESS_PER_GB_HYPERSCALER
    )
    selfhost_specialist_cdn = (
        stored_gb * SELFHOST_STORAGE_PER_GB + delivered_gb * SELFHOST_EGRESS_PER_GB_SPECIALIST
    )

    return {
        "inputs": {
            "stored_minutes": stored_minutes,
            "delivered_minutes": delivered_minutes,
            "avg_bitrate_mbps": bitrate_mbps,
            "stored_gb": round(stored_gb, 2),
            "delivered_gb": round(delivered_gb, 2),
        },
        "monthly_cost_usd": {
            "cloudflare_stream": round(cloudflare, 2),
            "mux": round(mux, 2),
            "bunnycdn_stream": round(bunny, 2),
            "self_hosted_hyperscaler_cdn": round(selfhost_hyperscaler_cdn, 2),
            "self_hosted_specialist_video_cdn": round(selfhost_specialist_cdn, 2),
        },
        "note": (
            "Rates are 2026 approximate list prices for rough comparison only -- "
            "verify current pricing with each provider before making a commitment. "
            "Self-hosted figures exclude engineering/ops cost to build and run the "
            "transcode + storage + CDN pipeline; managed platforms bundle that cost in."
        ),
    }


def render_table(result):
    inputs = result["inputs"]
    costs = result["monthly_cost_usd"]
    lines = []
    lines.append("Video Hosting Cost Projection")
    lines.append("=" * 40)
    lines.append("Stored minutes/mo:    {:,.0f}  (~{:,.1f} GB @ {} Mbps)".format(
        inputs['stored_minutes'], inputs['stored_gb'], inputs['avg_bitrate_mbps']))
    lines.append("Delivered minutes/mo: {:,.0f}  (~{:,.1f} GB @ {} Mbps)".format(
        inputs['delivered_minutes'], inputs['delivered_gb'], inputs['avg_bitrate_mbps']))
    lines.append("")
    lines.append("{:<38}{:>20}".format("Platform", "Monthly cost (USD)"))
    lines.append("-" * 58)
    label_map = {
        "cloudflare_stream": "Cloudflare Stream",
        "mux": "Mux",
        "bunnycdn_stream": "BunnyCDN Stream",
        "self_hosted_hyperscaler_cdn": "Self-hosted (hyperscaler CDN egress)",
        "self_hosted_specialist_video_cdn": "Self-hosted (specialist video CDN)",
    }
    ranked = sorted(costs.items(), key=lambda kv: kv[1])
    for key, cost in ranked:
        lines.append("{:<38}{:>20}".format(label_map[key], "$" + format(cost, ',.2f')))
    lines.append("")
    cheapest = ranked[0]
    priciest = ranked[-1]
    if priciest[1] > 0:
        spread = priciest[1] / max(cheapest[1], 0.01)
        lines.append("Cheapest: {} (${:,.2f}/mo)".format(label_map[cheapest[0]], cheapest[1]))
        lines.append("Most expensive: {} (${:,.2f}/mo) -- {:.1f}x the cheapest".format(
            label_map[priciest[0]], priciest[1], spread))
    lines.append("")
    lines.append(result["note"])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stored-minutes", type=float, default=10000.0)
    parser.add_argument("--delivered-minutes", type=float, default=50000.0)
    parser.add_argument("--avg-bitrate-mbps", type=float, default=3.0)
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of a table")
    args = parser.parse_args()

    if args.stored_minutes < 0 or args.delivered_minutes < 0 or args.avg_bitrate_mbps <= 0:
        print("Error: minutes must be >= 0 and bitrate must be > 0", file=sys.stderr)
        sys.exit(1)

    result = project(args.stored_minutes, args.delivered_minutes, args.avg_bitrate_mbps)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(render_table(result))


if __name__ == "__main__":
    main()
