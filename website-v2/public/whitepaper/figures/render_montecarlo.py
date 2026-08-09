#!/usr/bin/env python3
"""
Render Monte Carlo result figures for the Bonded Commons / Anchor whitepapers.

Reads:
  proofs/bonded/pareto/simulation.run.log          (A0 baseline)
  proofs/bonded/pareto/simulation-sybil.run.log    (A5)
  proofs/bonded/pareto/simulation-cartel.run.log   (A6)

Writes:
  website-v2/public/whitepaper/figures/fig-pareto-dominance.pdf
  website-v2/public/whitepaper/figures/fig-sybil-deposit-floor.pdf
  website-v2/public/whitepaper/figures/fig-cartel-folk-theorem.pdf

Style — Port Daddy paper palette:
  cobalt     #003FB8   primary data / emphasis
  teal       #00564C   favorable / verified regions
  amber      #6B4500   caution / comparison
  ebony      #121212   text / axes
  ink        #1B1712   secondary text
  sandstone  #D8C7A6   grid / neutral structure
"""

from __future__ import annotations
import csv
import io
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from matplotlib.patches import Patch
import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
LOGS = REPO / "proofs" / "bonded" / "pareto"

# ── palette ─────────────────────────────────────────────────────────────
SAND = "#E9DCC4"
SAND_DEEP = "#D8C7A6"
EBONY = "#121212"
INK = "#1B1712"
COBALT = "#003FB8"
TEAL = "#00564C"
AMBER = "#6B4500"
GRAY = "#5C5650"
PAPER = "#FBF7EF"

plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["Palatino", "Charter", "Georgia", "DejaVu Serif"],
    "font.size": 11,
    "axes.titlesize": 13,
    "axes.titleweight": "bold",
    "axes.labelsize": 11,
    "axes.edgecolor": EBONY,
    "axes.linewidth": 0.8,
    "axes.facecolor": PAPER,
    "figure.facecolor": "white",
    "savefig.facecolor": "white",
    "axes.grid": True,
    "grid.color": SAND_DEEP,
    "grid.linewidth": 0.5,
    "grid.alpha": 0.6,
    "xtick.color": INK,
    "ytick.color": INK,
    "xtick.labelsize": 10,
    "ytick.labelsize": 10,
    "legend.frameon": False,
    "legend.fontsize": 10,
})


def read_tsv(path: Path) -> list[dict[str, str]]:
    """Parse run.log: comment lines start with '#'; first non-comment row is header."""
    text = path.read_text(encoding="utf-8")
    rows = []
    header = None
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        fields = raw.split("\t")
        if header is None:
            header = fields
            continue
        if len(fields) != len(header):
            continue
        rows.append(dict(zip(header, fields)))
    return rows


# ── 1) Pareto-dominance baseline figure ─────────────────────────────────

def fig_pareto_dominance(out: Path) -> None:
    rows = read_tsv(LOGS / "simulation.run.log")

    # Group by (cartelSize, n_insurers) and plot dominance rate vs sigma_r.
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.2), constrained_layout=True)

    # Left: dominance rate vs sigma_r, grouped by cartel size at n=5.
    ax = axes[0]
    by_cartel = {0: [], 1: [], 3: []}
    for r in rows:
        if int(r["n_insurers"]) != 5:
            continue
        cs = int(r["cartelSize"])
        if cs in by_cartel:
            by_cartel[cs].append(
                (float(r["sigma_r"]), float(r["pareto_dominance_rate"]))
            )
    # Distinct, readable colors against the sand background.
    colors = {0: TEAL, 1: AMBER, 3: COBALT}
    markers = {0: "o", 1: "s", 3: "^"}
    labels = {0: "no cartel", 1: "1 colluder", 3: "3 colluders"}
    for cs in (0, 1, 3):
        pts = sorted(by_cartel[cs])
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        ax.plot(xs, ys, marker=markers[cs], linestyle="-",
                color=colors[cs], linewidth=2.2, markersize=8,
                markeredgecolor=EBONY, markeredgewidth=0.6,
                label=labels[cs])
    ax.axhline(0.5, color=INK, linewidth=0.7, linestyle="--", alpha=0.7)
    ax.text(0.51, 0.52, "0.5 dominance threshold",
            color=INK, fontsize=9, style="italic", va="bottom", ha="right")
    ax.set_xlabel(r"reputation noise $\sigma_r$")
    ax.set_ylabel("Pareto-dominance rate")
    ax.set_title(r"(a) dominance rate vs $\sigma_r$  ($n=5$)")
    ax.set_ylim(-0.02, 1.10)
    ax.legend(loc="upper right", framealpha=0.95, facecolor=PAPER,
              edgecolor=SAND_DEEP)

    # Right: dominance rate vs n_insurers at sigma_r=0, no cartel.
    ax = axes[1]
    by_n = []
    for r in rows:
        if int(r["cartelSize"]) != 0 or float(r["sigma_r"]) != 0.0:
            continue
        by_n.append((int(r["n_insurers"]), float(r["pareto_dominance_rate"])))
    by_n.sort()
    xs = [p[0] for p in by_n]
    ys = [p[1] for p in by_n]
    bars = ax.bar(xs, ys, width=1.6, color=TEAL, edgecolor=EBONY, linewidth=1.0)
    for b, y in zip(bars, ys):
        ax.text(b.get_x() + b.get_width() / 2, y + 0.015,
                f"{y:.2f}", ha="center", va="bottom",
                fontsize=10, color=EBONY, fontweight="bold")
    ax.set_xlabel("number of insurers $n$")
    # No duplicate y-label — left panel already labels the axis.
    ax.set_title(r"(b) dominance rate vs $n$  ($\sigma_r=0$, no cartel)")
    ax.set_xticks(xs)
    ax.set_ylim(0, 1.15)

    # NB: no fig.suptitle — the LaTeX caption is the authoritative title.
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"wrote {out}")


# ── 2) Sybil deposit-floor figure (A5) ──────────────────────────────────

def fig_sybil_deposit_floor(out: Path) -> None:
    rows = read_tsv(LOGS / "simulation-sybil.run.log")

    fig, axes = plt.subplots(1, 2, figsize=(10, 4.4), constrained_layout=True)

    # Left: attacker net per trial vs B_dep, for sybilCount = 1 and 3.
    ax = axes[0]
    by_k = {1: [], 3: []}
    for r in rows:
        k = int(r["sybilCount"])
        if k in by_k:
            by_k[k].append(
                (float(r["b_dep"]), float(r["mean_sybil_net"]))
            )
    colors = {1: COBALT, 3: AMBER}
    labels = {1: "K = 1 Sybil identity", 3: "K = 3 Sybil identities"}
    for k in (1, 3):
        pts = sorted(by_k[k])
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        ax.plot(xs, ys, "o-", color=colors[k], linewidth=2.2, markersize=6,
                label=labels[k])
    ax.axhline(0, color=EBONY, linewidth=1.0, linestyle="-", alpha=0.5)
    ax.set_xscale("log")
    ax.set_xlabel(r"per-identity deposit $B_{\mathrm{dep}}$ (USD)")
    ax.set_ylabel("attacker net per 50-txn trial (USD)")
    ax.set_title("(a) attacker net vs deposit  (cap-bounded)")
    ax.legend(loc="upper right")

    # Right: commons deficit vs B_dep — what the protocol cares about.
    ax = axes[1]
    by_k = {1: [], 3: []}
    for r in rows:
        k = int(r["sybilCount"])
        if k in by_k:
            by_k[k].append(
                (float(r["b_dep"]), float(r["mean_commons_deficit"]))
            )
    for k in (1, 3):
        pts = sorted(by_k[k])
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        ax.plot(xs, ys, "s-", color=colors[k], linewidth=2.2, markersize=6,
                label=labels[k])
    # Annotate the deficit→0 region.
    ax.axhspan(-1, 5, color=TEAL, alpha=0.14,
               label="commons fully reimbursed")
    ax.set_xscale("log")
    ax.set_xlabel(r"per-identity deposit $B_{\mathrm{dep}}$ (USD)")
    ax.set_ylabel("commons deficit per 50-txn trial (USD)")
    ax.set_title("(b) commons deficit vs deposit")
    ax.legend(loc="upper right", framealpha=0.95, facecolor=PAPER,
              edgecolor=SAND_DEEP)

    # NB: no fig.suptitle — the LaTeX caption is the authoritative title.
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"wrote {out}")


# ── 3) Cartel folk-theorem heatmap (A6) ─────────────────────────────────

def fig_cartel_folk(out: Path) -> None:
    rows = read_tsv(LOGS / "simulation-cartel.run.log")
    pds = sorted({float(r["p_d"]) for r in rows})
    deltas = sorted({float(r["delta"]) for r in rows})
    grid_PV = np.zeros((len(deltas), len(pds)))
    grid_sustainable = np.zeros((len(deltas), len(pds)), dtype=bool)
    grid_lifespan = np.zeros((len(deltas), len(pds)))
    for r in rows:
        i = deltas.index(float(r["delta"]))
        j = pds.index(float(r["p_d"]))
        grid_PV[i, j] = float(r["mean_collude_PV"])
        grid_sustainable[i, j] = r["sustainable"] == "YES"
        grid_lifespan[i, j] = float(r["mean_lifespan"])

    fig, axes = plt.subplots(1, 2, figsize=(11, 4.6), constrained_layout=True)

    # Left: sustainability map.
    ax = axes[0]
    im = ax.imshow(grid_sustainable.astype(float), aspect="auto",
                   cmap=matplotlib.colors.ListedColormap([PAPER, COBALT]),
                   origin="lower", extent=[-0.5, len(pds) - 0.5, -0.5, len(deltas) - 0.5])
    ax.set_xticks(range(len(pds)))
    ax.set_xticklabels([f"{p:.2f}" for p in pds])
    ax.set_yticks(range(len(deltas)))
    ax.set_yticklabels([f"{d:.2f}" for d in deltas])
    ax.set_xlabel(r"per-round detection probability $p_d$")
    ax.set_ylabel(r"discount factor $\delta$")
    ax.set_title("(a) cartel sustainability map")
    # Annotate each cell with YES/NO.
    for i in range(len(deltas)):
        for j in range(len(pds)):
            text = "Y" if grid_sustainable[i, j] else "—"
            color = "white" if grid_sustainable[i, j] else INK
            ax.text(j, i, text, ha="center", va="center",
                    fontsize=10, fontweight="bold", color=color)
    # Mark the threshold p_d* per delta with a thin black line.
    for i, d in enumerate(deltas):
        for j in range(len(pds) - 1):
            if grid_sustainable[i, j] and not grid_sustainable[i, j + 1]:
                ax.axvline(j + 0.5, ymin=(i) / len(deltas),
                           ymax=(i + 1) / len(deltas),
                           color=EBONY, linewidth=2.5)
                break
    legend_elems = [
        Patch(facecolor=COBALT, edgecolor=EBONY, label="sustainable"),
        Patch(facecolor=PAPER, edgecolor=EBONY, label="collapses"),
    ]
    ax.legend(handles=legend_elems, loc="upper center",
              bbox_to_anchor=(0.5, -0.22), ncol=2, frameon=False)

    # Right: lifespan vs p_d. Detection time is independent of delta in this
    # model, so averaging the delta rows is more honest than drawing four
    # nearly coincident curves. The analytical comparator is a geometric
    # waiting time truncated at the simulation's 200-round horizon.
    ax = axes[1]
    mean_lifespan = grid_lifespan.mean(axis=0)
    horizon = 200
    expected_lifespan = [
        (1.0 - (1.0 - p) ** horizon) / p for p in pds
    ]
    ax.plot(pds, mean_lifespan, "o-", linewidth=2.4, markersize=6,
            color=COBALT, label="simulation mean")
    ax.plot(pds, expected_lifespan, "--", linewidth=1.8,
            color=TEAL, label=r"$\mathbb{E}[\min(G,200)]$")
    ax.axhline(10, color=EBONY, linewidth=0.8, linestyle=":",
               alpha=0.7, label="10-round target")
    ax.set_xscale("log")
    ax.set_xlabel(r"per-round detection probability $p_d$")
    ax.set_ylabel("mean cartel lifespan (rounds)")
    ax.set_title("(b) lifespan vs detection rate")
    ax.legend(loc="upper right", framealpha=0.95, facecolor=PAPER,
              edgecolor=SAND_DEEP)

    # NB: no fig.suptitle — the LaTeX caption is the authoritative title.
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"wrote {out}")


def main() -> None:
    fig_pareto_dominance(HERE / "fig-pareto-dominance.pdf")
    fig_sybil_deposit_floor(HERE / "fig-sybil-deposit-floor.pdf")
    fig_cartel_folk(HERE / "fig-cartel-folk-theorem.pdf")


if __name__ == "__main__":
    main()
