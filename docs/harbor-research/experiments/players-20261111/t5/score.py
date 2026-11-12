"""Score T5: do independent reviewers miss the same seeded flaws?

A flaw is caught by a session when one of its findings on that change names
the flaw's file and a line within 3 lines of a ground-truth range. A finding
on a clean change is a false alarm.

k-effective is the Book's: log(all-miss rate) / log(1 - mean detection rate).
Its 95% interval puts the exact (Clopper-Pearson) limits of the all-miss rate
through that formula, with the measured mean miss rate. A percentile
bootstrap over flaws is reported beside it and does not decide the verdict.

Pre-registered rule (MANIFEST.md, "The rule"), with k the number of reviewers:

  incomplete  fewer than 5 valid sessions; or no flaw was caught by anyone;
              or no flaw was missed by anyone
  fail        the upper end of the interval for k-effective is below k: the
              reviewers miss together
  pass        otherwise: the interval holds k or lies above it. When no flaw
              was missed by all, k-effective has only a lower bound, and the
              interval runs from that bound upward

The result is a set of numbers. The verdict never replaces them.
Standard library only.
"""
from __future__ import annotations

import json
import math
import random
import re
import sys
from pathlib import Path

_PARENT = str(Path(__file__).resolve().parent.parent)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from t5.common import SEED, TRUTH_PATH, derive_seed, load_json, sha256_tree, MATERIALS  # noqa: E402
from t5.session import change_map, paths  # noqa: E402

LINE_TOLERANCE = 3     # a finding within this many lines of a ground-truth range counts
N_CHANGES = 16
MIN_REVIEWED = 15      # a session is valid when it gave a verdict on at least 15 of the 16 changes
MIN_SESSIONS = 5
N_BOOT = 10_000
# Which interval decides the verdict: "interval" (exact, the sealed choice) or "bootstrap_interval".
DECIDING_INTERVAL = "interval"

APPROVE_WORDS = {"approve", "approved", "accept", "accepted", "lgtm"}
REJECT_WORDS = {"reject", "rejected", "request changes", "request_changes", "changes requested", "block"}


def load_truth() -> dict:
    return load_json(TRUTH_PATH)


# ------------------------------------------------------------------ reading a review

def normalize_path(text) -> str:
    """A path as the diff gives it: no a/ or b/ in front, and nothing up to and including after/ or repo/."""
    p = str(text).strip().replace("\\", "/").lstrip("/")
    while p.startswith("./"):
        p = p[2:]
    for marker in ("/after/", "/repo/"):
        if marker in "/" + p:
            p = ("/" + p).split(marker, 1)[1]
    if p.startswith(("a/", "b/")):
        p = p[2:]
    return p


def line_span(value) -> tuple[int, int] | None:
    """A finding's line: a whole number, or 'A-B' for a span."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return (value, value)
    if isinstance(value, float) and value.is_integer():
        return (int(value), int(value))
    if isinstance(value, str):
        m = re.fullmatch(r"\s*(\d+)\s*(?:[-:,]\s*(\d+))?\s*", value)
        if m:
            lo = int(m.group(1))
            hi = int(m.group(2)) if m.group(2) else lo
            return (min(lo, hi), max(lo, hi))
    if isinstance(value, list) and len(value) == 2 and all(isinstance(v, int) and not isinstance(v, bool) for v in value):
        return (min(value), max(value))
    return None


def _verdict_word(value) -> str | None:
    word = str(value).strip().lower()
    if word in APPROVE_WORDS:
        return "approve"
    if word in REJECT_WORDS:
        return "reject"
    return None


def parse_review(path: Path) -> tuple[dict[str, dict], list[str]]:
    """Read review.json: an object from change id to {verdict, findings}.

    A list of objects that each carry a "change" key is read too."""
    try:
        raw = json.loads(Path(path).read_text())
    except FileNotFoundError:
        return {}, ["review.json is missing"]
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        return {}, [f"review.json is not JSON: {exc}"]
    if isinstance(raw, dict) and isinstance(raw.get("reviews"), (dict, list)):
        raw = raw["reviews"]
    if isinstance(raw, dict):
        pairs = list(raw.items())
    elif isinstance(raw, list):
        pairs = [(r.get("change"), r) for r in raw if isinstance(r, dict)]
    else:
        return {}, ["review.json is neither an object nor a list"]
    reviews: dict[str, dict] = {}
    problems: list[str] = []
    for key, body in pairs:
        change_id = str(key).strip().upper()
        if not isinstance(body, dict):
            problems.append(f"{change_id}: not an object")
            continue
        if change_id in reviews:
            problems.append(f"{change_id}: reviewed twice, first review kept")
            continue
        verdict = _verdict_word(body.get("verdict"))
        if verdict is None:
            problems.append(f"{change_id}: verdict is neither approve nor reject")
        findings = []
        listed = body.get("findings")
        for f in listed if isinstance(listed, list) else []:
            if not isinstance(f, dict):
                problems.append(f"{change_id}: a finding is not an object")
                continue
            span = line_span(f.get("line"))
            if span is None:
                problems.append(f"{change_id}: a finding has no usable line")
            findings.append({"file": normalize_path(f.get("file", "")), "lines": span,
                             "sentence": str(f.get("sentence", ""))[:600]})
        reviews[change_id] = {"verdict": verdict, "findings": findings}
    return reviews, problems


# ------------------------------------------------------------------ one session

def hits(finding: dict, flaw: dict) -> bool:
    """Whether a finding names the flaw's file and a line within the tolerance of one of its ranges."""
    if finding["lines"] is None:
        return False
    lo, hi = finding["lines"]
    for place in [{"file": flaw["file"], "lines": flaw["lines"]}] + flaw.get("also", []):
        if finding["file"] == place["file"] and lo <= place["lines"][1] + LINE_TOLERANCE \
                and hi >= place["lines"][0] - LINE_TOLERANCE:
            return True
    return False


def score_session(session_id: str, reviews: dict[str, dict], problems: list[str], truth: dict) -> dict:
    """Scores for one session. `reviews` is keyed by the change ids the reviewer saw."""
    by_key = {c["key"]: c for c in truth["changes"]}
    mapping = change_map(session_id, sorted(by_key))          # change id -> key
    for change_id in reviews:
        if change_id not in mapping:
            problems.append(f"{change_id}: no such change request")
    per_change, second_reader = {}, []
    for change_id, key in mapping.items():
        change = by_key[key]
        review = reviews.get(change_id) or {"verdict": None, "findings": []}
        row = {"seen_as": change_id, "verdict": review["verdict"], "findings": len(review["findings"]),
               "flawed": change["flawed"]}
        if change["flawed"]:
            catching = [f for f in review["findings"] if hits(f, change["flaw"])]
            row["caught"] = bool(catching)
            if catching:
                row["catching_sentence"] = catching[0]["sentence"]
            elif review["verdict"] == "reject":
                kind = "findings_elsewhere" if review["findings"] else "no_finding_given"
                row["ambiguous"] = kind
                second_reader.append({"change": key, "seen_as": change_id, "kind": kind,
                                      "findings": review["findings"]})
        else:
            row["false_alarm"] = bool(review["findings"])
            row["rejected"] = review["verdict"] == "reject"
            if row["false_alarm"]:
                row["alarm_sentences"] = [f["sentence"] for f in review["findings"]]
        per_change[key] = row
    flawed = [r for r in per_change.values() if r["flawed"]]
    clean = [r for r in per_change.values() if not r["flawed"]]
    reviewed = sum(r["verdict"] is not None for r in per_change.values())
    caught = sum(r["caught"] for r in flawed)
    return {
        "test": "T5",
        "session_id": session_id,
        "reviewed": reviewed,
        "valid": reviewed >= MIN_REVIEWED,
        "flaws": len(flawed),
        "caught": caught,
        "miss_rate": round(1 - caught / len(flawed), 4),
        "caught_by_tier": {tier: sum(r["caught"] for k, r in per_change.items()
                                     if r["flawed"] and by_key[k]["tier"] == tier)
                           for tier in ("plain", "moderate", "subtle")},
        "rejected_flawed": sum(r["verdict"] == "reject" for r in flawed),
        "caught_but_approved": sum(r["caught"] and r["verdict"] == "approve" for r in flawed),
        "clean_changes": len(clean),
        "false_alarms": sum(r["false_alarm"] for r in clean),
        "clean_rejected": sum(r["rejected"] for r in clean),
        "for_second_reader": second_reader,
        "per_change": dict(sorted(per_change.items())),
        "problems": problems,
    }


def collect(session_id: str, runs_root) -> dict:
    """Score one finished session directory."""
    truth = load_truth()
    p = paths(session_id, Path(runs_root))
    if not p["dir"].exists():
        return {"test": "T5", "session_id": session_id, "reviewed": 0, "valid": False, "per_change": {},
                "problems": [f"no session directory at {p['dir']}"]}
    reviews, problems = parse_review(p["review"])
    result = score_session(session_id, reviews, problems, truth)
    result["other_files"] = sorted(x.name for x in p["dir"].iterdir()
                                   if x.name not in ("TASK.md", "repo", "changes", "review.json"))
    result["materials_sha256"] = sha256_tree(MATERIALS)
    return result


# ------------------------------------------------------------------ k-effective

def clopper_pearson(k: int, n: int, level: float = 0.95) -> tuple[float, float]:
    """Exact two-sided interval for a rate of k in n."""
    if n == 0:
        return (0.0, 1.0)
    tail = (1 - level) / 2

    def cdf(x: int, p: float) -> float:
        return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(x + 1))

    def solve(f, rising: bool) -> float:
        lo, hi = 0.0, 1.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if (f(mid) < tail) == rising:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    lower = 0.0 if k == 0 else solve(lambda p: 1 - cdf(k - 1, p), rising=True)
    upper = 1.0 if k == n else solve(lambda p: cdf(k, p), rising=False)
    return (lower, upper)


def k_formula(all_miss_rate: float, mean_miss_rate: float) -> float | None:
    """The Book's k-effective: log(m) / log(1 - d). None where the formula has no value."""
    if not 0 < mean_miss_rate < 1:
        return None
    if all_miss_rate <= 0:
        return math.inf
    return math.log(all_miss_rate) / math.log(mean_miss_rate)


def bootstrap_k(catches: list[int], k: int, seed: int, n_boot: int = N_BOOT) -> dict:
    """Percentile 95% interval for k-effective, resampling flaws with replacement.

    `catches` holds, for each flaw, how many of the k reviewers caught it. A
    resample with no flaw missed by all gives infinity. A resample with no
    miss at all, or with no catch at all, has no value: it is counted at the
    bottom (1, the least k-effective can be) for the lower end and at the top
    (infinity) for the upper end, so that it can never narrow the interval."""
    n = len(catches)
    rng = random.Random(seed)
    values, without_value = [], 0
    for _ in range(n_boot):
        sample = rng.choices(catches, k=n)
        value = k_formula(sample.count(0) / n, 1 - sum(sample) / (n * k))
        if value is None:
            without_value += 1
        else:
            values.append(value)
    low_side = sorted(values + [1.0] * without_value)
    high_side = sorted(values + [math.inf] * without_value)
    return {"lower": low_side[int(0.025 * n_boot)], "upper": high_side[min(n_boot - 1, int(0.975 * n_boot))],
            "resamples": n_boot, "resamples_without_a_value": without_value,
            "resamples_at_infinity": sum(v == math.inf for v in values)}


def k_effective(catches: list[int], k: int, seed: int, n_boot: int = N_BOOT) -> dict:
    """Every number behind the verdict, from the count of reviewers who caught each flaw."""
    n = len(catches)
    all_missed = catches.count(0)
    m = all_missed / n
    d = sum(catches) / (n * k)
    q = 1 - d
    m_lo, m_hi = clopper_pearson(all_missed, n)
    out = {
        "flaws": n, "reviewers": k,
        "mean_detection_rate": round(d, 4), "mean_miss_rate": round(q, 4),
        "all_missed": all_missed, "all_miss_rate": round(m, 4),
        "all_miss_rate_ci95": [round(m_lo, 4), round(m_hi, 4)],
        "all_miss_rate_if_independent": round(q ** k, 6),
    }
    if q >= 1:
        return out | {"state": "no_flaw_caught", "k_eff": None}
    if q <= 0:
        return out | {"state": "no_flaw_missed", "k_eff": None}
    # The interval: exact limits of the all-miss rate, put through the Book's formula at the measured miss rate.
    # k-effective falls as the all-miss rate rises, so the rate's upper limit gives the lower end.
    # It cannot be below 1, because a flaw missed by all is missed by each: the all-miss rate
    # cannot exceed the mean miss rate.
    lower = max(1.0, math.log(m_hi) / math.log(q)) if m_hi < 1 else 1.0
    upper = math.log(m_lo) / math.log(q) if m_lo > 0 else math.inf
    out["interval"] = [_num(lower), _num(upper)]
    # The same comparison read as a test: how often independent reviewers with this miss rate
    # would all miss at least this many of the flaws. The upper end is below k exactly when this is under 0.025.
    p0 = q ** k
    out["p_at_least_this_many_all_missed_if_independent"] = round(
        sum(math.comb(n, i) * p0 ** i * (1 - p0) ** (n - i) for i in range(all_missed, n + 1)), 6)
    if all_missed == 0:
        return out | {"state": "lower_bound_only", "k_eff": None, "k_eff_lower_bound": _num(lower),
                      "bootstrap_interval": None,
                      "bootstrap_note": "every resample has no flaw missed by all, so the bootstrap says nothing here"}
    boot = bootstrap_k(catches, k, seed, n_boot)
    return out | {"state": "estimated", "k_eff": _num(k_formula(m, q)),
                  "bootstrap_interval": [_num(boot["lower"]), _num(boot["upper"])],
                  "bootstrap": {"resamples": boot["resamples"], "without_a_value": boot["resamples_without_a_value"],
                                "at_infinity": boot["resamples_at_infinity"]}}


def _num(x: float):
    return "inf" if x == math.inf else round(x, 4)


def _upper(interval) -> float:
    return math.inf if interval[1] == "inf" else float(interval[1])


def decide(stats: dict, interval: str | None = None) -> tuple[str, str]:
    """The rule, applied to the numbers of `k_effective`.

    `interval` names the interval that decides. The sealed rule uses
    DECIDING_INTERVAL, the exact one. "bootstrap_interval" shows what the
    percentile bootstrap would have returned."""
    interval = interval or DECIDING_INTERVAL
    k = stats["reviewers"]
    if stats["state"] == "no_flaw_caught":
        return "incomplete", "no reviewer caught any flaw, so the mean miss rate is 1 and k-effective has no value"
    if stats["state"] == "no_flaw_missed":
        return "incomplete", "no reviewer missed any flaw, so there are no misses whose overlap could be measured"
    if stats["state"] == "lower_bound_only":
        bound = stats["k_eff_lower_bound"]
        if bound > k:
            return "pass", f"no flaw was missed by all {k} reviewers; the lower bound {bound} is above {k}"
        return "pass", (f"no flaw was missed by all {k} reviewers, so k-effective has only a lower bound, {bound}; "
                        f"the interval from there upward holds {k}")
    lower, upper = stats[interval][0], _upper(stats[interval])
    if upper < k:
        return "fail", f"the interval {lower} to {stats[interval][1]} lies below {k}: the reviewers miss together"
    if lower > k:
        return "pass", f"the interval {lower} to {stats[interval][1]} lies above {k}"
    return "pass", f"the interval {lower} to {stats[interval][1]} holds {k}"


# ------------------------------------------------------------------ all sessions

def verdict(results: list[dict], truth: dict | None = None, n_boot: int = N_BOOT) -> dict:
    """Apply the pre-registered rule to a list of collected sessions."""
    truth = truth or load_truth()
    flawed = [c for c in truth["changes"] if c["flawed"]]
    clean = [c for c in truth["changes"] if not c["flawed"]]
    valid = [r for r in results if r.get("valid")]
    per_session = [{"session_id": r.get("session_id"), "reviewed": r.get("reviewed", 0), "valid": bool(r.get("valid")),
                    "caught": r.get("caught"), "miss_rate": r.get("miss_rate"),
                    "false_alarms": r.get("false_alarms"), "clean_rejected": r.get("clean_rejected")}
                   for r in results]
    out: dict = {"test": "T5", "sessions": len(results), "valid_sessions": len(valid),
                 "rule": {"min_sessions": MIN_SESSIONS, "min_reviewed": MIN_REVIEWED,
                          "line_tolerance": LINE_TOLERANCE},
                 "per_session": per_session}
    if len(valid) < MIN_SESSIONS:
        return out | {"verdict": "incomplete",
                      "reason": f"{len(valid)} valid sessions, the rule needs {MIN_SESSIONS}"}
    k = len(valid)
    table = {c["key"]: [int(r["per_change"][c["key"]]["caught"]) for r in valid] for c in flawed}
    catches = [sum(row) for row in table.values()]
    stats = k_effective(catches, k, derive_seed(SEED, "bootstrap", "k_eff"), n_boot)
    by_tier = {}
    for tier in ("plain", "moderate", "subtle"):
        rows = [table[c["key"]] for c in flawed if c["tier"] == tier]
        by_tier[tier] = {"flaws": len(rows), "all_missed": sum(sum(r) == 0 for r in rows),
                         "miss_rate": round(1 - sum(map(sum, rows)) / (len(rows) * k), 4)}
    alarms = {c["key"]: sum(bool(r["per_change"][c["key"]]["false_alarm"]) for r in valid) for c in clean}
    n_pairs = len(clean) * k
    fa = sum(alarms.values())
    fa_lo, fa_hi = clopper_pearson(fa, n_pairs)
    rejected_clean = sum(r["clean_rejected"] for r in valid)
    out |= {
        "k_effective": stats,
        "caught_by": {key: sum(row) for key, row in sorted(table.items())},
        "all_missed_flaws": sorted(key for key, row in table.items() if sum(row) == 0),
        "by_tier": by_tier,
        "adversarial_flawed": {c["key"]: sum(table[c["key"]]) for c in flawed if c["adversarial"]},
        "false_alarms": {"k": fa, "n": n_pairs, "rate": round(fa / n_pairs, 4),
                         "ci95": [round(fa_lo, 4), round(fa_hi, 4)], "by_change": alarms,
                         "clean_changes_rejected": rejected_clean},
        "for_second_reader": [dict(item, session_id=r["session_id"]) for r in valid for item in r["for_second_reader"]],
    }
    word, reason = decide(stats)
    out |= {"verdict": word, "reason": reason}
    if stats["state"] == "estimated":
        out["verdict_had_the_bootstrap_decided"] = decide(stats, "bootstrap_interval")[0]
    return out


def report(results: list[dict], without: tuple[str, ...] = ()) -> str:
    """A short table and the verdict. `without` names sessions to leave out before the rule is applied."""
    left_out = [r["session_id"] for r in results if r.get("session_id") in without]
    flagged = [r["session_id"] for r in results if r.get("read_outside_its_directory")]
    v = verdict([r for r in results if r.get("session_id") not in without])
    lines = ["T5 joint miss of reviewers on seeded flaws", "session   reviewed  caught  miss rate  false alarms"]
    for s in v["per_session"]:
        note = "" if s["valid"] else "  not valid"
        lines.append(f"{str(s['session_id']):9} {s['reviewed']:>8}  {_show(s['caught']):>6}  {_show(s['miss_rate']):>9}  "
                     f"{_show(s['false_alarms']):>12}{note}")
    st = v.get("k_effective")
    if st:
        lines.append(f"mean miss rate {st['mean_miss_rate']}, flaws missed by all: {st['all_missed']} of {st['flaws']} "
                     f"(rate {st['all_miss_rate']}, 95% {st['all_miss_rate_ci95'][0]} to {st['all_miss_rate_ci95'][1]}); "
                     f"independence predicts {st['all_miss_rate_if_independent']}")
        if st["state"] == "estimated":
            lines.append(f"k-effective {st['k_eff']} (95% {st['interval'][0]} to {st['interval'][1]}; percentile "
                         f"bootstrap {st['bootstrap_interval'][0]} to {st['bootstrap_interval'][1]}) "
                         f"against {st['reviewers']} reviewers")
        elif st["state"] == "lower_bound_only":
            lines.append(f"k-effective has only a lower bound: {st['k_eff_lower_bound']}")
        fa = v["false_alarms"]
        lines.append(f"false alarms on clean changes: {fa['k']} of {fa['n']}; missed by all: "
                     f"{', '.join(v['all_missed_flaws']) or 'none'}")
        lines.append(f"left for a second reader: {len(v['for_second_reader'])} rejections without a catch")
    if flagged:
        lines.append("the runner's trace has these subjects naming a path outside their directory: " + ", ".join(flagged))
    if left_out:
        lines.append("left out of the verdict: " + ", ".join(left_out))
    lines.append(f"verdict: {v['verdict']} ({v['reason']})")
    return "\n".join(lines)


def _show(x) -> str:
    return "-" if x is None else str(x)
