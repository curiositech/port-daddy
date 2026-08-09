//! The pane-tree multiplexer core — the "tmux, but Rust" spine of pd-console.
//!
//! A [`Workspace`] is a tree of panes. Every node is either a [`Node::Leaf`]
//! (one [`SurfaceKind`] bound to an entity) or a [`Node::Split`] (a row or
//! column of weighted children). Exactly one leaf is focused at all times.
//!
//! This module is deliberately **GPUI-free and dependency-free** so it compiles
//! on the Linux CI gate and is exhaustively unit-testable. The GPUI shell
//! (`app.rs`) renders this tree; the leader-key layer maps keystrokes onto the
//! operations below. The data model is interaction-agnostic: the same tree
//! backs tmux keys, vim keys, or mouse-dragged dividers.
//!
//! Operations: [`Workspace::split`], [`Workspace::close`] (merge),
//! [`Workspace::focus_next`]/[`focus_prev`](Workspace::focus_prev),
//! [`Workspace::resize`], [`Workspace::swap_surface`], [`Workspace::bind_entity`].

use std::collections::{HashMap, HashSet};
use std::fmt;

/// Stable per-pane identifier. Never reused within a [`Workspace`].
pub type PaneId = u64;

/// Split orientation. `Row` lays children left→right (vertical dividers between
/// them); `Col` lays children top→bottom (horizontal dividers).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dir {
    Row,
    Col,
}

/// Where a dragged pane lands relative to a drop-target pane. The four edges
/// split the target's slot and move the dragged pane in on that side; `Center`
/// swaps the two panes' surfaces in place (the layout is untouched).
///
/// This is the interaction-agnostic vocabulary the mouse-drag layer (BetterSnap
/// / Windows-Snap feel) and any future keyboard "move pane" verb both target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropEdge {
    Left,
    Right,
    Top,
    Bottom,
    Center,
}

impl DropEdge {
    /// The split orientation an edge drop induces. `Center` has none (it swaps).
    pub fn orientation(self) -> Option<Dir> {
        match self {
            DropEdge::Left | DropEdge::Right => Some(Dir::Row),
            DropEdge::Top | DropEdge::Bottom => Some(Dir::Col),
            DropEdge::Center => None,
        }
    }

    /// True when the dragged pane lands *before* the target in reading order
    /// (left of / above it); false for after (right of / below).
    pub fn before(self) -> bool {
        matches!(self, DropEdge::Left | DropEdge::Top)
    }
}

/// Why a [`Workspace::move_leaf`] was rejected. A small matchable enum (callers
/// in the GPUI shell branch on the variant), never a bare `bool` or `anyhow`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveError {
    /// `from` and `target` are the same pane — a move onto itself.
    SamePane,
    /// No leaf with the `from` id exists in the workspace.
    FromNotFound,
    /// No leaf with the `target` id exists in the workspace.
    TargetNotFound,
}

impl fmt::Display for MoveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let msg = match self {
            MoveError::SamePane => "cannot move a pane onto itself",
            MoveError::FromNotFound => "the dragged pane no longer exists",
            MoveError::TargetNotFound => "the drop-target pane no longer exists",
        };
        f.write_str(msg)
    }
}

impl std::error::Error for MoveError {}

/// What a leaf pane shows, plus the entity it is bound to. "Hopping context"
/// is just mutating this on the focused leaf — the layout never moves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SurfaceKind {
    /// Live transcript of one running agent (`None` = follow the newest agent).
    AgentTranscript { agent_id: Option<String> },
    /// The roadmap, always one keystroke away.
    Roadmap,
    /// Conversation with the cartographer agent.
    CartographerChat,
    /// Filetree rooted at a repo/worktree path (`None` = the operator's repo).
    FileTree { root: Option<String> },
    /// Read-only editor surface hosting one file from local disk. The Harbor
    /// Editor's P0 walking skeleton: `path` is the file to host; `region` is an
    /// optional 1-based inclusive `(start, end)` line span to scroll to / mark
    /// (the seam P1 authorship color and P3 claim bands paint into). P0 has no
    /// buffer, no CRDT, no networking — it reads the file and renders it.
    Editor {
        path: String,
        region: Option<(u32, u32)>,
    },
    /// Daemon health / runtime state.
    DaemonHealth,
    /// All running fleet agents at a glance.
    Fleet,
    /// Coordination sessions across worktrees.
    Sessions,
    /// The dispatch queue (the approval gate).
    Dispatch,
    /// The HITL alerts log — the dead-letter queue of captured action failures,
    /// rendered untruncated (foreground-only: reads `ConsoleView.alerts`).
    Hitl,
    /// Daemon-authored WorkIntent and WorkPlan truth. The surface may render a
    /// graph only from durable AgentNode specifications returned by the daemon.
    Work,
    /// Any existing console panel addressed by its nav id (fleet, cockpit,
    /// claims, peek, adrs, activity, inbox, suggest, memory, prs, coast, …).
    /// This is the bridge to the live data the shell already fetches: every
    /// pane the old static console had is summonable into any split.
    Panel { nav: String },
}

impl SurfaceKind {
    /// Short human label for the pane's title bar.
    pub fn label(&self) -> String {
        match self {
            SurfaceKind::AgentTranscript { agent_id: Some(id) } => format!("agent {id}"),
            SurfaceKind::AgentTranscript { agent_id: None } => "agent (newest)".into(),
            SurfaceKind::Roadmap => "planner".into(),
            SurfaceKind::CartographerChat => "cartographer".into(),
            SurfaceKind::FileTree { root: Some(r) } => format!("files {r}"),
            SurfaceKind::FileTree { root: None } => "files".into(),
            SurfaceKind::Editor { path, .. } => {
                let base = path
                    .rsplit(['/', '\\'])
                    .next()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(path);
                format!("edit {base}")
            }
            SurfaceKind::DaemonHealth => "daemon".into(),
            SurfaceKind::Fleet => "fleet".into(),
            SurfaceKind::Sessions => "sessions".into(),
            SurfaceKind::Dispatch => "gates".into(),
            SurfaceKind::Hitl => "alerts".into(),
            SurfaceKind::Work => "work".into(),
            SurfaceKind::Panel { nav } => nav.clone(),
        }
    }
}

/// A weighted child within a [`Split`]. `weight` is a relative flex factor;
/// only ratios matter, so weights need not sum to 1.
#[derive(Debug, Clone)]
pub struct Child {
    pub weight: f32,
    pub node: Node,
}

/// One node in the pane tree.
#[derive(Debug, Clone)]
pub enum Node {
    Leaf { id: PaneId, surface: SurfaceKind },
    Split { dir: Dir, children: Vec<Child> },
}

impl Node {
    fn leaf(id: PaneId, surface: SurfaceKind) -> Node {
        Node::Leaf { id, surface }
    }

    /// In-order list of leaf ids under this node (left→right, top→bottom).
    fn collect_leaves(&self, out: &mut Vec<PaneId>) {
        match self {
            Node::Leaf { id, .. } => out.push(*id),
            Node::Split { children, .. } => {
                for c in children {
                    c.node.collect_leaves(out);
                }
            }
        }
    }

    fn find_surface(&self, target: PaneId) -> Option<&SurfaceKind> {
        match self {
            Node::Leaf { id, surface } => (*id == target).then_some(surface),
            Node::Split { children, .. } => {
                children.iter().find_map(|c| c.node.find_surface(target))
            }
        }
    }

    fn find_surface_mut(&mut self, target: PaneId) -> Option<&mut SurfaceKind> {
        match self {
            Node::Leaf { id, surface } => (*id == target).then_some(surface),
            Node::Split { children, .. } => children
                .iter_mut()
                .find_map(|c| c.node.find_surface_mut(target)),
        }
    }
}

/// A pane-tree workspace with a single focus. The unit the GPUI shell renders.
#[derive(Debug, Clone)]
pub struct Workspace {
    pub root: Node,
    focused: PaneId,
    next_id: PaneId,
}

impl Workspace {
    /// A fresh workspace: one full-window leaf showing `surface`.
    pub fn new(surface: SurfaceKind) -> Workspace {
        Workspace {
            root: Node::leaf(1, surface),
            focused: 1,
            next_id: 2,
        }
    }

    /// The focused pane id.
    pub fn focused(&self) -> PaneId {
        self.focused
    }

    /// In-order leaf ids. Always non-empty.
    pub fn leaves(&self) -> Vec<PaneId> {
        let mut v = Vec::new();
        self.root.collect_leaves(&mut v);
        v
    }

    /// Number of panes.
    pub fn pane_count(&self) -> usize {
        self.leaves().len()
    }

    /// The surface shown in the focused pane.
    pub fn focused_surface(&self) -> &SurfaceKind {
        self.root
            .find_surface(self.focused)
            .expect("focused pane must always exist")
    }

    /// The surface shown in a specific pane, if it exists (used by zoom/maximize).
    pub fn surface_at(&self, id: PaneId) -> Option<&SurfaceKind> {
        self.root.find_surface(id)
    }

    /// Split the focused pane along `dir`, placing `surface` in the new pane and
    /// moving focus to it. If the focused pane already sits inside a split of
    /// the same orientation, the new pane is appended as a sibling (an even
    /// 3-way split) rather than nesting — this is what keeps deep layouts clean.
    /// Returns the new pane's id.
    pub fn split(&mut self, dir: Dir, surface: SurfaceKind) -> PaneId {
        let new_id = self.next_id;
        self.next_id += 1;
        let target = self.focused;

        // Root-is-the-focused-leaf: wrap the root in a new split.
        if let Node::Leaf { id, .. } = &self.root {
            if *id == target {
                let old = std::mem::replace(&mut self.root, Node::leaf(0, SurfaceKind::Roadmap));
                self.root = Node::Split {
                    dir,
                    children: vec![
                        Child {
                            weight: 1.0,
                            node: old,
                        },
                        Child {
                            weight: 1.0,
                            node: Node::leaf(new_id, surface),
                        },
                    ],
                };
                self.focused = new_id;
                return new_id;
            }
        }

        split_in(&mut self.root, target, dir, new_id, surface);
        self.focused = new_id;
        new_id
    }

    /// Close the focused pane and merge the space back into its siblings. A
    /// split left with a single child collapses into that child. Focus moves to
    /// the nearest remaining pane. Closing the last pane is a no-op (a workspace
    /// always has at least one pane).
    pub fn close(&mut self) -> bool {
        let leaves = self.leaves();
        if leaves.len() <= 1 {
            return false;
        }
        // Pick the focus successor before we mutate the tree.
        let idx = leaves.iter().position(|&l| l == self.focused).unwrap_or(0);
        let successor = leaves[if idx + 1 < leaves.len() {
            idx + 1
        } else {
            idx - 1
        }];

        let target = self.focused;
        remove_leaf(&mut self.root, target);
        collapse(&mut self.root);

        // Successor may have been collapsed away only if it equaled target,
        // which can't happen; it is guaranteed to still exist.
        self.focused = successor;
        true
    }

    /// Move focus to the next pane in reading order (wraps).
    pub fn focus_next(&mut self) {
        self.step_focus(1);
    }

    /// Move focus to the previous pane in reading order (wraps).
    pub fn focus_prev(&mut self) {
        self.step_focus(-1);
    }

    fn step_focus(&mut self, delta: isize) {
        let leaves = self.leaves();
        let n = leaves.len() as isize;
        let idx = leaves.iter().position(|&l| l == self.focused).unwrap_or(0) as isize;
        let next = ((idx + delta) % n + n) % n;
        self.focused = leaves[next as usize];
    }

    /// Focus a specific pane id if it exists.
    pub fn focus(&mut self, id: PaneId) -> bool {
        if self.leaves().contains(&id) {
            self.focused = id;
            true
        } else {
            false
        }
    }

    /// Swap the surface shown in the focused pane — the core "hop context" verb.
    pub fn swap_surface(&mut self, surface: SurfaceKind) {
        if let Some(s) = self.root.find_surface_mut(self.focused) {
            *s = surface;
        }
    }

    /// Rebind the entity of the focused pane's surface without changing its kind
    /// (e.g. point the transcript at a different agent, or the filetree at a
    /// different worktree). No-op if the kind has no entity to bind.
    pub fn bind_entity(&mut self, entity: Option<String>) {
        if let Some(s) = self.root.find_surface_mut(self.focused) {
            match s {
                SurfaceKind::AgentTranscript { agent_id } => *agent_id = entity,
                SurfaceKind::FileTree { root } => *root = entity,
                // Rebind the Editor onto a different file. `None` clears the host
                // (the pane keeps its kind but shows an empty/error face). Rebinding
                // the path resets `region` — a different file's spans are unrelated.
                SurfaceKind::Editor { path, region } => {
                    *path = entity.unwrap_or_default();
                    *region = None;
                }
                _ => {}
            }
        }
    }

    /// Grow (`delta > 0`) or shrink the focused pane within its parent split by
    /// shifting flex weight to/from its immediate next sibling. `delta` is a
    /// fraction of the current weight. Returns false if the focused pane is the
    /// root (nothing to resize against).
    pub fn resize(&mut self, delta: f32) -> bool {
        resize_leaf(&mut self.root, self.focused, delta)
    }

    /// Drag-to-resize: set the boundary between child `left` and `left+1` of the
    /// split at `path` (indices from the root) to `target` — a fraction of that
    /// split's total extent along its axis. Shifts weight only within the pair.
    pub fn resize_pair(&mut self, path: &[usize], left: usize, target: f32) -> bool {
        resize_pair_in(&mut self.root, path, left, target)
    }

    /// Reparent the leaf `from` relative to the leaf `target` — the keystone
    /// "snap-drag" verb (also the future keyboard "move pane" verb). An `edge`
    /// of Left/Right/Top/Bottom removes `from` from its parent (collapsing any
    /// degenerate split it leaves behind, exactly like [`close`](Self::close)),
    /// then re-inserts it beside `target` on that side, splitting the target's
    /// slot in the induced orientation. `Center` swaps the two panes' surfaces
    /// in place, leaving the layout untouched.
    ///
    /// The moved leaf keeps its [`PaneId`] (it is the *same* owned subtree,
    /// relocated via [`std::mem::replace`], not a re-created leaf), and every
    /// untouched leaf keeps its id. Incoherent moves are rejected with a
    /// matchable [`MoveError`]; on success focus follows the dragged content.
    ///
    /// GPUI-free — unit-tested without a window. This runs once at mouse-release
    /// (drop time), so it favors readable tree surgery over micro-optimization.
    pub fn move_leaf(&mut self, from: PaneId, target: PaneId, edge: DropEdge) -> Result<(), MoveError> {
        if from == target {
            return Err(MoveError::SamePane);
        }
        let leaves = self.leaves();
        if !leaves.contains(&from) {
            return Err(MoveError::FromNotFound);
        }
        if !leaves.contains(&target) {
            return Err(MoveError::TargetNotFound);
        }

        let dir = match edge.orientation() {
            // Center: swap surfaces in place. Focus follows the dragged content
            // to its new home (the `target` leaf now shows what `from` carried).
            None => {
                swap_surfaces(&mut self.root, from, target);
                self.focused = target;
                return Ok(());
            }
            Some(d) => d,
        };

        // Excise the dragged leaf as an owned subtree (preserving its PaneId),
        // then let its former parent collapse so no empty/one-way split remains.
        let moved = take_leaf(&mut self.root, from).expect("from validated as a leaf above");
        collapse(&mut self.root);

        let before = edge.before();

        // The collapse may have left `target` as the lone root leaf — wrap it.
        if matches!(&self.root, Node::Leaf { id, .. } if *id == target) {
            let keep = std::mem::replace(&mut self.root, Node::leaf(0, SurfaceKind::Roadmap));
            let moved_child = Child { weight: 1.0, node: moved };
            let keep_child = Child { weight: 1.0, node: keep };
            let children = if before {
                vec![moved_child, keep_child]
            } else {
                vec![keep_child, moved_child]
            };
            self.root = Node::Split { dir, children };
            self.focused = from;
            return Ok(());
        }

        insert_beside(&mut self.root, target, dir, before, moved)
            .expect("target validated to exist and survives the collapse");
        self.focused = from;
        Ok(())
    }
}

/// Drop every entry in a per-pane cache whose id is no longer a live leaf.
///
/// The GPUI shell (`app.rs`) keeps a per-frame `leaf_bounds` cache
/// (`PaneId` → screen `Bounds<Pixels>`) that mouse-drag hit-testing scans on
/// every pointer move. That cache is populated by rendering, but nothing ever
/// removed an entry when its pane closed — the tree operations here
/// (`Workspace::close`, tab close) live in this GPUI-free module and have no
/// reach into the GPUI-side cache. Left unpruned, a closed pane's bounds
/// linger forever; because the hit-test iterates the whole cache, a stale
/// entry can nondeterministically win and hand back a drop target for a pane
/// that no longer exists — a ghost flicker, and the resulting drop is a
/// silent no-op since the target is gone.
///
/// `V` is generic (the GPUI value type isn't available in this dependency-free
/// module) so the exact retention logic used in production is exercised
/// directly by this module's headless test suite below, not reimplemented.
pub fn retain_live_panes<V>(cache: &mut HashMap<PaneId, V>, live_leaves: &[PaneId]) {
    let live: HashSet<PaneId> = live_leaves.iter().copied().collect();
    cache.retain(|id, _| live.contains(id));
}

/// The console's first-screen workspace. Deep-linked panes are user experiences,
/// so an explicit initial surface opens as a single full workspace; the no-arg
/// launch keeps the overview layout.
pub fn default_operator_workspace(initial: Option<SurfaceKind>) -> Workspace {
    if let Some(surface) = initial {
        return Workspace::new(surface);
    }

    let mut ws = Workspace::new(SurfaceKind::Fleet);
    ws.split(Dir::Row, SurfaceKind::AgentTranscript { agent_id: None }); // fleet | lane
    ws.split(Dir::Col, SurfaceKind::Roadmap); // lane / roadmap
    ws.focus(1); // start on the fleet pane (first leaf id)
    ws
}

// ── Recursive tree surgery (free fns keep the borrow checker happy) ──────────

/// Replace the focused leaf with a split, or append to a same-orientation parent.
fn split_in(
    node: &mut Node,
    target: PaneId,
    dir: Dir,
    new_id: PaneId,
    surface: SurfaceKind,
) -> bool {
    if let Node::Split {
        dir: sdir,
        children,
    } = node
    {
        // Does this split directly contain the focused leaf?
        if let Some(pos) = children
            .iter()
            .position(|c| matches!(&c.node, Node::Leaf { id, .. } if *id == target))
        {
            if *sdir == dir {
                // Same orientation → append as an even sibling.
                let avg = children.iter().map(|c| c.weight).sum::<f32>() / children.len() as f32;
                children.insert(
                    pos + 1,
                    Child {
                        weight: avg,
                        node: Node::leaf(new_id, surface),
                    },
                );
            } else {
                // Cross orientation → wrap that one child in a nested split.
                let old =
                    std::mem::replace(&mut children[pos].node, Node::leaf(0, SurfaceKind::Roadmap));
                children[pos].node = Node::Split {
                    dir,
                    children: vec![
                        Child {
                            weight: 1.0,
                            node: old,
                        },
                        Child {
                            weight: 1.0,
                            node: Node::leaf(new_id, surface),
                        },
                    ],
                };
            }
            return true;
        }
        // Otherwise recurse.
        for c in children.iter_mut() {
            if split_in(&mut c.node, target, dir, new_id, surface.clone()) {
                return true;
            }
        }
    }
    false
}

/// Remove the leaf with `target` from wherever it lives in the tree.
fn remove_leaf(node: &mut Node, target: PaneId) -> bool {
    if let Node::Split { children, .. } = node {
        if let Some(pos) = children
            .iter()
            .position(|c| matches!(&c.node, Node::Leaf { id, .. } if *id == target))
        {
            children.remove(pos);
            return true;
        }
        for c in children.iter_mut() {
            if remove_leaf(&mut c.node, target) {
                return true;
            }
        }
    }
    false
}

/// Collapse any split that has been reduced to a single child into that child,
/// bottom-up, so the tree never carries degenerate one-way splits.
fn collapse(node: &mut Node) {
    if let Node::Split { children, .. } = node {
        for c in children.iter_mut() {
            collapse(&mut c.node);
        }
        if children.len() == 1 {
            let only = children.remove(0);
            *node = only.node;
        }
    }
}

/// Shift weight between the target leaf and its next sibling within its parent.
fn resize_leaf(node: &mut Node, target: PaneId, delta: f32) -> bool {
    if let Node::Split { children, .. } = node {
        if let Some(pos) = children
            .iter()
            .position(|c| matches!(&c.node, Node::Leaf { id, .. } if *id == target))
        {
            if children.len() < 2 {
                return false;
            }
            let neighbor = if pos + 1 < children.len() {
                pos + 1
            } else {
                pos - 1
            };
            let shift = children[pos].weight * delta;
            children[pos].weight = (children[pos].weight + shift).max(0.05);
            children[neighbor].weight = (children[neighbor].weight - shift).max(0.05);
            return true;
        }
        for c in children.iter_mut() {
            if resize_leaf(&mut c.node, target, delta) {
                return true;
            }
        }
    }
    false
}

/// Walk to the split at `path` and move the boundary between children `left` and
/// `left+1` so the boundary sits at `target` (fraction of the split's total),
/// keeping the pair's combined weight constant and clamping each ≥ 0.05.
fn resize_pair_in(node: &mut Node, path: &[usize], left: usize, target: f32) -> bool {
    if path.is_empty() {
        if let Node::Split { children, .. } = node {
            if left + 1 >= children.len() {
                return false;
            }
            let total: f32 = children.iter().map(|c| c.weight).sum::<f32>().max(0.0001);
            let prefix: f32 = children[..left].iter().map(|c| c.weight).sum();
            let pair: f32 = children[left].weight + children[left + 1].weight;
            // boundary target (fraction of total) → left child's weight
            let want = (target * total - prefix).clamp(0.05, pair - 0.05);
            children[left].weight = want;
            children[left + 1].weight = pair - want;
            return true;
        }
        return false;
    }
    if let Node::Split { children, .. } = node {
        let i = path[0];
        if i < children.len() {
            return resize_pair_in(&mut children[i].node, &path[1..], left, target);
        }
    }
    false
}

/// Swap the surfaces of two existing leaves — the `Center` drop / pane swap.
/// Two `&mut` into one tree is disallowed, so we read both (a drop-time clone of
/// a small surface, never a hot path) then write them back crossed over.
fn swap_surfaces(node: &mut Node, a: PaneId, b: PaneId) {
    let sa = node.find_surface(a).cloned();
    let sb = node.find_surface(b).cloned();
    if let (Some(sa), Some(sb)) = (sa, sb) {
        if let Some(s) = node.find_surface_mut(a) {
            *s = sb;
        }
        if let Some(s) = node.find_surface_mut(b) {
            *s = sa;
        }
    }
}

/// Remove and return the leaf `target` as an owned [`Node`] from wherever it
/// lives (as a direct child of some split). `None` if not present in this
/// subtree. Preserves the leaf's [`PaneId`] — it is the same node, detached.
fn take_leaf(node: &mut Node, target: PaneId) -> Option<Node> {
    if let Node::Split { children, .. } = node {
        if let Some(pos) = children
            .iter()
            .position(|c| matches!(&c.node, Node::Leaf { id, .. } if *id == target))
        {
            return Some(children.remove(pos).node);
        }
        for c in children.iter_mut() {
            if let Some(n) = take_leaf(&mut c.node, target) {
                return Some(n);
            }
        }
    }
    None
}

/// Insert `moved` beside the leaf `target`, on the `before` side, in a split of
/// orientation `dir`: appends into a same-orientation parent (an even sibling)
/// or wraps the target child in a nested cross-orientation split. Mirrors
/// [`split_in`]'s clean-layout rule. `Err(moved)` bubbles the owned node back up
/// when `target` is not in this subtree, so no node is ever dropped on the way.
fn insert_beside(
    node: &mut Node,
    target: PaneId,
    dir: Dir,
    before: bool,
    mut moved: Node,
) -> Result<(), Node> {
    if let Node::Split { dir: sdir, children } = node {
        if let Some(pos) = children
            .iter()
            .position(|c| matches!(&c.node, Node::Leaf { id, .. } if *id == target))
        {
            if *sdir == dir {
                // Same orientation → append as an even sibling.
                let avg = children.iter().map(|c| c.weight).sum::<f32>() / children.len() as f32;
                let at = if before { pos } else { pos + 1 };
                children.insert(at, Child { weight: avg, node: moved });
            } else {
                // Cross orientation → wrap the target child in a nested split.
                let old = std::mem::replace(&mut children[pos].node, Node::leaf(0, SurfaceKind::Roadmap));
                let moved_child = Child { weight: 1.0, node: moved };
                let keep_child = Child { weight: 1.0, node: old };
                let inner = if before {
                    vec![moved_child, keep_child]
                } else {
                    vec![keep_child, moved_child]
                };
                children[pos].node = Node::Split { dir, children: inner };
            }
            return Ok(());
        }
        for c in children.iter_mut() {
            match insert_beside(&mut c.node, target, dir, before, moved) {
                Ok(()) => return Ok(()),
                Err(m) => moved = m,
            }
        }
    }
    Err(moved)
}

impl fmt::Display for Workspace {
    /// Compact ASCII rendering of the tree, for debugging and tests.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fn go(
            node: &Node,
            focused: PaneId,
            depth: usize,
            f: &mut fmt::Formatter<'_>,
        ) -> fmt::Result {
            let pad = "  ".repeat(depth);
            match node {
                Node::Leaf { id, surface } => {
                    let mark = if *id == focused { "*" } else { " " };
                    writeln!(f, "{pad}{mark}[{id}] {}", surface.label())
                }
                Node::Split { dir, children } => {
                    let d = match dir {
                        Dir::Row => "ROW",
                        Dir::Col => "COL",
                    };
                    writeln!(f, "{pad}{d}")?;
                    for c in children {
                        go(&c.node, focused, depth + 1, f)?;
                    }
                    Ok(())
                }
            }
        }
        go(&self.root, self.focused, 0, f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(id: &str) -> SurfaceKind {
        SurfaceKind::AgentTranscript {
            agent_id: Some(id.into()),
        }
    }

    #[test]
    fn new_workspace_is_one_focused_leaf() {
        let ws = Workspace::new(SurfaceKind::Roadmap);
        assert_eq!(ws.pane_count(), 1);
        assert_eq!(ws.focused_surface(), &SurfaceKind::Roadmap);
    }

    #[test]
    fn split_creates_two_panes_and_focuses_the_new_one() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        let new = ws.split(Dir::Row, agent("a1"));
        assert_eq!(ws.pane_count(), 2);
        assert_eq!(ws.focused(), new);
        assert_eq!(ws.focused_surface(), &agent("a1"));
    }

    #[test]
    fn same_orientation_split_appends_evenly_not_nests() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        ws.split(Dir::Row, agent("a1"));
        ws.split(Dir::Row, agent("a2"));
        // A single ROW split with three children — no nesting.
        match &ws.root {
            Node::Split {
                dir: Dir::Row,
                children,
            } => assert_eq!(children.len(), 3),
            other => panic!("expected a flat 3-way row, got {other:?}"),
        }
        assert_eq!(ws.pane_count(), 3);
    }

    #[test]
    fn cross_orientation_split_nests() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        ws.split(Dir::Row, agent("a1")); // now ROW[roadmap, a1], focus a1
        ws.split(Dir::Col, agent("a2")); // split a1 vertically → nested COL
        match &ws.root {
            Node::Split {
                dir: Dir::Row,
                children,
            } => {
                assert_eq!(children.len(), 2);
                assert!(matches!(
                    children[1].node,
                    Node::Split { dir: Dir::Col, .. }
                ));
            }
            other => panic!("expected nested col under row, got {other:?}"),
        }
        assert_eq!(ws.pane_count(), 3);
    }

    #[test]
    fn close_merges_and_collapses_degenerate_split() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        ws.split(Dir::Row, agent("a1")); // ROW[roadmap, *a1]
        assert!(ws.close()); // remove a1 → split collapses to lone roadmap leaf
        assert_eq!(ws.pane_count(), 1);
        assert!(matches!(ws.root, Node::Leaf { .. }));
        assert_eq!(ws.focused_surface(), &SurfaceKind::Roadmap);
    }

    #[test]
    fn cannot_close_last_pane() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        assert!(!ws.close());
        assert_eq!(ws.pane_count(), 1);
    }

    /// Regression for the review finding on PR #3140: `leaf_bounds` (the
    /// GPUI shell's per-frame pane-bounds cache used by mouse-drag
    /// hit-testing) must not keep a stale entry for a pane after it closes.
    /// A stale entry can nondeterministically win `hit_test_drop`'s scan and
    /// hand back a `DropTarget` for a pane id that no longer exists.
    ///
    /// This exercises the real `retain_live_panes` helper that `app.rs`'s
    /// `ConsoleView::prune_leaf_bounds` calls after every pane-closing
    /// action — same function, generic over the cached value type so it's
    /// testable here without GPUI's `Bounds<Pixels>`.
    #[test]
    fn retain_live_panes_drops_bounds_for_a_closed_pane() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap); // id 1
        let a1 = ws.split(Dir::Row, agent("a1")); // id 2, focused
        let a2 = ws.split(Dir::Row, agent("a2")); // id 3, focused
        assert_eq!(ws.leaves(), vec![1, a1, a2]);

        // Simulate a render pass populating the GPUI-side bounds cache for
        // every currently-live leaf (mirrors app.rs's per-frame insert).
        let mut leaf_bounds: HashMap<PaneId, (f32, f32, f32, f32)> = HashMap::new();
        for id in ws.leaves() {
            leaf_bounds.insert(id, (0.0, 0.0, 100.0, 100.0));
        }
        assert_eq!(leaf_bounds.len(), 3);

        // Close the focused pane (a2) — same op as the leader "x" key and the
        // pane-corner close button, both of which now call
        // `ConsoleView::close_focused_pane` (close + prune, in that order).
        assert!(ws.close());
        assert_eq!(ws.leaves(), vec![1, a1]);
        assert!(!ws.leaves().contains(&a2), "a2 must be gone from the tree");

        // Before the fix this cache entry would simply never be removed —
        // `retain_live_panes` is the prune step that keeps it in sync.
        retain_live_panes(&mut leaf_bounds, &ws.leaves());

        assert!(
            !leaf_bounds.contains_key(&a2),
            "closed pane a2's bounds must be pruned from the cache"
        );
        assert!(leaf_bounds.contains_key(&1) && leaf_bounds.contains_key(&a1));
        assert_eq!(leaf_bounds.len(), 2);

        // The exact bug: a hit-test that (pre-fix) scanned the whole cache
        // could still see `a2`'s bounds and resolve a drop target for a pane
        // that doesn't exist. With the cache pruned, no live scan can ever
        // produce that id again.
        assert!(
            leaf_bounds.keys().all(|id| ws.leaves().contains(id)),
            "every remaining cache entry must correspond to a live pane"
        );
    }

    #[test]
    fn focus_cycles_in_reading_order_and_wraps() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        ws.split(Dir::Row, agent("a1"));
        ws.split(Dir::Row, agent("a2")); // leaves: roadmap, a1, a2 ; focus a2
        let order = ws.leaves();
        assert_eq!(order.len(), 3);
        ws.focus_next(); // wrap to first
        assert_eq!(ws.focused(), order[0]);
        ws.focus_prev(); // back to last
        assert_eq!(ws.focused(), order[2]);
    }

    #[test]
    fn default_operator_workspace_without_initial_opens_overview() {
        let ws = default_operator_workspace(None);
        assert_eq!(ws.pane_count(), 3);
        assert!(matches!(ws.focused_surface(), SurfaceKind::Fleet));
    }

    #[test]
    fn default_operator_workspace_with_initial_opens_single_experience() {
        let ws = default_operator_workspace(Some(SurfaceKind::AgentTranscript { agent_id: None }));
        assert_eq!(ws.pane_count(), 1);
        assert!(matches!(
            ws.focused_surface(),
            SurfaceKind::AgentTranscript { agent_id: None }
        ));
    }

    #[test]
    fn swap_surface_hops_context_without_moving_layout() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        ws.split(Dir::Row, agent("a1"));
        let before = ws.pane_count();
        ws.swap_surface(SurfaceKind::CartographerChat);
        assert_eq!(ws.pane_count(), before); // layout unchanged
        assert_eq!(ws.focused_surface(), &SurfaceKind::CartographerChat);
    }

    #[test]
    fn bind_entity_repoints_transcript() {
        let mut ws = Workspace::new(agent("a1"));
        ws.bind_entity(Some("a2".into()));
        assert_eq!(ws.focused_surface(), &agent("a2"));
        ws.bind_entity(None);
        assert_eq!(
            ws.focused_surface(),
            &SurfaceKind::AgentTranscript { agent_id: None }
        );
    }

    #[test]
    fn editor_label_is_basename_only() {
        let e = SurfaceKind::Editor {
            path: "core/pd-console/src/mux.rs".into(),
            region: None,
        };
        assert_eq!(e.label(), "edit mux.rs");
        // A bare filename (no separators) labels as itself.
        let bare = SurfaceKind::Editor {
            path: "README.md".into(),
            region: Some((3, 9)),
        };
        assert_eq!(bare.label(), "edit README.md");
    }

    #[test]
    fn bind_entity_repoints_editor_and_clears_region() {
        let mut ws = Workspace::new(SurfaceKind::Editor {
            path: "a.txt".into(),
            region: Some((2, 4)),
        });
        ws.bind_entity(Some("b.txt".into()));
        assert_eq!(
            ws.focused_surface(),
            &SurfaceKind::Editor {
                path: "b.txt".into(),
                region: None
            },
            "rebinding the path resets the region — a different file's spans are unrelated",
        );
    }

    #[test]
    fn resize_shifts_weight_between_siblings() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        ws.split(Dir::Row, agent("a1"));
        assert!(ws.resize(0.5)); // grow focused (a1) by 50% of its weight
        match &ws.root {
            Node::Split { children, .. } => {
                assert!(children[1].weight > children[0].weight);
            }
            _ => panic!("expected split"),
        }
    }

    #[test]
    fn resize_root_leaf_is_noop() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        assert!(!ws.resize(0.5));
    }

    #[test]
    fn deep_layout_round_trips_through_display() {
        let mut ws = Workspace::new(SurfaceKind::Fleet);
        ws.split(Dir::Row, agent("a1"));
        ws.split(Dir::Col, SurfaceKind::Roadmap);
        ws.split(Dir::Col, SurfaceKind::CartographerChat);
        // Exercise the Display impl (used in debugging / snapshot tests).
        let rendered = format!("{ws}");
        assert!(rendered.contains("cartographer"));
        assert!(rendered.contains("ROW"));
        assert!(rendered.contains("COL"));
        // Every leaf id is unique.
        let mut ids = ws.leaves();
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), total);
    }

    #[test]
    fn resize_pair_moves_the_boundary_and_clamps() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        ws.split(Dir::Row, agent("a1")); // ROW[roadmap, a1], weights 1,1 (total 2)
                                         // Move the boundary to 0.25 of total → left weight 0.5, right 1.5.
        assert!(ws.resize_pair(&[], 0, 0.25));
        if let Node::Split { children, .. } = &ws.root {
            assert!(
                (children[0].weight - 0.5).abs() < 1e-4,
                "left {}",
                children[0].weight
            );
            assert!(
                (children[1].weight - 1.5).abs() < 1e-4,
                "right {}",
                children[1].weight
            );
        } else {
            panic!("expected a split");
        }
        // Clamp: target 0 pins the left child to the 0.05 floor (no zero panes).
        ws.resize_pair(&[], 0, 0.0);
        if let Node::Split { children, .. } = &ws.root {
            assert!(
                (children[0].weight - 0.05).abs() < 1e-4,
                "clamped {}",
                children[0].weight
            );
        }
        // Out-of-range boundary index is a no-op.
        assert!(!ws.resize_pair(&[], 5, 0.5));
    }

    // ── move_leaf (snap-drag reparent) ───────────────────────────────────────

    /// Assert the tree is well-formed: no empty or one-way (degenerate) splits,
    /// every split holds ≥ 2 children, and every leaf id is unique.
    fn assert_valid_tree(ws: &Workspace) {
        fn walk(node: &Node) {
            if let Node::Split { children, .. } = node {
                assert!(
                    children.len() >= 2,
                    "degenerate split with {} child(ren) — collapse missed it",
                    children.len()
                );
                for c in children {
                    assert!(c.weight > 0.0, "non-positive weight {}", c.weight);
                    walk(&c.node);
                }
            }
        }
        walk(&ws.root);
        let mut ids = ws.leaves();
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), total, "duplicate leaf ids: {:?}", ws.leaves());
    }

    /// Find the split orientation that directly parents a given leaf id.
    fn parent_dir(node: &Node, target: PaneId) -> Option<Dir> {
        if let Node::Split { dir, children } = node {
            if children
                .iter()
                .any(|c| matches!(&c.node, Node::Leaf { id, .. } if *id == target))
            {
                return Some(*dir);
            }
            for c in children {
                if let Some(d) = parent_dir(&c.node, target) {
                    return Some(d);
                }
            }
        }
        None
    }

    #[test]
    fn move_onto_self_is_rejected() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        let a1 = ws.split(Dir::Row, agent("a1"));
        assert_eq!(ws.move_leaf(a1, a1, DropEdge::Left), Err(MoveError::SamePane));
        assert_eq!(ws.pane_count(), 2);
    }

    #[test]
    fn move_from_unknown_pane_is_rejected() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        let target = ws.split(Dir::Row, agent("a1"));
        assert_eq!(
            ws.move_leaf(999, target, DropEdge::Right),
            Err(MoveError::FromNotFound)
        );
    }

    #[test]
    fn move_onto_unknown_target_is_rejected() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        let from = ws.split(Dir::Row, agent("a1"));
        assert_eq!(
            ws.move_leaf(from, 999, DropEdge::Right),
            Err(MoveError::TargetNotFound)
        );
    }

    #[test]
    fn center_drop_swaps_surfaces_without_moving_layout() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        let a1 = ws.split(Dir::Row, agent("a1")); // ROW[roadmap, *a1]
        let roadmap = ws.leaves()[0];
        assert!(ws.move_leaf(a1, roadmap, DropEdge::Center).is_ok());
        assert_eq!(ws.pane_count(), 2);
        // Surfaces swapped: the roadmap slot now shows a1, the a1 slot roadmap.
        assert_eq!(ws.surface_at(roadmap), Some(&agent("a1")));
        assert_eq!(ws.surface_at(a1), Some(&SurfaceKind::Roadmap));
        assert_eq!(ws.focused(), roadmap, "focus follows dragged content to target");
        assert_valid_tree(&ws);
    }

    #[test]
    fn move_left_places_dragged_before_target_in_a_row() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        let a1 = ws.split(Dir::Col, agent("a1")); // COL[roadmap, a1]
        let roadmap = ws.leaves()[0];
        // Drag a1 to the LEFT edge of roadmap → a Row with a1 before roadmap.
        assert!(ws.move_leaf(a1, roadmap, DropEdge::Left).is_ok());
        assert_eq!(ws.pane_count(), 2);
        assert_eq!(ws.leaves(), vec![a1, roadmap], "a1 sits before roadmap");
        assert_eq!(parent_dir(&ws.root, a1), Some(Dir::Row));
        assert_eq!(ws.focused(), a1);
        assert_valid_tree(&ws);
    }

    #[test]
    fn move_right_places_dragged_after_target_in_a_row() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        let a1 = ws.split(Dir::Col, agent("a1")); // COL[roadmap, a1]
        let roadmap = ws.leaves()[0];
        assert!(ws.move_leaf(a1, roadmap, DropEdge::Right).is_ok());
        assert_eq!(ws.leaves(), vec![roadmap, a1], "a1 sits after roadmap");
        assert_eq!(parent_dir(&ws.root, a1), Some(Dir::Row));
        assert_valid_tree(&ws);
    }

    #[test]
    fn move_top_creates_a_column_with_dragged_above() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        let a1 = ws.split(Dir::Row, agent("a1")); // ROW[roadmap, a1]
        let roadmap = ws.leaves()[0];
        assert!(ws.move_leaf(a1, roadmap, DropEdge::Top).is_ok());
        assert_eq!(ws.leaves(), vec![a1, roadmap], "a1 above roadmap");
        assert_eq!(parent_dir(&ws.root, a1), Some(Dir::Col));
        assert_valid_tree(&ws);
    }

    #[test]
    fn move_bottom_creates_a_column_with_dragged_below() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        let a1 = ws.split(Dir::Row, agent("a1")); // ROW[roadmap, a1]
        let roadmap = ws.leaves()[0];
        assert!(ws.move_leaf(a1, roadmap, DropEdge::Bottom).is_ok());
        assert_eq!(ws.leaves(), vec![roadmap, a1], "a1 below roadmap");
        assert_eq!(parent_dir(&ws.root, a1), Some(Dir::Col));
        assert_valid_tree(&ws);
    }

    #[test]
    fn move_into_same_orientation_appends_as_flat_sibling() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        ws.split(Dir::Row, agent("a1"));
        let a2 = ws.split(Dir::Row, agent("a2")); // flat ROW[roadmap, a1, a2]
        let roadmap = ws.leaves()[0];
        // Drop a2 to the RIGHT of roadmap → still one flat row, a2 after roadmap.
        assert!(ws.move_leaf(a2, roadmap, DropEdge::Right).is_ok());
        match &ws.root {
            Node::Split { dir: Dir::Row, children } => {
                assert_eq!(children.len(), 3, "stays a flat 3-way row, no nesting");
            }
            other => panic!("expected flat row, got {other:?}"),
        }
        assert_eq!(ws.leaves()[0], roadmap);
        assert_eq!(ws.leaves()[1], a2, "a2 reinserted right after roadmap");
        assert_valid_tree(&ws);
    }

    #[test]
    fn move_cross_orientation_nests_a_split_at_the_target() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        ws.split(Dir::Row, agent("a1"));
        let a2 = ws.split(Dir::Row, agent("a2")); // ROW[roadmap, a1, a2]
        let a1 = ws.leaves()[1];
        // Drop a2 onto the TOP of a1 → a1's slot becomes COL[a2, a1].
        assert!(ws.move_leaf(a2, a1, DropEdge::Top).is_ok());
        assert_eq!(ws.pane_count(), 3);
        assert_eq!(parent_dir(&ws.root, a1), Some(Dir::Col));
        assert_eq!(parent_dir(&ws.root, a2), Some(Dir::Col));
        assert_valid_tree(&ws);
    }

    #[test]
    fn moving_out_of_a_nested_split_collapses_the_remnant() {
        let mut ws = Workspace::new(SurfaceKind::Fleet);
        ws.split(Dir::Row, agent("a1")); // ROW[fleet, a1]
        let a2 = ws.split(Dir::Col, agent("a2")); // a1's slot → COL[a1, a2]
        let fleet = ws.leaves()[0];
        // a2 lives in a nested COL. Move it out beside fleet; the COL had exactly
        // two children, so removing a2 must collapse it back to a lone a1 leaf.
        assert!(ws.move_leaf(a2, fleet, DropEdge::Left).is_ok());
        assert_eq!(ws.pane_count(), 3);
        // No degenerate split survived the move.
        assert_valid_tree(&ws);
    }

    #[test]
    fn move_preserves_pane_count_and_all_pane_ids() {
        let mut ws = Workspace::new(SurfaceKind::Fleet);
        ws.split(Dir::Row, agent("a1"));
        ws.split(Dir::Col, agent("a2"));
        let a3 = ws.split(Dir::Col, agent("a3"));
        let before: std::collections::BTreeSet<PaneId> = ws.leaves().into_iter().collect();
        let target = ws.leaves()[0];
        assert!(ws.move_leaf(a3, target, DropEdge::Right).is_ok());
        let after: std::collections::BTreeSet<PaneId> = ws.leaves().into_iter().collect();
        assert_eq!(before, after, "every PaneId survives the move unchanged");
        assert_eq!(ws.pane_count(), 4);
        assert_valid_tree(&ws);
    }

    #[test]
    fn moved_leaf_is_still_findable_by_its_original_id() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        let a1 = ws.split(Dir::Row, agent("a1"));
        let roadmap = ws.leaves()[0];
        assert!(ws.move_leaf(a1, roadmap, DropEdge::Bottom).is_ok());
        // The moved pane keeps id `a1` AND its surface travelled with it.
        assert_eq!(ws.surface_at(a1), Some(&agent("a1")));
    }

    #[test]
    fn move_last_but_one_leaf_swapping_two_pane_order() {
        let mut ws = Workspace::new(SurfaceKind::Roadmap);
        let a1 = ws.split(Dir::Row, agent("a1")); // ROW[roadmap, a1]
        let roadmap = ws.leaves()[0];
        // Move a1 to the LEFT of roadmap: remove a1 (collapse to lone roadmap
        // root leaf), then wrap the root re-inserting a1 before it.
        assert!(ws.move_leaf(a1, roadmap, DropEdge::Left).is_ok());
        assert_eq!(ws.leaves(), vec![a1, roadmap]);
        assert_eq!(ws.pane_count(), 2);
        assert_valid_tree(&ws);
    }

    #[test]
    fn repeated_moves_keep_the_tree_valid() {
        let mut ws = Workspace::new(SurfaceKind::Fleet);
        ws.split(Dir::Row, agent("a1"));
        ws.split(Dir::Col, agent("a2"));
        ws.split(Dir::Row, agent("a3"));
        let ids = ws.leaves();
        // A little churn: move several panes around various edges.
        assert!(ws.move_leaf(ids[3], ids[0], DropEdge::Bottom).is_ok());
        assert_valid_tree(&ws);
        assert!(ws.move_leaf(ids[1], ids[2], DropEdge::Center).is_ok());
        assert_valid_tree(&ws);
        assert!(ws.move_leaf(ids[0], ids[2], DropEdge::Right).is_ok());
        assert_valid_tree(&ws);
        assert_eq!(ws.pane_count(), 4, "churn never adds or drops a pane");
    }

    #[test]
    fn dropedge_orientation_and_side_mapping() {
        assert_eq!(DropEdge::Left.orientation(), Some(Dir::Row));
        assert_eq!(DropEdge::Right.orientation(), Some(Dir::Row));
        assert_eq!(DropEdge::Top.orientation(), Some(Dir::Col));
        assert_eq!(DropEdge::Bottom.orientation(), Some(Dir::Col));
        assert_eq!(DropEdge::Center.orientation(), None);
        assert!(DropEdge::Left.before() && DropEdge::Top.before());
        assert!(!DropEdge::Right.before() && !DropEdge::Bottom.before());
    }
}
