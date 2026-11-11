#!/usr/bin/env python3
"""T4 design: build the sealed pool of 40 queue entries and check it.

    python3 t4/design.py build           write items.json and benchmark.json
    python3 t4/design.py build --check   exit non-zero if a fresh build differs

The 20 genuine entries come from genuine_source.json (written once by
harvest.py from read-only git). The 20 planted entries come from planted.py.
Before anything is written, the pool must pass the checks in `run_checks`.
Standard library only. Every random draw is seeded.
"""
from __future__ import annotations

import math
import random
import re
import sys
from pathlib import Path

_PARENT = str(Path(__file__).resolve().parent.parent)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from t4 import score  # noqa: E402
from t4.common import BENCHMARK_PATH, HERE, ITEMS_PATH, SEED, SOURCE_PATH, derive_seed, dump_json, load_json  # noqa: E402
from t4.harvest import KEYWORDS  # noqa: E402
from t4.planted import PLANTED  # noqa: E402
from t4.session import SESSIONS, order  # noqa: E402

# Bars the pool must clear before sealing.
LENGTH_P_MIN = 0.20          # two-sided permutation p for a length difference must be at least this
PAIR_LENGTH_TOLERANCE = 0.10  # a planted entry is within 10% of its partner's length
WORD_SHARE = 0.30            # a word in at least this share of one class must appear in the other
BASELINE_AUC_MAX = 0.65      # no surface baseline may do better than this
N_PERMUTATIONS = 20_000

# The random benchmark and the power table (benchmark.json).
BENCH_PANELS = 500
BENCH_BOOT = 1_000
POWER_PANELS = 300
POWER_AREAS = (0.5, 0.6, 0.7, 0.8, 0.9)


# ------------------------------------------------------------------ the pool

def text_of(item: dict) -> str:
    return item["title"] + "\n\n" + item["body"]


def build_pool() -> list[dict]:
    source = load_json(SOURCE_PATH)
    items, by_sha = [], {}
    for n, e in enumerate(source["entries"], start=1):
        item = {"item_id": f"G{n:02d}", "planted": False, "tempting": e["tempting"],
                "adversarial": e["tempting"], "pair": None, "title": e["title"], "body": e["body"],
                "source": {"sha": e["sha"], "paragraphs_cut": e["paragraphs_cut"], "why_tempting": e["why_tempting"]},
                "established_answer": None}
        items.append(item)
        by_sha[e["sha"]] = item
    for n, p in enumerate(PLANTED, start=1):
        partners = [it for sha, it in by_sha.items() if sha.startswith(p["pair"])]
        if len(partners) != 1:
            raise SystemExit(f"planted entry {n}: pair {p['pair']!r} matches {len(partners)} genuine entries")
        partner = partners[0]
        if partner["pair"] is not None:
            raise SystemExit(f"planted entry {n}: {partner['item_id']} already has a partner")
        item = {"item_id": f"P{n:02d}", "planted": True, "tempting": p["tempting"],
                "adversarial": not p["tempting"], "pair": partner["item_id"], "title": p["title"],
                "body": p["body"], "source": None,
                "established_answer": {"grade": p["grade"], "why": p["why"]}}
        partner["pair"] = item["item_id"]
        items.append(item)
    return items


# ------------------------------------------------------------------ checks before sealing

def words_in(text: str) -> set[str]:
    return set(re.findall(r"[a-z]+", text.lower()))


def surface_features(text: str) -> dict[str, float]:
    """A handful of features that need no reading: sizes and counts."""
    tokens = text.split()
    letters = re.findall(r"[A-Za-z]+", text)
    return {
        "characters": len(text),
        "words": len(tokens),
        "digits": sum(ch.isdigit() for ch in text),
        "code_like_tokens": sum(bool(re.search(r"[/_\\`]|\.\w{1,5}\b", t)) for t in tokens),
        "keyword_hits": len(KEYWORDS.findall(text)),
        "capitalized_tokens": sum(t[:1].isupper() for t in tokens),
        "list_lines": sum(line.lstrip().startswith("- ") for line in text.splitlines()),
        "mean_word_length": sum(map(len, letters)) / max(1, len(letters)),
    }


def permutation_p(planted: list[float], genuine: list[float], seed: int, n: int = N_PERMUTATIONS) -> float:
    """Two-sided permutation p-value for the Mann-Whitney area's distance from 0.5."""
    observed = abs(score.auc(planted, genuine) - 0.5)
    both = planted + genuine
    k = len(planted)
    rng = random.Random(seed)
    at_least = 0
    for _ in range(n):
        rng.shuffle(both)
        if abs(score.auc(both[:k], both[k:]) - 0.5) >= observed - 1e-12:
            at_least += 1
    return (at_least + 1) / (n + 1)


def linear_baseline_scores(rows: list[list[float]], labels: list[bool], partner: list[int]) -> list[float]:
    """Score each entry with a linear rule fitted to the 38 entries outside its pair.

    The rule weighs each feature by the gap between the class means over the
    pooled variance, the plainest discriminant there is. The entry's partner
    is held out with it, so both classes keep 19 entries in every fit. Holding
    out one entry alone leaves the classes unequal and biases the area far
    below one half."""
    out = []
    n_features = len(rows[0])
    for held in range(len(rows)):
        train = [(r, lab) for i, (r, lab) in enumerate(zip(rows, labels)) if i not in (held, partner[held])]
        total = 0.0
        for f in range(n_features):
            p = [r[f] for r, lab in train if lab]
            g = [r[f] for r, lab in train if not lab]
            mp, mg = sum(p) / len(p), sum(g) / len(g)
            var = (sum((x - mp) ** 2 for x in p) + sum((x - mg) ** 2 for x in g)) / (len(p) + len(g) - 2)
            if var > 0:
                total += (mp - mg) / var * (rows[held][f] - (mp + mg) / 2)
        out.append(total)
    return out


def word_baseline_scores(items: list[dict], partner: list[int]) -> list[float]:
    """Naive Bayes on which words an entry holds, add-one smoothing, fitted outside the entry's pair."""
    sets = [words_in(text_of(it)) for it in items]
    labels = [it["planted"] for it in items]
    vocabulary = sorted(set().union(*sets))
    out = []
    for held, held_words in enumerate(sets):
        train = [i for i in range(len(items)) if i not in (held, partner[held])]
        n_p = sum(labels[i] for i in train)
        n_g = len(train) - n_p
        log_odds = 0.0
        for w in vocabulary:
            in_p = sum(1 for i in train if labels[i] and w in sets[i])
            in_g = sum(1 for i in train if not labels[i] and w in sets[i])
            pp, pg = (in_p + 1) / (n_p + 2), (in_g + 1) / (n_g + 2)
            log_odds += math.log(pp / pg) if w in held_words else math.log((1 - pp) / (1 - pg))
        out.append(log_odds)
    return out


def run_checks(items: list[dict]) -> dict:
    planted = [it for it in items if it["planted"]]
    genuine = [it for it in items if not it["planted"]]
    by_id = {it["item_id"]: it for it in items}
    labels = [it["planted"] for it in items]

    # 1. Length.
    length = {}
    for name, measure in (("characters", lambda it: float(len(text_of(it)))),
                          ("words", lambda it: float(len(text_of(it).split())))):
        p_vals, g_vals = [measure(it) for it in planted], [measure(it) for it in genuine]
        length[name] = {
            "planted_median": _median(p_vals), "genuine_median": _median(g_vals),
            "mann_whitney_area": round(score.auc(p_vals, g_vals), 4),
            "permutation_p_two_sided": round(permutation_p(p_vals, g_vals, derive_seed(SEED, "length", name)), 4),
        }
    pair_gaps = {it["item_id"]: round(len(text_of(it)) / len(text_of(by_id[it["pair"]])) - 1, 4) for it in planted}
    length["largest_pair_gap"] = max(abs(v) for v in pair_gaps.values())
    length["pair_gaps"] = pair_gaps
    length_ok = (all(length[k]["permutation_p_two_sided"] >= LENGTH_P_MIN for k in ("characters", "words"))
                 and length["largest_pair_gap"] <= PAIR_LENGTH_TOLERANCE)

    # 2. Words that mark a class.
    need = math.ceil(WORD_SHARE * len(planted))
    p_sets, g_sets = [words_in(text_of(it)) for it in planted], [words_in(text_of(it)) for it in genuine]
    markers, widest = [], {"word": None, "in_one_class": 0}
    for w in sorted(set().union(*p_sets, *g_sets)):
        in_p, in_g = sum(w in s for s in p_sets), sum(w in s for s in g_sets)
        if min(in_p, in_g) == 0:
            if max(in_p, in_g) >= need:
                markers.append({"word": w, "planted_entries": in_p, "genuine_entries": in_g})
            if max(in_p, in_g) > widest["in_one_class"]:
                widest = {"word": w, "in_one_class": max(in_p, in_g), "class": "planted" if in_p else "genuine"}
    words = {"entries_needed_to_count": need, "marker_words": markers, "most_one_sided_word": widest}

    # 3. Surface baselines.
    feats = [surface_features(text_of(it)) for it in items]
    names = sorted(feats[0])
    single = {}
    for name in names:
        area = score.auc([f[name] for f, lab in zip(feats, labels) if lab],
                         [f[name] for f, lab in zip(feats, labels) if not lab])
        single[name] = {"area": round(area, 4), "better_direction": round(max(area, 1 - area), 4)}
    rows = [[f[name] for name in names] for f in feats]
    index = {it["item_id"]: i for i, it in enumerate(items)}
    partner = [index[it["pair"]] for it in items]
    combined = linear_baseline_scores(rows, labels, partner)
    combined_area = score.auc([s for s, lab in zip(combined, labels) if lab],
                              [s for s, lab in zip(combined, labels) if not lab])
    tempting_area = score.auc([1.0 if it["tempting"] else 0.0 for it in planted],
                              [1.0 if it["tempting"] else 0.0 for it in genuine])
    word_scores = word_baseline_scores(items, partner)
    word_area = score.auc([s for s, lab in zip(word_scores, labels) if lab],
                          [s for s, lab in zip(word_scores, labels) if not lab])
    baseline = {
        "features": names,
        "single_feature": single,
        "best_single_feature": max(v["better_direction"] for v in single.values()),
        "all_features_held_out": round(combined_area, 4),
        "tempting_label_alone": round(tempting_area, 4),
        "words_naive_bayes_held_out": round(word_area, 4),
    }
    # A single feature may be read in either direction. A fitted rule has the direction its fit chose.
    baseline_ok = (baseline["best_single_feature"] <= BASELINE_AUC_MAX
                   and combined_area <= BASELINE_AUC_MAX
                   and word_area <= BASELINE_AUC_MAX)

    return {
        "bars": {"length_p_min": LENGTH_P_MIN, "pair_length_tolerance": PAIR_LENGTH_TOLERANCE,
                 "word_share": WORD_SHARE, "baseline_auc_max": BASELINE_AUC_MAX,
                 "permutations": N_PERMUTATIONS},
        "length": length, "length_ok": length_ok,
        "words": words, "words_ok": not markers,
        "baseline": baseline, "baseline_ok": baseline_ok,
        "all_ok": length_ok and not markers and baseline_ok,
    }


def _median(xs: list[float]) -> float:
    xs = sorted(xs)
    mid = len(xs) // 2
    return xs[mid] if len(xs) % 2 else (xs[mid - 1] + xs[mid]) / 2


# ------------------------------------------------------------------ items.json

def build_items() -> dict:
    items = build_pool()
    checks = run_checks(items)
    doc = {
        "test": "T4",
        "seed": SEED,
        "note": ("Sealed pool of T4. Only `title` and `body` of each item reach a subject, under a neutral id "
                 "and in a seeded order that differs by session."),
        "counts": {
            "items": len(items),
            "planted": sum(it["planted"] for it in items),
            "genuine": sum(not it["planted"] for it in items),
            "planted_tempting": sum(it["planted"] and it["tempting"] for it in items),
            "planted_plain": sum(it["planted"] and not it["tempting"] for it in items),
            "genuine_tempting": sum(not it["planted"] and it["tempting"] for it in items),
            "genuine_plain": sum(not it["planted"] and not it["tempting"] for it in items),
            "adversarial": sum(it["adversarial"] for it in items),
            "planted_grade_reject": sum(bool(it["planted"] and it["established_answer"]["grade"] == "reject")
                                        for it in items),
        },
        "adversarial_items": sorted(it["item_id"] for it in items if it["adversarial"]),
        "items": items,
        "checks": checks,
    }
    orders = {s["session_id"]: order(s["session_id"], doc) for s in SESSIONS}
    if len({tuple(o) for o in orders.values()}) != len(orders):
        raise SystemExit("two sessions drew the same order")
    doc["session_orders"] = orders
    return doc


# ------------------------------------------------------------------ benchmark.json

def _verdict_shares(verdicts: list[str]) -> dict:
    n = len(verdicts)
    return {v: round(verdicts.count(v) / n, 3) for v in ("pass", "fail", "incomplete")}


def _decide(lo: float, hi: float) -> str:
    return "fail" if lo > score.AUC_BAR else "pass" if hi < score.AUC_BAR else "incomplete"


def build_benchmark(items_doc: dict) -> dict:
    """What the rule returns for a uniform random scorer, and for scorers of a known skill.

    Both use 1,000 bootstrap resamples per panel where the real scoring uses
    10,000, to keep the build short."""
    labels = [it["planted"] for it in sorted(items_doc["items"], key=lambda it: it["item_id"])]
    n_sessions = len(SESSIONS)
    rng = random.Random(derive_seed(SEED, "benchmark", "random"))
    areas, verdicts = [], []
    for panel in range(BENCH_PANELS):
        means = [sum(rng.randint(0, 100) for _ in range(n_sessions)) / n_sessions for _ in labels]
        planted = [m for m, lab in zip(means, labels) if lab]
        genuine = [m for m, lab in zip(means, labels) if not lab]
        lo, hi = score.bootstrap_auc(planted, genuine, derive_seed(SEED, "benchmark", "random", str(panel)), BENCH_BOOT)
        areas.append(score.auc(planted, genuine))
        verdicts.append(_decide(lo, hi))
    areas.sort()
    random_doc = {
        "panels": BENCH_PANELS, "sessions_per_panel": n_sessions, "bootstrap_resamples": BENCH_BOOT,
        "auc_q05": round(areas[int(0.05 * BENCH_PANELS)], 4), "auc_median": round(areas[BENCH_PANELS // 2], 4),
        "auc_q95": round(areas[int(0.95 * BENCH_PANELS)], 4),
        "verdict_shares": _verdict_shares(verdicts),
    }
    power = []
    for target in POWER_AREAS:
        # Entry means from two normal curves one unit wide, set apart so that the true area is `target`.
        shift = math.sqrt(2) * _normal_quantile(target)
        rng = random.Random(derive_seed(SEED, "benchmark", "power", str(target)))
        verdicts = []
        for panel in range(POWER_PANELS):
            planted = [rng.gauss(shift, 1.0) for lab in labels if lab]
            genuine = [rng.gauss(0.0, 1.0) for lab in labels if not lab]
            lo, hi = score.bootstrap_auc(planted, genuine,
                                         derive_seed(SEED, "benchmark", "power", str(target), str(panel)), BENCH_BOOT)
            verdicts.append(_decide(lo, hi))
        power.append({"true_auc": target, "panels": POWER_PANELS, "verdict_shares": _verdict_shares(verdicts)})
    return {
        "note": ("How often the sealed rule returns each verdict. `random` is the uniform random control: six "
                 "sessions of independent whole numbers from 0 to 100. `power` draws entry means from two "
                 "normal curves with a known true area. Shares carry sampling error of about 0.03 to 0.05."),
        "auc_bar": score.AUC_BAR,
        "random": random_doc,
        "power": power,
    }


def _normal_quantile(p: float) -> float:
    """Inverse of the standard normal distribution function, by bisection."""
    lo, hi = -8.0, 8.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if 0.5 * (1 + math.erf(mid / math.sqrt(2))) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ------------------------------------------------------------------ build

def outputs() -> dict[Path, str]:
    items_doc = build_items()
    return {ITEMS_PATH: dump_json(items_doc), BENCHMARK_PATH: dump_json(build_benchmark(items_doc))}


def build(check: bool = False) -> int:
    built = outputs()
    items_doc = load_json_text(built[ITEMS_PATH])
    bad = 0
    for path, text in built.items():
        if check:
            same = path.exists() and path.read_text() == text
            print(("reproduces " if same else "DIFFERS    ") + str(path.relative_to(HERE.parent)))
            bad += not same
        else:
            path.write_text(text)
            print("wrote", path.relative_to(HERE.parent))
    checks = items_doc["checks"]
    for name in ("length_ok", "words_ok", "baseline_ok"):
        print(f"  {name}: {checks[name]}")
    if not checks["all_ok"]:
        print("THE POOL FAILS A CHECK: rewrite the planted entries before sealing", file=sys.stderr)
        return 1
    return 1 if bad else 0


def load_json_text(text: str):
    import json
    return json.loads(text)


def main(argv: list[str]) -> int:
    if not argv or argv[0] != "build":
        print(__doc__)
        return 2
    return build(check="--check" in argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
