#!/usr/bin/env python3
"""
B8 heavy tails -- what service-time variability does to the specialization boundary
====================================================================================
The sweep Chapter 4 asked for (book/legible-swarm.tex, "What heavy tails do to the
boundary"): matched-mean lognormal and Pareto service, with simulation uncertainty,
and the error of the chapter's approximate crossing.

MODEL. Unit of time: one mean pooled service (mu_pool = 1). Requests arrive
Poisson at rate lam = c*rho. Two ways to serve them:

  pool        c generalists, first come first served, service S with E[S] = 1;
  specialist  one server r times as fast, service S/r, same distribution shape.

Write kappa = (1 + scv)/2 for the service distribution's squared coefficient of
variation scv, and nu = c*rho. Mean time in system:

  specialist  W_spec(r) = 1/r + kappa*nu / (r*(r - nu))          exact (Pollaczek-Khinchine)
  pool        W_pool    = 1 + D,   D = mean wait in queue of M/G/c  no closed form

The chapter approximates D by scaling the exponential answer (Allen-Cunneen):

  D_ac = kappa * C(c, rho) / (c*(1 - rho)),   C = Erlang-C.

With no accountability premium (A = 0) the specialist wins when r exceeds the
crossing r*(D), the larger root of

  (1 + D) r^2 - ((1 + D) nu + 1) r + nu (1 - kappa) = 0.

WHAT IS MEASURED. D is simulated for each (c, rho, distribution). The quantities
reported are D_sim / D_ac, and the crossing error r*(D_sim) - r*(D_ac). Only the
pool needs simulating: the specialist's side is exact, so every error in the
crossing comes from D.

WHY IT MIGHT FAIL. Gupta, Harchol-Balter, Dai and Zwart (Queueing Systems 64(1),
2010) prove that no formula using only the first two moments of S can be
accurate for M/G/c across all distributions. Lognormal and bounded Pareto with
the same mean and scv are two such distributions, so they are the test.

DISTRIBUTIONS, all with mean 1.
  exponential     scv = 1. The control: D is known exactly (Erlang-C).
  lognormal       scv in {3, 6}.
  bounded Pareto  tail index alpha = 1.5 on [k, p], k and p chosen to give mean 1
                  and scv in {3, 6}. Bounded because a real turn has a timeout,
                  and because an unbounded Pareto with this alpha has no variance,
                  which makes the specialist's mean wait infinite (the chapter says so).

SIMULATION. Kiefer-Wolfowitz workload recursion for FCFS M/G/c: the vector of
remaining work at the c servers, sorted; an arrival waits for the smallest entry,
adds its service to it, and the vector then drains by the next interarrival time.
REPS independent replications run side by side as rows of one array. Each starts
empty; the first WARMUP fraction of jobs is discarded.

UNCERTAINTY. The replication means are independent and identically distributed,
and every service time is bounded or has all moments, so their mean has a finite
variance and a Student-t interval is justified. Reported: the mean over
replications and a 95% interval. Two controls check the meter itself:
  - exponential service against Erlang-C, for every (c, rho);
  - one server (c = 1) against Pollaczek-Khinchine, for every distribution.
A control fails if the exact value lies outside a 99.9% interval.

USAGE
  python3 b8_heavy_tails.py                 run the sweep, write b8_heavy_tails.results.json
  python3 b8_heavy_tails.py --pilot         one hard cell, to size the run
  python3 b8_heavy_tails.py --check         recompute everything derivable from the stored
                                            results without simulating, and compare the Book's
                                            figure, table and quoted numbers with them; exit 1
                                            on a mismatch
  python3 b8_heavy_tails.py --figure        rewrite the Book's figure and table from the
                                            stored results
  python3 b8_heavy_tails.py --smoke         a short live run of the meter against two exact
                                            answers (seconds; this is what CI runs, with --check)
Seed 20261111. numpy only.
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

SEED = 20261111
RESULTS = Path(__file__).with_name("b8_heavy_tails.results.json")
BOOK = Path(__file__).resolve().parents[3] / "book"
FIGURE = BOOK / "figures/legible-swarm-heavy-tails.tex"
TABLE = BOOK / "figures/legible-swarm-heavy-tails-crossing.tex"
CHAPTER = BOOK / "legible-swarm.tex"
SERVERS = (2, 4, 8)
LOADS = (0.3, 0.5, 0.7, 0.85)
SCVS = (3.0, 6.0)
ALPHA = 1.5
REPS = 32
JOBS = 4_000_000
WARMUP = 0.1
CHUNK = 20_000


# ---------------------------------------------------------------- exact formulas
def erlang_c(c, a):
    """P(wait) in M/M/c at offered load a = lam/mu, by the Erlang-B recursion."""
    b = 1.0
    for k in range(1, c + 1):
        b = a * b / (k + a * b)
    rho = a / c
    return b / (1 - rho * (1 - b))


def delay_exponential(c, rho):
    """Mean wait in queue of M/M/c, in mean service times."""
    return erlang_c(c, c * rho) / (c * (1 - rho))


def delay_allen_cunneen(c, rho, scv):
    return (1 + scv) / 2 * delay_exponential(c, rho)


def delay_pk(rho, scv):
    """Mean wait in queue of M/G/1 (Pollaczek-Khinchine), in mean service times."""
    return (1 + scv) / 2 * rho / (1 - rho)


def crossing(delay, c, rho, scv):
    """The skill advantage at which the specialist's mean time in system equals the pool's."""
    kappa, nu, w = (1 + scv) / 2, c * rho, 1 + delay
    b = w * nu + 1
    return (b + math.sqrt(b * b - 4 * w * nu * (1 - kappa))) / (2 * w)


def specialist_time(r, c, rho, scv):
    kappa, nu = (1 + scv) / 2, c * rho
    return 1 / r + kappa * nu / (r * (r - nu))


# ---------------------------------------------------------------- distributions
def bounded_pareto_params(scv, alpha=ALPHA):
    """(k, p) of the bounded Pareto on [k, p] with mean 1 and the given scv."""
    def second_over_first_squared(q):
        norm = 1 - q ** -alpha
        m1 = alpha / (alpha - 1) * (1 - q ** (1 - alpha)) / norm
        m2 = alpha / (2 - alpha) * (q ** (2 - alpha) - 1) / norm
        return m2 / (m1 * m1), m1
    lo, hi = 1.0 + 1e-9, 1e12
    for _ in range(200):
        mid = math.sqrt(lo * hi)
        if second_over_first_squared(mid)[0] < 1 + scv:
            lo = mid
        else:
            hi = mid
    q = math.sqrt(lo * hi)
    k = 1 / second_over_first_squared(q)[1]
    return k, k * q


def sampler(name, scv):
    """A function (rng, shape) -> service times with mean 1 and the given scv."""
    if name == "exponential":
        return lambda rng, shape: rng.exponential(1.0, shape)
    if name == "lognormal":
        s2 = math.log(1 + scv)
        return lambda rng, shape: rng.lognormal(-s2 / 2, math.sqrt(s2), shape)
    if name == "bounded-pareto":
        k, p = bounded_pareto_params(scv)
        tail = 1 - (k / p) ** ALPHA
        return lambda rng, shape: k / (1 - rng.random(shape) * tail) ** (1 / ALPHA)
    raise ValueError(name)


# ---------------------------------------------------------------- the meter
def simulate_delay(c, rho, draw, rng, reps=REPS, jobs=JOBS):
    """Mean wait in queue of FCFS M/G/c, one value per replication."""
    lam = c * rho
    work = np.zeros((reps, c))
    total = np.zeros(reps)
    skip = int(jobs * WARMUP)
    done = 0
    while done < jobs:
        n = min(CHUNK, jobs - done)
        service = draw(rng, (n, reps))
        gaps = rng.exponential(1 / lam, (n, reps))
        for i in range(n):
            if done + i >= skip:
                total += work[:, 0]
            work[:, 0] += service[i]
            work -= gaps[i][:, None]
            np.maximum(work, 0.0, out=work)
            if c > 1:
                work.sort(axis=1)
        done += n
    return total / (jobs - skip)


def interval(values, level=0.95):
    """Mean and Student-t half-width of independent replication means."""
    n = len(values)
    mean = float(np.mean(values))
    se = float(np.std(values, ddof=1)) / math.sqrt(n)
    return mean, T_QUANTILE[level] * se, se


# Student-t quantiles for 31 degrees of freedom (REPS = 32), two-sided.
T_QUANTILE = {0.95: 2.0395, 0.999: 3.6335}


def cell(c, rho, name, scv, rng, reps=REPS, jobs=JOBS):
    means = simulate_delay(c, rho, sampler(name, scv), rng, reps, jobs)
    mean, half, se = interval(means)
    return {"servers": c, "load": rho, "service": name, "scv": scv,
            "delay_sim": mean, "delay_half_width": half, "delay_se": se}


# ---------------------------------------------------------------- derived columns
def derive(row):
    """Everything computed from one simulated delay. --check recomputes exactly this."""
    c, rho, scv = row["servers"], row["load"], row["scv"]
    d, half = row["delay_sim"], row["delay_half_width"]
    out = {}
    if c == 1:
        exact = delay_pk(rho, scv)
        out["delay_exact"] = exact
        out["z"] = (d - exact) / row["delay_se"]
        return out
    ac = delay_allen_cunneen(c, rho, scv)
    out["delay_ac"] = ac
    out["ratio"] = d / ac
    out["ratio_low"], out["ratio_high"] = (d - half) / ac, (d + half) / ac
    out["crossing_ac"] = crossing(ac, c, rho, scv)
    out["crossing_sim"] = crossing(d, c, rho, scv)
    # r*(D) falls as D rises, so the interval's ends swap.
    out["crossing_low"], out["crossing_high"] = crossing(d + half, c, rho, scv), crossing(d - half, c, rho, scv)
    out["crossing_error"] = out["crossing_sim"] - out["crossing_ac"]
    if row["service"] == "exponential":
        out["z"] = (d - ac) / row["delay_se"]
    return out


def grid():
    for c in SERVERS:
        for rho in LOADS:
            yield c, rho, "exponential", 1.0
            for scv in SCVS:
                yield c, rho, "lognormal", scv
                yield c, rho, "bounded-pareto", scv
    for rho in LOADS:                      # the one-server control
        for scv in SCVS:
            yield 1, rho, "lognormal", scv
            yield 1, rho, "bounded-pareto", scv


def run(out_path):
    cells = list(grid())
    seeds = np.random.SeedSequence(SEED).spawn(len(cells))
    rows, started = [], time.time()
    for index, ((c, rho, name, scv), seed) in enumerate(zip(cells, seeds)):
        row = cell(c, rho, name, scv, np.random.default_rng(seed))
        row.update(derive(row))
        rows.append(row)
        print(f"[{index + 1:2d}/{len(cells)}] c={c} rho={rho:<4} {name:<14} scv={scv:<3}"
              f" D={row['delay_sim']:.4f} +-{row['delay_half_width']:.4f}"
              f" ({time.time() - started:5.0f}s)", flush=True)
    result = {"seed": SEED, "reps": REPS, "jobs": JOBS, "warmup": WARMUP, "alpha": ALPHA,
              "bounded_pareto": {str(scv): bounded_pareto_params(scv) for scv in SCVS}, "rows": rows}
    out_path.write_text(json.dumps(result, indent=1) + "\n")
    return result


# ---------------------------------------------------------------- report and checks
FAILED = 0


def check(name, ok, detail=""):
    global FAILED
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  {detail}" if detail else ""))
    if not ok:
        FAILED += 1


def report(result):
    rows = result["rows"]
    print("\n=== the meter, checked against exact answers ===")
    limit = T_QUANTILE[0.999]
    exp_rows = [r for r in rows if r["service"] == "exponential"]
    one_rows = [r for r in rows if r["servers"] == 1]
    worst = max(exp_rows, key=lambda r: abs(r["z"]))
    check(f"exponential service matches Erlang-C in all {len(exp_rows)} cells",
          all(abs(r["z"]) < limit for r in exp_rows),
          f"largest |z| = {abs(worst['z']):.2f} at c={worst['servers']}, rho={worst['load']}")
    worst = max(one_rows, key=lambda r: abs(r["z"]))
    check(f"one server matches Pollaczek-Khinchine in all {len(one_rows)} cells",
          all(abs(r["z"]) < limit for r in one_rows),
          f"largest |z| = {abs(worst['z']):.2f} at rho={worst['load']}, {worst['service']} scv={worst['scv']}")
    heavy = [r for r in rows if r["servers"] > 1 and r["service"] != "exponential"]
    widest = max(heavy, key=lambda r: r["delay_half_width"] / r["delay_sim"])
    check("every simulated delay is known to within 5% (95% interval)",
          all(r["delay_half_width"] / r["delay_sim"] < 0.05 for r in heavy),
          f"widest: {100 * widest['delay_half_width'] / widest['delay_sim']:.1f}% at c={widest['servers']},"
          f" rho={widest['load']}, {widest['service']} scv={widest['scv']}")

    print("\n=== simulated delay / Allen-Cunneen delay (95% interval) ===")
    for scv in SCVS:
        for name in ("lognormal", "bounded-pareto"):
            print(f"  {name}, scv = {scv:g}")
            print("    rho    " + "".join(f"c = {c:<19d}" for c in SERVERS))
            for rho in LOADS:
                line = f"    {rho:<6}"
                for c in SERVERS:
                    r = next(x for x in heavy if (x["servers"], x["load"], x["service"], x["scv"]) == (c, rho, name, scv))
                    line += f" {r['ratio']:.3f} [{r['ratio_low']:.3f}, {r['ratio_high']:.3f}]  "
                print(line)

    print("\n=== crossing r*: approximate, simulated, error ===")
    for r in heavy:
        print(f"  c={r['servers']} rho={r['load']:<4} {r['service']:<14} scv={r['scv']:g}"
              f"  approx {r['crossing_ac']:.3f}  simulated {r['crossing_sim']:.3f}"
              f" [{r['crossing_low']:.3f}, {r['crossing_high']:.3f}]  error {r['crossing_error']:+.3f}")

    errors = [abs(r["crossing_error"]) for r in heavy]
    ratios = [r["ratio"] for r in heavy]
    sig = [r for r in heavy if not (r["ratio_low"] <= 1 <= r["ratio_high"])]
    print("\n=== summary ===")
    print(f"  cells with heavy-tailed service: {len(heavy)}")
    print(f"  delay ratio sim/approx: min {min(ratios):.3f}, max {max(ratios):.3f}")
    print(f"  cells where the interval excludes 1: {len(sig)}")
    print(f"  crossing error |r*_sim - r*_ac|: median {sorted(errors)[len(errors) // 2]:.3f}, max {max(errors):.3f}")
    same = {}
    for r in heavy:
        same.setdefault((r["servers"], r["load"], r["scv"]), {})[r["service"]] = r
    gaps = [(abs(v["lognormal"]["delay_sim"] - v["bounded-pareto"]["delay_sim"]) / v["lognormal"]["delay_sim"], k)
            for k, v in same.items()]
    gap, key = max(gaps)
    print(f"  two distributions, same mean and scv: delays differ by up to {100 * gap:.0f}%"
          f" (c={key[0]}, rho={key[1]}, scv={key[2]:g})")


def recheck(result):
    """Recompute every derived column from the stored simulated delays."""
    print("=== --check: derived columns recomputed from the stored delays ===")
    bad = 0
    for row in result["rows"]:
        for key, value in derive(row).items():
            if not math.isclose(row[key], value, rel_tol=1e-12, abs_tol=1e-12):
                bad += 1
    check("every derived column reproduces", bad == 0, f"{bad} mismatches")
    for scv, (k, p) in result["bounded_pareto"].items():
        kk, pp = bounded_pareto_params(float(scv))
        check(f"bounded Pareto parameters for scv={scv}", math.isclose(k, kk) and math.isclose(p, pp), f"k={kk:.4f}, p={pp:.1f}")
    # The chapter's worked numbers, as a regression on the formulas.
    check("exponential crossing at c=2, rho=1/2 is 1.75", math.isclose(crossing(delay_exponential(2, 0.5), 2, 0.5, 1.0), 1.75))
    check("Allen-Cunneen crossing at c=2, rho=1/2, scv=3 is (8+sqrt(124))/10",
          math.isclose(crossing(delay_allen_cunneen(2, 0.5, 3.0), 2, 0.5, 3.0), (8 + math.sqrt(124)) / 10))
    check("the crossing solves W_spec(r) = 1 + D",
          all(math.isclose(specialist_time(crossing(d, c, rho, scv), c, rho, scv), 1 + d)
              for c in SERVERS for rho in LOADS for scv in (1.0, 3.0, 6.0) for d in (0.01, 0.5, 4.0)))


# ---------------------------------------------------------------- the Book's figure
PLOT_SCV = 6.0
PLOT_HEIGHT_PT = 4.6 / 2.54 * 72.27          # the axis height below, in points
PLOT_SPAN = 1.05 - 0.2                       # ymax - ymin
MARK_DIAMETER_PT = 4.0                       # mark size=2pt


LABEL_GAP = 0.085                            # least distance between two line labels, in ratio units


def spread(positions, gap):
    """Move labels apart, as little as possible, until neighbours are at least `gap` apart."""
    keys = sorted(positions, key=positions.get)
    y = [positions[k] for k in keys]
    for _ in range(100):
        moved = False
        for i in range(len(y) - 1):
            short = gap - (y[i + 1] - y[i])
            if short > 1e-9:
                y[i] -= short / 2
                y[i + 1] += short / 2
                moved = True
        if not moved:
            break
    return dict(zip(keys, y))


def figure_tex(result):
    """The figure, with every coordinate taken from the stored results."""
    rows = {(r["servers"], r["load"], r["service"]): r for r in result["rows"]
            if r["scv"] == PLOT_SCV and r["servers"] > 1}
    # The smallest pool is the quiet line; it keeps whatever marker the edition gives `pd series`.
    styles = {2: "pd series,draw=pdinkmuted!70,mark options={fill=pdinkmuted!70,draw=pdpage,line width=.5pt,solid}",
              4: "pd series", 8: "pd focus series"}
    voices = {2: "pd label,text=pdinkmuted", 4: "pd label", 8: "pd focus label"}

    def panel(name, title, at, ylabel):
        lines = [f"  \\begin{{axis}}[pd axis,at={{{at}}},width=3.85cm,height=4.6cm,",
                 "    xmin=0.25,xmax=0.9,ymin=0.2,ymax=1.05,",
                 "    xtick={0.3,0.5,0.7,0.85},xticklabels={.3,.5,.7,.85},",
                 "    ytick={0.2,0.4,0.6,0.8,1.0}," + ("" if ylabel else "yticklabels={},"),
                 f"    title={{{title}}},xlabel={{pooled utilization $\\rho$}},"
                 + ("ylabel={simulated delay $\\div$ approximate delay}," if ylabel else ""),
                 "    every axis plot/.append style={mark size=2pt}]",
                 "    \\draw[pd guide] (axis cs:0.25,1) -- (axis cs:0.86,1);"]   # stops short of the line labels
        ends = spread({c: rows[(c, LOADS[-1], name)]["ratio"] for c in SERVERS}, LABEL_GAP)
        for c in SERVERS:
            points = " ".join(f"({rho:g},{rows[(c, rho, name)]['ratio']:.3f})" for rho in LOADS)
            lines.append(f"    \\addplot[{styles[c]}] coordinates {{{points}}};")
            lines.append(f"    \\node[{voices[c]},anchor=west] at (axis cs:0.87,{ends[c]:.3f}) {{$c={c}$}};")
        if not ylabel:                     # the right panel has the room under its line
            lines.append("    \\node[pd note,anchor=north west] at (axis cs:0.26,0.99) {the formula is exact};")
        lines.append("  \\end{axis}")
        return lines

    body = [
        "% GENERATED by skills/harbor-results/scripts/b8_heavy_tails.py --figure from",
        "% b8_heavy_tails.results.json. Do not edit by hand.",
        "%",
        "% Reader question: how wrong is the two-moment formula for the pool's delay",
        "% when service times are heavy-tailed, and in which direction?",
        "% Claim: it overstates the delay in every cell, most where the pool has",
        "% servers to spare, and the error closes as load rises.",
        "% Evidence: simulated M/G/c delay over the Allen--Cunneen delay at",
        f"% c_s^2 = {PLOT_SCV:g}, 32 runs of {result['jobs'] // 1_000_000} million jobs per point",
        "% [internal, b8_heavy_tails.py].",
        "% Must distinguish: the two distributions, which share a mean and a",
        "% variance and still disagree; and the three pool sizes within each.",
        "% Grammar chosen: two small panels on one vertical scale, one line per pool",
        "% size, named at its end, under a dotted line at 1 where the formula would",
        "% be exact.",
        "% Grammar rejected: one panel with six lines, which hides that the panels",
        "% differ only in the shape of the distribution.",
        "% Five-second test: are all the points below the dotted line?",
        "\\begin{figure}[H]",
        "\\centering",
        "\\pdfigurehue{pdteal}%",
        "\\begin{tikzpicture}[pd figure]",
        *panel("lognormal", "lognormal service", "(0,0)", True),
        *panel("bounded-pareto", "bounded Pareto service", "(5.1cm,0)", False),
        "\\end{tikzpicture}",
        "\\caption{\\textbf{The two-moment formula overstates the pool's delay, most where the",
        "pool has servers to spare.} Simulated mean wait in queue over the",
        f"Allen--Cunneen value, at a squared coefficient of variation of {PLOT_SCV:g}.",
        f"Each point is 32 runs of {result['jobs'] // 1_000_000} million jobs, and its 95\\% interval is no",
        "taller than its marker. [internal, \\texttt{b8\\_heavy\\_tails.py}]}",
        "\\label{fig:spec-heavy-tails}",
        "\\end{figure}",
        "",
    ]
    return "\n".join(body)


TABLE_LOADS = (0.5, 0.7)


def table_tex(result):
    """The crossing table, with every number taken from the stored results."""
    rows = {(r["servers"], r["load"], r["service"]): r for r in result["rows"]
            if r["scv"] == PLOT_SCV and r["servers"] > 1}
    widest = max(r["crossing_high"] - r["crossing_low"] for r in rows.values()) / 2
    body = [
        "% GENERATED by skills/harbor-results/scripts/b8_heavy_tails.py --figure from",
        "% b8_heavy_tails.results.json. Do not edit by hand.",
        r"\begin{table}[H]",
        r"\centering",
        r"\small",
        r"\renewcommand{\arraystretch}{1.2}",
        r"\begin{tabular}{@{}cc@{\hspace{2em}}c@{\hspace{2em}}c@{\hspace{2em}}cc@{}}",
        r"\toprule",
        r" & & & & \multicolumn{2}{c}{\textbf{simulated}} \\",
        r"\cmidrule(l){5-6}",
        r"$c$ & $\rho$ & \textbf{exponential} & \textbf{formula} & \textbf{lognormal} & \textbf{bounded Pareto} \\",
        r"\midrule",
    ]
    for c in SERVERS:
        for rho in TABLE_LOADS:
            ln, bp = rows[(c, rho, "lognormal")], rows[(c, rho, "bounded-pareto")]
            exact = crossing(delay_exponential(c, rho), c, rho, 1.0)
            body.append(f"{c} & {rho:g} & {exact:.3f} & {ln['crossing_ac']:.3f} & {ln['crossing_sim']:.3f}"
                        rf" & {bp['crossing_sim']:.3f} \\")
    body += [
        r"\bottomrule",
        r"\end{tabular}",
        r"\caption{\textbf{The speed a specialist needs to match the pool, in multiples of one",
        r"generalist's speed, at $A=0$.} The exponential column is exact. The",
        rf"others are at a squared coefficient of variation of {PLOT_SCV:g}, and the simulated",
        rf"ones are known to within $\pm{widest:.3f}$ (95\% interval).",
        r"[internal, \texttt{b8\_heavy\_tails.py}]}",
        r"\label{tab:spec-heavy-tails}",
        r"\end{table}",
        "",
    ]
    return "\n".join(body)


def quoted(result):
    """Every number the chapter's prose quotes from this sweep, as the chapter prints it."""
    rows = result["rows"]
    heavy = [r for r in rows if r["servers"] > 1 and r["service"] != "exponential"]
    controls = [r for r in rows if "z" in r]
    by = {(r["servers"], r["load"], r["service"], r["scv"]): r for r in rows}
    worked = [by[(2, 0.5, name, 3.0)] for name in ("lognormal", "bounded-pareto")]
    exact = crossing(delay_exponential(2, 0.5), 2, 0.5, 1.0)
    gap = max(1 - by[(c, rho, "bounded-pareto", scv)]["delay_sim"] / by[(c, rho, "lognormal", scv)]["delay_sim"]
              for c in SERVERS for rho in LOADS for scv in SCVS)
    errors = sorted(r["crossing_error"] for r in heavy)
    relative = max(r["crossing_error"] / r["crossing_ac"] for r in heavy)
    return {
        "heavy-tailed cells": f"all {len(heavy)} heavy-tailed cells",
        "control cells": f"all {len(controls)} such cells",
        "largest control gap": f"{max(abs(r['z']) for r in controls):.2f} standard errors",
        "widest delay interval": rf"{100 * max(r['delay_half_width'] / r['delay_sim'] for r in heavy):.1f}\%",
        "smallest ratio": f"from {min(r['ratio'] for r in heavy):.2f}",
        "largest ratio": f"to {max(r['ratio'] for r in heavy):.2f}",
        "gap between the two shapes": rf"{100 * gap:.0f}\%",
        "worked example, formula": f"{worked[0]['crossing_ac']:.3f}",
        "worked example, lognormal": f"{worked[0]['crossing_sim']:.3f}",
        "worked example, bounded Pareto": f"{worked[1]['crossing_sim']:.3f}",
        "worked example, predicted shift": f"predicted {worked[0]['crossing_ac'] - exact:.2f}",
        "worked example, true shift": f"by {worked[0]['crossing_sim'] - exact:.2f} to {worked[1]['crossing_sim'] - exact:.2f}",
        "median crossing error": f"median {(errors[len(errors) // 2 - 1] + errors[len(errors) // 2]) / 2:.2f}",
        "largest crossing error": f"at most {errors[-1]:.2f}",
        "largest relative crossing error": rf"{100 * relative:.1f}\%",
    }


def section_text():
    text = CHAPTER.read_text()
    start = text.index(r"\label{sec:spec-heavy-tails}")
    return " ".join(text[start:text.index(r"\subsection{", start)].split())


def figure_check(result):
    plotted = [r for r in result["rows"] if r["scv"] == PLOT_SCV and r["servers"] > 1 and r["service"] != "exponential"]
    tallest = max((r["ratio_high"] - r["ratio_low"]) / PLOT_SPAN * PLOT_HEIGHT_PT for r in plotted)
    check("every plotted interval is no taller than its marker", tallest <= MARK_DIAMETER_PT,
          f"tallest {tallest:.1f}pt, marker {MARK_DIAMETER_PT:g}pt")
    check("the formula overstates the delay in every heavy-tailed cell",
          all(r["ratio_high"] < 1 for r in plotted_all(result)))
    for path, wanted in ((FIGURE, figure_tex(result)), (TABLE, table_tex(result))):
        current = path.read_text() if path.exists() else ""
        check(f"{path.name} matches the stored results", current == wanted,
              "" if current == wanted else "run with --figure to rewrite it")
    check("no crossing is lower than the formula's", all(r["crossing_low"] > r["crossing_ac"] for r in plotted_all(result)))
    section = section_text()
    for name, text in quoted(result).items():
        check(f"the chapter quotes: {name}", text in section, text)


def plotted_all(result):
    return [r for r in result["rows"] if r["servers"] > 1 and r["service"] != "exponential"]


def smoke():
    """A short live run: the meter against Erlang-C and against Pollaczek-Khinchine."""
    print("=== smoke: a short live run of the meter ===")
    for index, (c, rho, name, scv) in enumerate([(2, 0.5, "exponential", 1.0), (1, 0.5, "lognormal", 3.0)]):
        row = cell(c, rho, name, scv, np.random.default_rng([SEED, 99, index]), jobs=200_000)
        exact = delay_exponential(c, rho) if c > 1 else delay_pk(rho, scv)
        z = (row["delay_sim"] - exact) / row["delay_se"]
        check(f"c={c}, rho={rho}, {name}: exact value inside the 99.9% interval", abs(z) < T_QUANTILE[0.999],
              f"simulated {row['delay_sim']:.4f}, exact {exact:.4f}, {abs(z):.2f} standard errors")


def moments_check():
    print("=== distributions: sampled moments against the targets ===")
    rng = np.random.default_rng([SEED, 7])
    for name in ("lognormal", "bounded-pareto"):
        for scv in SCVS:
            x = sampler(name, scv)(rng, 4_000_000)
            # scv converges slowly under a heavy tail; the mean is the tight check.
            check(f"{name} scv={scv:g}: mean 1", abs(x.mean() - 1) < 0.01, f"mean {x.mean():.4f}, scv {x.var() / x.mean() ** 2:.2f}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pilot", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--figure", action="store_true")
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--out", type=Path, default=RESULTS)
    args = parser.parse_args()
    if args.pilot:
        started = time.time()
        for c, rho, name, scv in [(2, 0.85, "bounded-pareto", 6.0), (8, 0.85, "bounded-pareto", 6.0), (2, 0.5, "exponential", 1.0)]:
            row = cell(c, rho, name, scv, np.random.default_rng([SEED, c]))
            row.update(derive(row))
            print(f"c={c} rho={rho} {name} scv={scv}: D={row['delay_sim']:.4f} +-{row['delay_half_width']:.4f}"
                  f" ({100 * row['delay_half_width'] / row['delay_sim']:.1f}%), ratio {row['ratio']:.3f}, {time.time() - started:.0f}s")
        return 0
    if args.smoke:
        smoke()
        print(f"\n{'ALL CHECKS PASS' if FAILED == 0 else f'{FAILED} CHECK(S) FAILED'}")
        return 1 if FAILED else 0
    if args.figure:
        result = json.loads(args.out.read_text())
        for path, text in ((FIGURE, figure_tex(result)), (TABLE, table_tex(result))):
            path.write_text(text)
            print(f"wrote {path}")
        return 0
    if args.check:
        result = json.loads(args.out.read_text())
        recheck(result)
        figure_check(result)
    else:
        moments_check()
        result = run(args.out)
        recheck(result)
    report(result)
    print(f"\n{'ALL CHECKS PASS' if FAILED == 0 else f'{FAILED} CHECK(S) FAILED'}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
