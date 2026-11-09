"""Score one T1 session: GARP and CCEI per frame and pooled, frame gap, per-item consistency.

Pre-registered verdict (MANIFEST.md, "T1 verdict"):
  incomplete  fewer than 44 of 48 offers answered with finite, non-negative
              hours and credits, or fewer than 22 in either frame
  pass        CCEI_plain >= 0.95 and CCEI_reframed >= 0.95   (rational within frames)
              and CCEI_pooled >= 0.95                         (one preference across frames)
              and median |share_plain - share_reframed| <= 0.05 (same choice per budget)
  fail        otherwise
The result is a vector; the verdict never replaces its components.
"""
from __future__ import annotations

import json
import math
from fractions import Fraction as F
from pathlib import Path

from t1.design import session_order
from t1.garp import ccei, expenditure_matrix, garp_violations

TAU = 0.95
SHARE_TOL = 0.05
ON_LINE_TOL = 0.02
MIN_VALID_TOTAL = 44
MIN_VALID_FRAME = 22


def _num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        x = float(v)
    elif isinstance(v, str):
        try:
            x = float(v.replace(",", "").strip())
        except ValueError:
            return None
    else:
        return None
    return x if math.isfinite(x) and x >= 0 else None


def parse_answers(path: Path) -> tuple[dict[int, tuple[float, float]], list[str]]:
    problems: list[str] = []
    try:
        raw = json.loads(Path(path).read_text())
    except FileNotFoundError:
        return {}, ["answers file missing"]
    except json.JSONDecodeError as exc:
        return {}, [f"answers file is not JSON: {exc}"]
    rows = []
    if isinstance(raw, dict):
        for k, v in raw.items():
            if isinstance(v, dict):
                rows.append({"offer": k, **v})
    elif isinstance(raw, list):
        rows = [r for r in raw if isinstance(r, dict)]
    else:
        problems.append("answers JSON is neither a list nor an object")
    out: dict[int, tuple[float, float]] = {}
    for r in rows:
        try:
            n = int(str(r.get("offer")).strip())
        except (TypeError, ValueError):
            problems.append(f"row without a usable offer number: {r!r}")
            continue
        R, C = _num(r.get("review_hours")), _num(r.get("compute_credits"))
        if R is None or C is None:
            problems.append(f"offer {n}: hours or credits missing, negative or non-numeric")
            continue
        if n in out:
            problems.append(f"offer {n} answered twice; first answer kept")
            continue
        out[n] = (R, C)
    return out, problems


def _median(xs):
    xs = sorted(xs)
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def _set_stats(obs: list[dict]) -> dict:
    prices = [o["prices"] for o in obs]
    bundles = [o["bundle"] for o in obs]
    E = expenditure_matrix(prices, bundles)
    viol = garp_violations(E, 1.0)
    proj = [(o["bundle"][0] * o["m"] / o["spend"], o["bundle"][1] * o["m"] / o["spend"])
            if o["spend"] > 0 else o["bundle"] for o in obs]
    return {
        "n": len(obs),
        "ccei": round(ccei(E), 6),
        "garp_violating_pairs": len(viol),
        "garp_holds": not viol,
        "ccei_projected_to_line": round(ccei(expenditure_matrix(prices, proj)), 6),
    }


def score_session(session_id: str, answers_path: Path, items_doc: dict, benchmark: dict) -> dict:
    by_id = {it["item_id"]: it for it in items_doc["items"]}
    reframe_of = {it["budget_id"]: it["reframe_type"] for it in items_doc["items"] if it["frame"] == "reframed"}
    order = session_order(session_id, items_doc["items"])
    answers, problems = parse_answers(answers_path)
    extra = sorted(n for n in answers if not 1 <= n <= len(order))
    if extra:
        problems.append(f"answers for offers that do not exist: {extra}")
    obs = []
    for n, iid in enumerate(order, start=1):
        if n not in answers:
            continue
        it = by_id[iid]
        c = it["canonical"]
        pR, pC, m = float(F(c["review_per_hour"])), float(F(c["compute_per_credit"])), float(F(c["budget"]))
        R, C = answers[n]
        spend = pR * R + pC * C
        obs.append({"offer": n, "item_id": iid, "budget_id": it["budget_id"], "frame": it["frame"],
                    "prices": (pR, pC), "bundle": (R, C), "m": m, "spend": spend,
                    "spend_ratio": spend / m, "review_share": (pR * R / spend) if spend > 0 else None})
    plain = [o for o in obs if o["frame"] == "plain"]
    refr = [o for o in obs if o["frame"] == "reframed"]
    result: dict = {
        "session_id": session_id,
        "test": "T1",
        "answered": len(obs),
        "items": len(order),
        "answer_problems": problems,
        "off_line_rate": {
            fr: (round(sum(abs(o["spend_ratio"] - 1) > ON_LINE_TOL for o in grp) / len(grp), 4) if grp else None)
            for fr, grp in (("plain", plain), ("reframed", refr))
        },
    }
    if len(obs) < MIN_VALID_TOTAL or len(plain) < MIN_VALID_FRAME or len(refr) < MIN_VALID_FRAME:
        result["verdict"] = "incomplete"
        result["verdict_reason"] = (f"{len(obs)} valid answers ({len(plain)} plain, {len(refr)} reframed); "
                                    f"need {MIN_VALID_TOTAL} total and {MIN_VALID_FRAME} per frame")
        return result
    s_plain, s_refr, s_pool = _set_stats(plain), _set_stats(refr), _set_stats(obs)
    pairs = []
    by_budget: dict[str, dict] = {}
    for o in obs:
        by_budget.setdefault(o["budget_id"], {})[o["frame"]] = o
    for bid in sorted(by_budget):
        d = by_budget[bid]
        if "plain" in d and "reframed" in d and d["plain"]["review_share"] is not None \
                and d["reframed"]["review_share"] is not None:
            ds = abs(d["plain"]["review_share"] - d["reframed"]["review_share"])
            rtype = reframe_of[bid]
            pairs.append({"budget_id": bid, "reframe_type": rtype,
                          "share_plain": round(d["plain"]["review_share"], 4),
                          "share_reframed": round(d["reframed"]["review_share"], 4),
                          "abs_share_diff": round(ds, 4),
                          "spend_ratio_plain": round(d["plain"]["spend_ratio"], 4),
                          "spend_ratio_reframed": round(d["reframed"]["spend_ratio"], 4)})
    diffs = [p["abs_share_diff"] for p in pairs]
    by_type = {}
    for p in pairs:
        by_type.setdefault(p["reframe_type"], []).append(p["abs_share_diff"])
    median_ds = _median(diffs)
    gap = min(s_plain["ccei"], s_refr["ccei"]) - s_pool["ccei"]
    sims = benchmark["simulations"]

    def frac_ge(key, value):
        return round(sum(s[key] >= value - 1e-12 for s in sims) / len(sims), 4)

    criteria = {
        "ccei_plain_ge_tau": s_plain["ccei"] >= TAU,
        "ccei_reframed_ge_tau": s_refr["ccei"] >= TAU,
        "ccei_pooled_ge_tau": s_pool["ccei"] >= TAU,
        "median_share_diff_le_tol": median_ds is not None and median_ds <= SHARE_TOL,
    }
    result.update({
        "plain": s_plain,
        "reframed": s_refr,
        "pooled": s_pool,
        "frame_gap": round(gap, 6),
        "item_consistency": {
            "pairs": len(pairs),
            "median_abs_share_diff": round(median_ds, 4) if median_ds is not None else None,
            "mean_abs_share_diff": round(sum(diffs) / len(diffs), 4) if diffs else None,
            "share_identical_within_0.02": round(sum(d <= 0.02 for d in diffs) / len(diffs), 4) if diffs else None,
            "median_by_reframe_type": {k: _median(v) for k, v in sorted(by_type.items())},
            "per_budget": pairs,
        },
        "random_benchmark_exceedance": {
            "p_random_ccei_plain_ge_subject": frac_ge("ccei_plain", s_plain["ccei"]),
            "p_random_ccei_reframed_ge_subject": frac_ge("ccei_reframed", s_refr["ccei"]),
            "p_random_ccei_pooled_ge_subject": frac_ge("ccei_pooled", s_pool["ccei"]),
        },
        "criteria": criteria,
        "rational_within_frames": criteria["ccei_plain_ge_tau"] and criteria["ccei_reframed_ge_tau"],
        "frame_invariant": criteria["ccei_pooled_ge_tau"] and criteria["median_share_diff_le_tol"],
    })
    result["verdict"] = "pass" if all(criteria.values()) else "fail"
    return result
