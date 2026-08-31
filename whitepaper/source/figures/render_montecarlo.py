#!/usr/bin/env python3
"""
Render Monte Carlo result figures for the Bonded Commons / Anchor whitepapers.

Reads:
  whitepaper/research/program/simulations/pareto/simulation.run.log          (A0 baseline)
  whitepaper/research/program/simulations/pareto/simulation-sybil.run.log    (A5)
  whitepaper/research/program/simulations/pareto/simulation-cartel.run.log   (A6)

Writes:
  whitepaper/source/figures/fig-pareto-dominance.pdf
  whitepaper/source/figures/fig-sybil-deposit-floor.pdf
  whitepaper/source/figures/fig-cartel-folk-theorem.pdf

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
from math import sqrt

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from matplotlib.patches import Patch
import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
LOGS = REPO / "whitepaper" / "research" / "program" / "simulations" / "pareto"

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
    "font.serif": ["Palatino"],
    "mathtext.fontset": "custom",
    "mathtext.rm": "Palatino",
    "mathtext.it": "Palatino:italic",
    "mathtext.bf": "Palatino:bold",
    "mathtext.sf": "Palatino",
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
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


def run_metadata(path: Path) -> dict[str, float]:
    """Read numeric key=value metadata from the comment header."""
    values: dict[str, float] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.startswith("#"):
            continue
        for token in raw[1:].strip().split():
            if "=" not in token:
                continue
            key, value = token.split("=", 1)
            try:
                values[key] = float(value)
            except ValueError:
                continue
    return values


def wilson_interval(rate: float, trials: int, z: float = 1.96) -> tuple[float, float]:
    """Two-sided Wilson score interval for a binomial proportion."""
    denominator = 1.0 + z * z / trials
    center = (rate + z * z / (2.0 * trials)) / denominator
    half_width = (
        z
        * sqrt(rate * (1.0 - rate) / trials + z * z / (4.0 * trials * trials))
        / denominator
    )
    return max(0.0, center - half_width), min(1.0, center + half_width)


# ── 1) Pareto-dominance baseline figure ─────────────────────────────────

def fig_pareto_dominance(out: Path) -> None:
    log_path = LOGS / "simulation.run.log"
    rows = read_tsv(log_path)
    trials = int(run_metadata(log_path).get("trials_per_config", 2000))

    # Both panels share the same probability scale and the same Wilson intervals.
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.75), sharey=True)
    fig.subplots_adjust(left=0.085, right=0.985, top=0.88,
                        bottom=0.24, wspace=0.035)

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
    colors = {0: TEAL, 1: AMBER, 3: GRAY}
    markers = {0: "o", 1: "s", 3: "^"}
    styles = {0: "-", 1: "--", 3: ":"}
    labels = {0: "no cartel", 1: "1 colluder", 3: "3 colluders"}
    for cs in (0, 1, 3):
        pts = sorted(by_cartel[cs])
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        intervals = [wilson_interval(y, trials) for y in ys]
        yerr = np.array(
            [[y - lo for y, (lo, _) in zip(ys, intervals)],
             [hi - y for y, (_, hi) in zip(ys, intervals)]]
        )
        ax.errorbar(
            xs, ys, yerr=yerr, marker=markers[cs], linestyle=styles[cs],
            color=colors[cs], linewidth=2.0, markersize=6.5,
            capsize=3.2, elinewidth=1.0, markeredgecolor=EBONY,
            markeredgewidth=0.5, label=labels[cs]
        )
    ax.axhspan(0.5, 1.0, color=TEAL, alpha=0.07, zorder=0)
    ax.axhline(0.5, color=INK, linewidth=0.7, linestyle="--", alpha=0.7)
    ax.text(0.02, 0.515, "criterion met", transform=ax.get_yaxis_transform(),
            color=TEAL, fontsize=9, va="bottom", ha="left")
    ax.set_xlabel(r"reputation noise $\sigma_r$")
    ax.set_ylabel("Pareto-dominance rate")
    ax.set_title(r"(a) dominance rate vs $\sigma_r$  ($n=5$)")
    ax.set_ylim(0, 1.02)
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
    intervals = [wilson_interval(y, trials) for y in ys]
    yerr = np.array(
        [[y - lo for y, (lo, _) in zip(ys, intervals)],
         [hi - y for y, (_, hi) in zip(ys, intervals)]]
    )
    ax.axhspan(0.5, 1.0, color=TEAL, alpha=0.07, zorder=0)
    ax.axhline(0.5, color=INK, linewidth=0.7, linestyle="--", alpha=0.7)
    ax.errorbar(
        xs, ys, yerr=yerr, marker="o", linestyle="-", color=TEAL,
        linewidth=2.0, markersize=7, capsize=3.2, elinewidth=1.0,
        markeredgecolor=EBONY, markeredgewidth=0.5
    )
    ax.set_xlabel("number of insurers $n$")
    # No duplicate y-label — left panel already labels the axis.
    ax.set_title(r"(b) dominance rate vs $n$  ($\sigma_r=0$, no cartel)")
    ax.set_xticks(xs)
    ax.set_ylim(0, 1.02)

    fig.text(
        0.5, 0.055,
        f"Wilson 95% intervals · {trials:,} independent trials per configuration · 50 transactions per trial",
        ha="center", va="bottom", fontsize=9, color=GRAY,
    )

    # NB: no fig.suptitle — the LaTeX caption is the authoritative title.
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"wrote {out}")


# ── 2) Sybil deposit-floor figure (A5) ──────────────────────────────────

def fig_sybil_deposit_floor(out: Path) -> None:
    log_path = LOGS / "simulation-sybil.run.log"
    rows = read_tsv(log_path)
    trials = int(run_metadata(log_path).get("trials_per_config", 2000))

    fig, axes = plt.subplots(1, 2, figsize=(10, 4.85))
    fig.subplots_adjust(left=0.085, right=0.985, top=0.88,
                        bottom=0.245, wspace=0.20)

    # Left: attacker net per trial vs B_dep, for sybilCount = 1 and 3.
    ax = axes[0]
    by_k = {1: [], 3: []}
    for r in rows:
        k = int(r["sybilCount"])
        if k in by_k:
            by_k[k].append(
                (float(r["b_dep"]), float(r["mean_sybil_net"]))
            )
    colors = {1: TEAL, 3: AMBER}
    styles = {1: "-", 3: "--"}
    labels = {1: "K = 1 Sybil identity", 3: "K = 3 Sybil identities"}
    for k in (1, 3):
        pts = sorted(by_k[k])
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        ax.plot(xs, ys, marker="o", linestyle=styles[k], color=colors[k],
                linewidth=2.2, markersize=6, label=labels[k])
    ax.axvspan(200, 1000, color=AMBER, alpha=0.07, zorder=0)
    ax.axvline(200, color=AMBER, linewidth=1.2, linestyle=(0, (4, 3)))
    ax.text(185, 105, "coverage cap reached\n$B_{\\rm dep}\\approx 200$",
            color=AMBER, fontsize=9, ha="right", va="bottom")
    ax.axhline(0, color=EBONY, linewidth=1.0, linestyle="-", alpha=0.5)
    ax.set_xscale("log")
    ax.set_xlabel(r"per-identity deposit $B_{\mathrm{dep}}$ (USD)")
    ax.set_ylabel("attacker net per 50-txn trial (USD)")
    ax.set_title("(a) attacker profit stays positive after reimbursement")
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
        ax.plot(xs, ys, marker="s", linestyle=styles[k], color=colors[k],
                linewidth=2.2, markersize=6, label=labels[k])
    # Annotate the deficit→0 region.
    ax.axhspan(-1, 5, color=TEAL, alpha=0.14,
               label="commons fully reimbursed")
    ax.axvspan(200, 1000, color=AMBER, alpha=0.07, zorder=0)
    ax.axvline(200, color=AMBER, linewidth=1.2, linestyle=(0, (4, 3)))
    ax.set_xscale("log")
    ax.set_xlabel(r"per-identity deposit $B_{\mathrm{dep}}$ (USD)")
    ax.set_ylabel("commons deficit per 50-txn trial (USD)")
    ax.set_title("(b) commons deficit vs deposit")
    ax.legend(loc="upper right", framealpha=0.95, facecolor=PAPER,
              edgecolor=SAND_DEEP)

    # The log records a binomial profitable-trial proportion but not the
    # run-level variance of the dollar means.  Show the uncertainty the
    # artifact actually supports instead of drawing fictional confidence bands.
    profitable_rates = [float(r["attack_profitable_rate"]) for r in rows]
    low = min(wilson_interval(rate, trials)[0] for rate in profitable_rates)
    high = max(wilson_interval(rate, trials)[1] for rate in profitable_rates)
    fig.text(
        0.5, 0.052,
        f"Profitable-trial fraction: {min(profitable_rates):.3f}–{max(profitable_rates):.3f}; "
        f"Wilson 95% envelope [{low:.3f}, {high:.3f}], n={trials:,}/configuration.  "
        "Dollar curves are means; the run log stores no dispersion.",
        ha="center", va="bottom", fontsize=8.8, color=GRAY,
    )

    # NB: no fig.suptitle — the LaTeX caption is the authoritative title.
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"wrote {out}")


# ── 3) Cartel folk-theorem heatmap (A6) ─────────────────────────────────

def fig_cartel_folk(out: Path) -> None:
    log_path = LOGS / "simulation-cartel.run.log"
    rows = read_tsv(log_path)
    meta = run_metadata(log_path)
    pds = sorted({float(r["p_d"]) for r in rows})
    deltas = sorted({float(r["delta"]) for r in rows})
    grid_sustainable = np.zeros((len(deltas), len(pds)), dtype=bool)
    grid_lifespan = np.zeros((len(deltas), len(pds)))
    for r in rows:
        i = deltas.index(float(r["delta"]))
        j = pds.index(float(r["p_d"]))
        grid_sustainable[i, j] = r["sustainable"] == "YES"
        grid_lifespan[i, j] = float(r["mean_lifespan"])

    trials = int(meta.get("trials_per_config", 5000))
    horizon = int(meta.get("rounds", 200))
    mu = meta.get("mu", 10.0)
    q_floor = meta.get("q_floor", 15.0)
    cartel_size = meta.get("cartel_size", 3.0)
    penalty_mult = meta.get("cartel_penalty_mult", 5.0)
    defect_epsilon = 0.05  # fixed by the simulation source
    pi_c = (q_floor - mu) / cartel_size
    pi_d = q_floor - defect_epsilon - mu
    loss = penalty_mult * (q_floor - mu)

    fig, axes = plt.subplots(1, 2, figsize=(11, 4.8))
    fig.subplots_adjust(left=0.075, right=0.985, top=0.90, bottom=0.27, wspace=0.27)

    # Left: tested phase map on the actual detection-probability scale.
    ax = axes[0]
    log_p = np.log10(np.asarray(pds))
    x_edges_log = np.r_[
        log_p[0] - (log_p[1] - log_p[0]) / 2,
        (log_p[:-1] + log_p[1:]) / 2,
        log_p[-1] + (log_p[-1] - log_p[-2]) / 2,
    ]
    x_edges = 10 ** x_edges_log
    delta_arr = np.asarray(deltas)
    y_edges = np.r_[
        delta_arr[0] - (delta_arr[1] - delta_arr[0]) / 2,
        (delta_arr[:-1] + delta_arr[1:]) / 2,
        delta_arr[-1] + (delta_arr[-1] - delta_arr[-2]) / 2,
    ]
    phase_cmap = matplotlib.colors.ListedColormap(["#DCE9E6", "#E8D5AA"])
    phase_norm = matplotlib.colors.BoundaryNorm([-0.5, 0.5, 1.5], phase_cmap.N)
    ax.pcolormesh(
        x_edges,
        y_edges,
        grid_sustainable.astype(int),
        cmap=phase_cmap,
        norm=phase_norm,
        shading="flat",
        edgecolors="white",
        linewidth=0.8,
    )
    ax.set_xscale("log")
    display_pds = np.asarray([0.01, 0.03, 0.05, 0.10, 0.20, 0.50])
    ax.set_xticks(display_pds)
    ax.set_xticklabels([f"{p:.2f}" for p in display_pds])
    ax.set_yticks(deltas)
    ax.set_yticklabels([f"{d:.2f}" for d in deltas])
    ax.set_xlabel(r"per-round detection probability $p_d$")
    ax.set_ylabel(r"discount factor $\delta$")
    ax.set_title("(a) cooperation phase")
    ax.grid(False)

    # Direct, redundant cell labels: S = sustainable; C = collapses.
    for i in range(len(deltas)):
        for j in range(len(pds)):
            text = "S" if grid_sustainable[i, j] else "C"
            color = AMBER if grid_sustainable[i, j] else TEAL
            ax.text(pds[j], deltas[i], text, ha="center", va="center",
                    fontsize=9.5, fontweight="bold", color=color)

    # Analytical boundary from the paper's stated payoff model.
    dense_delta = np.linspace(y_edges[0], y_edges[-1], 300)
    p_star = (pi_c - (1.0 - dense_delta) * pi_d) / (loss + dense_delta * pi_d)
    boundary_mask = (p_star > x_edges[0]) & (p_star < x_edges[-1])
    boundary_line, = ax.plot(
        p_star[boundary_mask], dense_delta[boundary_mask], color=EBONY,
        linewidth=2.0, linestyle="--", label=r"analytical $p_d^\star(\delta)$"
    )
    legend_elems = [
        Patch(facecolor="#E8D5AA", edgecolor=AMBER, label="S  sustainable"),
        Patch(facecolor="#DCE9E6", edgecolor=TEAL, label="C  collapses"),
    ]
    ax.legend(handles=[*legend_elems, boundary_line], loc="upper center",
              bbox_to_anchor=(0.5, -0.20), ncol=3, fontsize=8.2,
              frameon=False, handlelength=2.2, columnspacing=1.0)

    # Right: the same p_d scale, showing simulation means against the truncated
    # geometric expectation.  The band is a model-derived 95% interval for the
    # sample mean; the stored run artifact has no run-level dispersion.
    ax = axes[1]
    mean_lifespan = grid_lifespan.mean(axis=0)
    expected_lifespan = np.asarray([
        (1.0 - (1.0 - p) ** horizon) / p for p in pds
    ])
    second_moments = []
    for p in pds:
        q = 1.0 - p
        second_moments.append(sum((2 * k - 1) * q ** (k - 1)
                                  for k in range(1, horizon + 1)))
    variances = np.maximum(0.0, np.asarray(second_moments) - expected_lifespan ** 2)
    half_width = 1.96 * np.sqrt(variances / trials)
    ax.fill_between(pds, expected_lifespan - half_width,
                    expected_lifespan + half_width,
                    color=SAND_DEEP, alpha=0.42, linewidth=0,
                    label="model 95% interval for mean")
    ax.plot(pds, mean_lifespan, "o-", linewidth=2.4, markersize=6,
            color=TEAL, label="simulation mean")
    ax.plot(pds, expected_lifespan, "--", linewidth=1.8,
            color=EBONY, label=rf"$\mathrm{{E}}[\min(G,{horizon})]$")
    ax.axhline(10, color=EBONY, linewidth=0.8, linestyle=":",
               alpha=0.7, label="10-round target")
    ax.set_xscale("log")
    ax.set_xticks(display_pds)
    ax.set_xticklabels([f"{p:.2f}" for p in display_pds])
    ax.set_xlabel(r"per-round detection probability $p_d$")
    ax.set_ylabel("mean cartel lifespan (rounds)")
    ax.set_title("(b) rounds until detection")
    ax.legend(loc="upper right", fontsize=8.6, framealpha=0.95,
              facecolor=PAPER, edgecolor=SAND_DEEP)

    fig.text(
        0.5, 0.055,
        f"Assumptions: {trials:,} trials/configuration · {horizon}-round horizon · "
        f"grim trigger · cartel size {int(cartel_size)} · "
        rf"$\pi_C={pi_c:.2f}$, $\pi_D={pi_d:.2f}$, $L={loss:.0f}$.  "
        "The run log stores configuration means, not run-level dispersion.",
        ha="center", va="bottom", fontsize=8.8, color=GRAY,
    )

    # NB: no fig.suptitle — the LaTeX caption is the authoritative title.
    fig.savefig(out)
    plt.close(fig)
    print(f"wrote {out}")


def main() -> None:
    fig_pareto_dominance(HERE / "fig-pareto-dominance.pdf")
    fig_sybil_deposit_floor(HERE / "fig-sybil-deposit-floor.pdf")
    fig_cartel_folk(HERE / "fig-cartel-folk-theorem.pdf")


if __name__ == "__main__":
    main()
