#!/usr/bin/env python3
"""Read-only structural checks for the prospective reviewer-dependence manifest.

Preparation is a valid research artifact. It is never runnable admission.
"""

import argparse
import copy
import hashlib
import json
import math
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / "docs/harbor-research/research/reviewer-dependence-manifest.json"
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
PLACEHOLDER = re.compile(r"(?:^|\W)(?:TBD|TODO|PENDING|PLACEHOLDER|UNKNOWN)(?:$|\W)", re.I)
CLASSES = {"authority_admission", "retry_durability", "evidence_provenance"}


def require(errors, condition, message):
    if not condition:
        errors.append(message)


def filled(value):
    return isinstance(value, str) and bool(value.strip()) and not PLACEHOLDER.search(value)


def digest(value, pattern=SHA256):
    return isinstance(value, str) and bool(pattern.fullmatch(value))


def expected_freeze_digest(data):
    payload = copy.deepcopy(data)
    payload["freezeDigest"] = None
    payload["randomizationSeed"] = None
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def git_blob_at(commit, path):
    if not digest(commit, SHA40) or not isinstance(path, str) or path.startswith("/") or ".." in Path(path).parts:
        return None, None
    result = subprocess.run(
        ["git", "rev-parse", f"{commit}:{path}"], cwd=ROOT,
        text=True, capture_output=True, check=False,
    )
    if result.returncode:
        return None, None
    blob = result.stdout.strip()
    body = subprocess.run(
        ["git", "show", f"{commit}:{path}"], cwd=ROOT,
        text=True, capture_output=True, check=False,
    )
    return blob, body.stdout if body.returncode == 0 else None


def local_repository():
    result = subprocess.run(
        ["git", "remote", "get-url", "origin"], cwd=ROOT,
        text=True, capture_output=True, check=False,
    )
    if result.returncode:
        return None
    match = re.search(r"(?:github\.com[:/])([^/]+/[^/]+?)(?:\.git)?\s*$", result.stdout)
    return match.group(1) if match else None


def check_plan(data):
    errors = []
    require(errors, isinstance(data, dict), "manifest must be an object")
    if errors:
        return errors
    require(errors, data.get("schemaVersion") == 1, "schemaVersion must be 1")
    require(errors, data.get("status") in ("preparation", "frozen"), "status must be preparation or frozen")
    require(errors, data.get("sourceRepository") == local_repository(), "sourceRepository must match this checkout's origin")
    require(errors, digest(data.get("sourceCommit"), SHA40), "sourceCommit must be a full Git SHA")
    require(errors, data.get("requiredSlots") == 24, "requiredSlots must be 24")
    require(errors, data.get("requiredPerClass") == 8, "requiredPerClass must be 8")
    require(errors, data.get("requiredProjects") >= 3 if isinstance(data.get("requiredProjects"), int) and not isinstance(data.get("requiredProjects"), bool) else False,
            "requiredProjects must be at least 3")
    require(errors, isinstance(data.get("classes"), list) and all(isinstance(c, str) for c in data["classes"]) and set(data["classes"]) == CLASSES,
            "exactly the three preregistered classes required")
    slots = data.get("slots")
    require(errors, isinstance(slots, list) and len(slots) == 24, "exactly 24 slots required")
    if not isinstance(slots, list):
        return errors
    ids, counts = set(), Counter()
    for i, slot in enumerate(slots):
        label = f"slot {i + 1}"
        if not isinstance(slot, dict):
            errors.append(f"{label}: must be an object")
            continue
        sid = slot.get("id")
        require(errors, isinstance(sid, str) and bool(re.fullmatch(r"RD-[0-9]{2}", sid)), f"{label}: invalid id")
        require(errors, sid not in ids, f"{label}: repeated id")
        ids.add(sid)
        cls = slot.get("failureClass")
        require(errors, isinstance(cls, str) and cls in CLASSES, f"{label}: invalid failureClass")
        if isinstance(cls, str):
            counts[cls] += 1
        require(errors, filled(slot.get("project")), f"{label}: project required")
        require(errors, slot.get("status") in ("planned", "admitted"), f"{label}: invalid status")
        for key in ("defectHypothesis", "candidateConstruction", "oraclePlan", "cleanControlPlan"):
            require(errors, filled(slot.get(key)), f"{label}: {key} required")
        anchor = slot.get("sourceAnchor")
        if not isinstance(anchor, dict):
            anchor = {}
        require(errors, anchor.get("repository") == data.get("sourceRepository") and slot.get("project") == anchor.get("repository"),
                f"{label}: project must match the verified source repository")
        path, blob, phrase = anchor.get("path"), anchor.get("blob"), anchor.get("text")
        require(errors, filled(path) and filled(phrase) and digest(blob, SHA40), f"{label}: complete source anchor required")
        if filled(path) and filled(phrase) and digest(blob, SHA40) and digest(data.get("sourceCommit"), SHA40):
            actual_blob, source = git_blob_at(data["sourceCommit"], path)
            require(errors, actual_blob == blob and source is not None and phrase in source,
                    f"{label}: source anchor does not match immutable Git blob")
    for cls in CLASSES:
        require(errors, counts[cls] == 8, f"{cls}: need exactly 8 slots")
    return errors


def check_ready(data):
    errors = check_plan(data)
    if errors:
        return errors
    require(errors, data.get("status") == "frozen", "manifest is preparation, not frozen")
    for key in ("freezeDigest", "randomizationSeed"):
        require(errors, digest(data.get(key)), f"{key} must be a SHA-256 digest")
    if digest(data.get("freezeDigest")):
        require(errors, data["freezeDigest"] == expected_freeze_digest(data),
                "freezeDigest does not match canonical case-selection manifest")
    roles = data.get("roleResolution")
    require(errors, isinstance(roles, dict) and all(filled(roles.get(k)) for k in ("repeatedReviewer", "propertyAuthor", "blindTester", "strongReviewer")) if isinstance(roles, dict) else False,
            "versioned capability roles must be resolved before runs")
    cost = data.get("costCalibration")
    cap = cost.get("perPairUsdCap") if isinstance(cost, dict) else None
    require(errors, isinstance(cap, (int, float)) and not isinstance(cap, bool) and math.isfinite(cap) and cap > 0 and digest(cost.get("priceSheetDigest")) if isinstance(cost, dict) else False,
            "positive equal per-pair cost cap and frozen price sheet required")
    projects = Counter(slot.get("project") for slot in data["slots"])
    require(errors, len(projects) >= data["requiredProjects"], "at least three actual projects required")
    require(errors, max(projects.values(), default=0) <= 12, "one project supplies over 12 cases")
    for slot in data["slots"]:
        label = slot["id"]
        require(errors, slot.get("status") == "admitted", f"{label}: pending adjudication")
        package = slot.get("casePackage")
        if not isinstance(package, dict):
            errors.append(f"{label}: paired case package absent")
            continue
        for key in ("baseTree", "defectTree", "cleanTree", "specDigest", "oracleArtifactDigest", "oracleWitnessDigest", "mutantOracleWitnessDigest", "reviewerViewDigest", "spoilerAuditDigest"):
            require(errors, digest(package.get(key)), f"{label}: {key} must be an immutable digest")
        require(errors, package.get("defectTree") != package.get("cleanTree"), f"{label}: defect and clean trees identical")
        require(errors, filled(package.get("oracleCommand")), f"{label}: oracle command absent")
        require(errors, package.get("oracleExpected") == {"defect": "fail", "clean": "pass", "mutant": "fail"},
                f"{label}: oracle must distinguish defect, clean and oracle mutation")
        require(errors, package.get("anchorTestsExcluded") is True and package.get("privateAnswersExcluded") is True,
                f"{label}: reviewer view still exposes source tests or answers")
        builder = package.get("builderId")
        require(errors, filled(builder), f"{label}: builder identity absent")
        adj = slot.get("adjudication")
        if not isinstance(adj, dict):
            errors.append(f"{label}: independent adjudication absent")
            continue
        decisions = adj.get("decisions")
        if not isinstance(decisions, list) or len(decisions) != 2:
            errors.append(f"{label}: two independent decisions required")
            continue
        reviewers = []
        for decision in decisions:
            if not isinstance(decision, dict):
                errors.append(f"{label}: malformed adjudicator decision")
                continue
            reviewers.append(decision.get("adjudicatorId"))
            require(errors, decision.get("verdict") == "admit" and digest(decision.get("signedDecisionDigest")),
                    f"{label}: signed admit decision required")
        require(errors, all(filled(r) for r in reviewers) and len(set(r for r in reviewers if isinstance(r, str))) == 2 and builder not in reviewers,
                f"{label}: adjudicators must differ from each other and builder")
        require(errors, adj.get("specUnambiguous") is True and adj.get("cleanPasses") is True and adj.get("oracleIndependent") is True,
                f"{label}: specification, clean control and oracle findings required")
    errors.append("execution admission requires a separate verifier for artifact bytes, oracle behavior, adjudicator signatures and identities, isolation, and cross-project provenance")
    return errors


def self_test(data):
    assert not check_plan(data), "current planning manifest invalid"
    ready_errors = check_ready(data)
    assert ready_errors and any("pending adjudication" in e for e in ready_errors), "pending admission was accepted"
    counterfeit = copy.deepcopy(data)
    counterfeit["status"] = "frozen"
    for slot in counterfeit["slots"]:
        slot["status"] = "admitted"
        slot["casePackage"] = {"defectTree": "a" * 64, "cleanTree": "a" * 64, "oracleCommand": "TBD"}
        slot["adjudication"] = {"decisions": []}
    rejected = check_ready(counterfeit)
    assert any("oracle command absent" in e for e in rejected), "placeholder oracle accepted"
    assert any("defect and clean trees identical" in e for e in rejected), "missing clean control accepted"
    assert any("two independent decisions required" in e for e in rejected), "missing adjudication accepted"
    malformed = copy.deepcopy(data)
    malformed["classes"] = [1]
    malformed["slots"][0]["sourceAnchor"] = []
    assert check_plan(malformed), "malformed schema accepted"
    relabeled = copy.deepcopy(data)
    relabeled["slots"][0]["project"] = "fabricated/second-project"
    assert any("project must match" in e for e in check_plan(relabeled)), "project relabel accepted"
    nonfinite = copy.deepcopy(data)
    nonfinite["costCalibration"] = {"perPairUsdCap": float("inf"), "priceSheetDigest": "a" * 64}
    assert any("positive equal per-pair cost" in e for e in check_ready(nonfinite)), "nonfinite cost cap accepted"
    print("PASS: draft accepted as draft; pending and counterfeit readiness rejected")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--ready", action="store_true", help="check structural declarations; execution admission remains blocked pending independent verification")
    group.add_argument("--self-test", action="store_true", help="exercise draft and counterfeit admission without writes")
    args = parser.parse_args()
    data = json.loads(args.manifest.read_text())
    if args.self_test:
        self_test(data)
        return 0
    errors = check_ready(data) if args.ready else check_plan(data)
    if errors:
        for error in errors:
            print("FAIL:", error, file=sys.stderr)
        return 1
    print("PASS: preparation manifest")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
