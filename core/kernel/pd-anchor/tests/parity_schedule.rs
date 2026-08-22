//! Cross-runtime byte-parity for the planner scheduler (ADR-0086 / ADR-0054).
//!
//! The canonical Rust impl (`pd_anchor::schedule`) and the TS byte-parity fallback
//! (`lib/planner-schedule.ts`) BOTH assert they reproduce the shared hand-computed vectors in
//! `tests/fixtures/planner-schedule-parity-vectors.json`. This is the Rust half; the TS half is
//! `tests/unit/planner-schedule.test.js`.

use pd_anchor::schedule::{
    schedule, validate_ladder, LadderNode, ParentEdge, SchedEdge, SchedNode,
};
use serde_json::Value;
use std::{fs, path::PathBuf};

fn vectors() -> Value {
    // tests/ -> pd-anchor -> kernel -> core -> repo root, then tests/fixtures/.
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/fixtures/planner-schedule-parity-vectors.json");
    let raw = fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p:?}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {p:?}: {e}"))
}

#[test]
fn schedule_matches_canonical_vectors() {
    let v = vectors();
    for case in v["schedule_cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let nodes: Vec<SchedNode> = serde_json::from_value(case["nodes"].clone()).unwrap();
        let edges: Vec<SchedEdge> = serde_json::from_value(case["edges"].clone()).unwrap();
        let got = serde_json::to_value(schedule(&nodes, &edges)).unwrap();
        let exp = &case["expected"];

        for field in ["ok", "cyclic", "makespan", "order", "criticalPath", "nodes"] {
            assert_eq!(
                got[field], exp[field],
                "case '{name}', field '{field}': got {} expected {}",
                got[field], exp[field]
            );
        }
    }
}

#[test]
fn ladder_matches_canonical_vectors() {
    let v = vectors();
    for case in v["ladder_cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let nodes: Vec<LadderNode> = serde_json::from_value(case["nodes"].clone()).unwrap();
        let parents: Vec<ParentEdge> = serde_json::from_value(case["parents"].clone()).unwrap();
        let got = validate_ladder(&nodes, &parents);

        assert_eq!(
            got.ok,
            case["expected"]["ok"].as_bool().unwrap(),
            "case '{name}': ok mismatch ({:?})",
            got.violations
        );
        let mut got_children: Vec<String> =
            got.violations.iter().map(|x| x.child.clone()).collect();
        got_children.sort();
        let mut exp_children: Vec<String> = case["expected"]["violationChildren"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap().to_string())
            .collect();
        exp_children.sort();
        assert_eq!(
            got_children, exp_children,
            "case '{name}': violation children mismatch"
        );
    }
}
