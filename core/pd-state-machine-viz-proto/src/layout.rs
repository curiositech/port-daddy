//! Pure layered/column layout for `StateGraph` — no GPU, no I/O.
//!
//! Column (x) = longest-path depth over the 8 "primary chain" edges only (the
//! DAG in `lib/dispatch/state-machine.ts`'s ASCII diagram: proposed -> claimed
//! -> in_progress -> produced -> review_pending -> {accepted, rejected} ->
//! {settled, salvage}). The privileged escape jumps (any non-terminal ->
//! failed / -> salvage) are drawn as edges but deliberately excluded from the
//! layering pass: including them would pull `failed` back to column 0 (it is
//! reachable from `proposed`, one hop away) and collapse the whole point of a
//! layered diagram. `Failed` therefore gets its own out-of-band terminal
//! column one past the rightmost primary column, in its own row — "off the
//! happy path" is the honest reading of a state reachable from everywhere.
//!
//! Row (y) = index within a column, ordered by `ReviewState`'s declaration
//! order (`Ord` derive) for determinism. Node rects use fixed `NODE_W` /
//! `NODE_H`; non-overlap is a direct consequence of one node per (column,row)
//! cell on a fixed grid, and is asserted by a test rather than assumed.

use std::collections::HashMap;

use kurbo::{Point, Rect};

use crate::model::{ReviewState, StateGraph};

pub const NODE_W: f64 = 168.0;
pub const NODE_H: f64 = 56.0;
const COL_GAP: f64 = 64.0;
// Wider than a bare visual gap would need: this is also where an edge's verb
// label (e.g. "accept"/"reject" fanning out of `review_pending`) gets drawn,
// so two stacked rows need enough clearance for a 10pt label between them.
const ROW_GAP: f64 = 40.0;

/// The 8 primary-chain edges, duplicated from `model::PRIMARY_EDGES` (that
/// const is private to keep `model`'s public surface to the transition table
/// itself; layout only needs the `(from, to)` pairs).
const PRIMARY_EDGES: &[(ReviewState, ReviewState)] = &[
    (ReviewState::Proposed, ReviewState::Claimed),
    (ReviewState::Claimed, ReviewState::InProgress),
    (ReviewState::InProgress, ReviewState::Produced),
    (ReviewState::Produced, ReviewState::ReviewPending),
    (ReviewState::ReviewPending, ReviewState::Accepted),
    (ReviewState::ReviewPending, ReviewState::Rejected),
    (ReviewState::Accepted, ReviewState::Settled),
    (ReviewState::Rejected, ReviewState::Salvage),
];

/// Top-left position of each node's rect, keyed by state. Pure function of
/// `graph.nodes` (the edge set / timeline don't affect layout — the machine's
/// shape is fixed regardless of which dispatch instance is overlaid).
pub fn layout(graph: &StateGraph) -> HashMap<ReviewState, Point> {
    let column = column_of(graph);

    // Group nodes by column, preserving `ReviewState::ALL` order within each
    // (its `Ord` derive is declaration order) so row assignment is deterministic.
    let mut by_column: HashMap<u32, Vec<ReviewState>> = HashMap::new();
    let max_col = graph.nodes.iter().map(|&s| column[&s]).max().unwrap_or(0);
    for &st in &graph.nodes {
        by_column.entry(column[&st]).or_default().push(st);
    }
    for states in by_column.values_mut() {
        states.sort();
    }

    let mut positions = HashMap::new();
    for col in 0..=max_col {
        let Some(states) = by_column.get(&col) else {
            continue;
        };
        for (row, &st) in states.iter().enumerate() {
            let x = col as f64 * (NODE_W + COL_GAP);
            let y = row as f64 * (NODE_H + ROW_GAP);
            positions.insert(st, Point::new(x, y));
        }
    }
    positions
}

/// The rect for a node at `p` (top-left corner, fixed size). `scene.rs`
/// computes screen-space rects itself (position is scaled + offset by the
/// fit transform first), so this helper's only caller today is the
/// non-overlap test below — kept `pub` as the natural public counterpart to
/// `layout()`.
#[allow(dead_code)]
pub fn node_rect(p: Point) -> Rect {
    Rect::new(p.x, p.y, p.x + NODE_W, p.y + NODE_H)
}

/// Column index per state: longest-path depth over `PRIMARY_EDGES`, with
/// `Failed` pinned one column past the deepest primary column.
fn column_of(graph: &StateGraph) -> HashMap<ReviewState, u32> {
    let mut col: HashMap<ReviewState, u32> = HashMap::new();
    col.insert(ReviewState::Proposed, 0);

    // PRIMARY_EDGES is already topologically ordered (each edge's `from` is
    // declared before any edge whose `from` is that edge's `to`), so a single
    // forward pass computing `col[to] = max(col[to], col[from] + 1)` converges
    // in one sweep. Asserted by a test rather than re-sorted defensively, so a
    // future edit that breaks the ordering fails loudly instead of silently
    // mis-laying-out.
    for &(from, to) in PRIMARY_EDGES {
        let depth = col.get(&from).copied().unwrap_or(0) + 1;
        let entry = col.entry(to).or_insert(depth);
        *entry = (*entry).max(depth);
    }

    let max_primary_col = col.values().copied().max().unwrap_or(0);

    // Any node not reached by a primary edge (only `Failed`, today) gets its
    // own out-of-band terminal column.
    for &st in &graph.nodes {
        col.entry(st).or_insert(max_primary_col + 1);
    }
    col
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_node_gets_a_position() {
        let g = StateGraph::structural();
        let pos = layout(&g);
        assert_eq!(pos.len(), g.nodes.len());
        for st in ReviewState::ALL {
            assert!(pos.contains_key(&st), "{st:?} missing from layout");
        }
    }

    #[test]
    fn no_two_node_rects_overlap() {
        let g = StateGraph::structural();
        let pos = layout(&g);
        let rects: Vec<(ReviewState, Rect)> =
            pos.iter().map(|(&st, &p)| (st, node_rect(p))).collect();
        for i in 0..rects.len() {
            for j in (i + 1)..rects.len() {
                let (a_state, a) = rects[i];
                let (b_state, b) = rects[j];
                let overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
                assert!(
                    !overlap,
                    "{a_state:?} rect overlaps {b_state:?} rect: {a:?} vs {b:?}"
                );
            }
        }
    }

    #[test]
    fn primary_chain_advances_column_left_to_right() {
        let g = StateGraph::structural();
        let pos = layout(&g);
        assert!(pos[&ReviewState::Proposed].x < pos[&ReviewState::Claimed].x);
        assert!(pos[&ReviewState::Claimed].x < pos[&ReviewState::InProgress].x);
        assert!(pos[&ReviewState::InProgress].x < pos[&ReviewState::Produced].x);
        assert!(pos[&ReviewState::Produced].x < pos[&ReviewState::ReviewPending].x);
        assert!(pos[&ReviewState::ReviewPending].x < pos[&ReviewState::Accepted].x);
        assert!(pos[&ReviewState::ReviewPending].x < pos[&ReviewState::Rejected].x);
        assert!(pos[&ReviewState::Accepted].x < pos[&ReviewState::Settled].x);
        assert!(pos[&ReviewState::Rejected].x < pos[&ReviewState::Salvage].x);
    }

    #[test]
    fn accepted_and_rejected_share_a_column() {
        let g = StateGraph::structural();
        let pos = layout(&g);
        assert_eq!(pos[&ReviewState::Accepted].x, pos[&ReviewState::Rejected].x);
        assert_ne!(pos[&ReviewState::Accepted].y, pos[&ReviewState::Rejected].y);
    }

    #[test]
    fn settled_and_salvage_share_a_column() {
        let g = StateGraph::structural();
        let pos = layout(&g);
        assert_eq!(pos[&ReviewState::Settled].x, pos[&ReviewState::Salvage].x);
    }

    #[test]
    fn failed_is_out_of_band_past_every_primary_column() {
        let g = StateGraph::structural();
        let pos = layout(&g);
        let failed_x = pos[&ReviewState::Failed].x;
        for st in ReviewState::ALL {
            if st == ReviewState::Failed {
                continue;
            }
            assert!(
                pos[&st].x <= failed_x,
                "{st:?} at x={} should not be past Failed at x={failed_x}",
                pos[&st].x
            );
        }
    }

    #[test]
    fn layout_is_deterministic() {
        let g = StateGraph::structural();
        let a = layout(&g);
        let b = layout(&g);
        for st in ReviewState::ALL {
            assert_eq!(a[&st], b[&st]);
        }
    }
}
