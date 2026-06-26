//! A mutable, deletable graph WITHOUT `Rc<RefCell<T>>`.
//!
//! The point: the `SlotMap` *owns* every node. Edges are just `Copy` keys, so there is one
//! owner and the borrow checker is satisfied trivially. Cycles are fine (they're just keys),
//! and deleting a node is safe because a stale key fails a generation check (`get` → `None`)
//! instead of dangling.
//!
//! Run: `cargo run --bin slotmap_graph`
//!
//! Contrast with the naive `Rc<RefCell<Node>>` design, which would: leak on cycles, panic at
//! runtime on overlapping `borrow_mut()`, and force `Weak` + `upgrade()` boilerplate.

use slotmap::{new_key_type, SecondaryMap, SlotMap};

new_key_type! {
    /// A `Copy` handle into the graph. Stale handles are detected, never dereferenced.
    struct NodeKey;
}

/// Node payload. Edges are stored as keys — no pointers, no `Rc`, no `RefCell`.
struct Node {
    name: &'static str,
    edges: Vec<NodeKey>,
}

/// A graph = the owning arena + any number of "secondary" columns keyed by the same key.
/// `visits` here is ECS-style associated data: a separate contiguous column, not a field
/// bolted onto `Node`.
struct Graph {
    nodes: SlotMap<NodeKey, Node>,
    visits: SecondaryMap<NodeKey, u32>,
}

impl Graph {
    fn new() -> Self {
        Graph {
            nodes: SlotMap::with_key(),
            visits: SecondaryMap::new(),
        }
    }

    fn add(&mut self, name: &'static str) -> NodeKey {
        let k = self.nodes.insert(Node { name, edges: Vec::new() });
        self.visits.insert(k, 0);
        k
    }

    /// Directed edge `from -> to`. Both endpoints are just keys; a cycle is allowed.
    fn link(&mut self, from: NodeKey, to: NodeKey) {
        if let Some(n) = self.nodes.get_mut(from) {
            n.edges.push(to);
        }
    }

    /// Iterative DFS from `start`, counting a visit on each reached node.
    /// Note we collect the edge keys first (a cheap `Vec<NodeKey>` of `Copy`s), which ends the
    /// borrow of `self.nodes` before we touch `self.visits` — no borrow gymnastics needed.
    fn dfs(&mut self, start: NodeKey) -> Vec<&'static str> {
        let mut order = Vec::new();
        let mut seen: Vec<NodeKey> = Vec::new();
        let mut stack = vec![start];

        while let Some(k) = stack.pop() {
            // Stale/removed key? `get` returns None — safe, no crash.
            let Some(node) = self.nodes.get(k) else { continue };
            if seen.contains(&k) {
                continue; // cycle guard
            }
            seen.push(k);
            order.push(node.name);

            let next: Vec<NodeKey> = node.edges.clone(); // Copy keys; ends the &self.nodes borrow
            if let Some(v) = self.visits.get_mut(k) {
                *v += 1;
            }
            for child in next {
                stack.push(child);
            }
        }
        order
    }
}

fn main() {
    let mut g = Graph::new();

    let build = g.add("build");
    let test = g.add("test");
    let lint = g.add("lint");
    let ship = g.add("ship");

    // build -> test -> ship ; build -> lint -> ship ; and a back-edge test -> build (a cycle!)
    g.link(build, test);
    g.link(build, lint);
    g.link(test, ship);
    g.link(lint, ship);
    g.link(test, build); // cycle: harmless here, would LEAK under Rc<RefCell>

    let order = g.dfs(build);
    println!("DFS from build: {order:?}");
    assert!(order.contains(&"ship"));

    // Delete `lint`. `build`'s and `ship`'s keys are unaffected; `lint`'s key now reads None.
    g.nodes.remove(lint);
    assert!(g.nodes.get(lint).is_none(), "stale key detected by generation, not a dangling ref");
    assert!(g.nodes.get(build).is_some(), "unrelated keys stay valid");

    // Re-running DFS simply skips the removed node — no panic, no special-casing.
    let order_after = g.dfs(build);
    println!("DFS after removing `lint`: {order_after:?}");
    assert!(!order_after.contains(&"lint"));

    println!("visit count for `build`: {}", g.visits.get(build).copied().unwrap_or(0));
    println!("ok: a mutable, cyclic, deletable graph with zero Rc/RefCell/unsafe in user code");
}
