#!/usr/bin/env python3
"""
Topology Bandwidth Calculator -- Mesh vs SFU vs MCU

Makes the "mesh breaks down past ~4 participants" claim concrete with numbers
instead of folklore. Computes per-participant and total network load for each
topology given a room size and a per-stream video bitrate, so you can show a
skeptical teammate (or your own future self) exactly where mesh upload
bandwidth explodes.

Model (deliberately simple, stdlib only, no external deps):

  N participants, each publishing one video stream at `bitrate_kbps`.

  MESH (every peer connects directly to every other peer):
    - Each peer uploads its own stream to N-1 other peers: upload = (N-1) * bitrate
    - Each peer downloads N-1 incoming streams: download = (N-1) * bitrate
    - Total network egress across all peers: N * (N-1) * bitrate  (grows O(N^2))

  SFU (Selective Forwarding Unit -- server relays without transcoding):
    - Each peer uploads once to the server: upload = bitrate
    - Each peer downloads N-1 streams relayed by the server: download = (N-1) * bitrate
    - Server upload load: N * (N-1) * bitrate (server absorbs the O(N^2) term,
      clients only ever see O(N))
    - Server download load: N * bitrate

  MCU (Multipoint Control Unit -- server mixes/transcodes into one stream):
    - Each peer uploads once: upload = bitrate
    - Each peer downloads ONE mixed stream: download = bitrate (roughly; real MCUs
      often send a slightly higher-bitrate composite, but the point is O(1) per client)
    - Server does N-way decode + composite + N-way encode: heavy CPU/GPU cost,
      not modeled here (that's the actual reason MCU is rarely the 2026 default --
      compute cost, not bandwidth, becomes the bottleneck)

Usage:
    python3 topology_bandwidth_calculator.py --participants 8 --bitrate-kbps 1500
    python3 topology_bandwidth_calculator.py --participants 4 8 12 --bitrate-kbps 1500 --json

Exit codes: 0 on success, 2 on invalid input.
"""

import argparse
import json
import sys


def compute(n: int, bitrate_kbps: float) -> dict:
    if n < 1:
        raise ValueError("participants must be >= 1")
    if bitrate_kbps <= 0:
        raise ValueError("bitrate_kbps must be > 0")

    peers_other = max(n - 1, 0)

    mesh_upload_per_peer = peers_other * bitrate_kbps
    mesh_download_per_peer = peers_other * bitrate_kbps
    mesh_total_network_kbps = n * peers_other * bitrate_kbps

    sfu_upload_per_peer = bitrate_kbps
    sfu_download_per_peer = peers_other * bitrate_kbps
    sfu_server_upload_kbps = n * peers_other * bitrate_kbps  # server -> clients
    sfu_server_download_kbps = n * bitrate_kbps              # clients -> server

    mcu_upload_per_peer = bitrate_kbps
    mcu_download_per_peer = bitrate_kbps  # composite stream, ~O(1)
    mcu_server_download_kbps = n * bitrate_kbps
    mcu_server_output_kbps = n * bitrate_kbps  # one composite stream per viewer

    return {
        "participants": n,
        "bitrate_kbps": bitrate_kbps,
        "mesh": {
            "per_peer_upload_kbps": mesh_upload_per_peer,
            "per_peer_download_kbps": mesh_download_per_peer,
            "total_network_kbps": mesh_total_network_kbps,
            "viable": n <= 4,
        },
        "sfu": {
            "per_peer_upload_kbps": sfu_upload_per_peer,
            "per_peer_download_kbps": sfu_download_per_peer,
            "server_upload_kbps": sfu_server_upload_kbps,
            "server_download_kbps": sfu_server_download_kbps,
        },
        "mcu": {
            "per_peer_upload_kbps": mcu_upload_per_peer,
            "per_peer_download_kbps": mcu_download_per_peer,
            "server_download_kbps": mcu_server_download_kbps,
            "server_output_kbps": mcu_server_output_kbps,
            "note": "server CPU/GPU cost for N-way transcode not modeled; usually the real MCU bottleneck",
        },
    }


def format_kbps(v: float) -> str:
    if v >= 1000:
        return f"{v / 1000:.2f} Mbps"
    return f"{v:.0f} kbps"


def render_text(result: dict) -> str:
    n = result["participants"]
    lines = [f"=== {n} participants @ {result['bitrate_kbps']:.0f} kbps/stream ==="]

    mesh = result["mesh"]
    flag = "" if mesh["viable"] else "  <-- NOT VIABLE (past ~4 participants)"
    lines.append(
        f"MESH : per-peer upload {format_kbps(mesh['per_peer_upload_kbps'])}, "
        f"download {format_kbps(mesh['per_peer_download_kbps'])}, "
        f"total network {format_kbps(mesh['total_network_kbps'])}{flag}"
    )

    sfu = result["sfu"]
    lines.append(
        f"SFU  : per-peer upload {format_kbps(sfu['per_peer_upload_kbps'])}, "
        f"download {format_kbps(sfu['per_peer_download_kbps'])} | "
        f"server upload {format_kbps(sfu['server_upload_kbps'])}, "
        f"server download {format_kbps(sfu['server_download_kbps'])}"
    )

    mcu = result["mcu"]
    lines.append(
        f"MCU  : per-peer upload {format_kbps(mcu['per_peer_upload_kbps'])}, "
        f"download {format_kbps(mcu['per_peer_download_kbps'])} | "
        f"server sees {format_kbps(mcu['server_download_kbps'])} in, "
        f"transcodes N ways ({mcu['note']})"
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--participants", "-n", type=int, nargs="+", default=[4, 8, 20],
        help="Room size(s) to evaluate, e.g. --participants 4 8 20 (default: 4 8 20)",
    )
    parser.add_argument(
        "--bitrate-kbps", "-b", type=float, default=1500.0,
        help="Per-stream video bitrate in kbps (default: 1500, a typical 720p simulcast layer)",
    )
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON instead of text")
    args = parser.parse_args()

    try:
        results = [compute(n, args.bitrate_kbps) for n in args.participants]
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print(render_text(results[0]) if len(results) == 1 else
              "\n\n".join(render_text(r) for r in results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
