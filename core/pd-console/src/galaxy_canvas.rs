//! Sextant's interactive GPUI canvas — the RENDER half of the
//! two-layer rule. Every coordinate the map paints was precomputed by the
//! daemon and parsed/hit-tested in the gpui-free `galaxy_pane` engine (which
//! the headless REPL bin gates in CI); this module only places absolute point
//! elements, wires mouse listeners, and paints the selection/detail chrome.
//! Kept out of the 6000-line `app.rs` on purpose (editor-churn risk) — app.rs
//! carries only thin state fields and the root-level drag arms.

use crate::app::{current_theme, motion, render_block, ConsoleView, FlagMotion};
use crate::galaxy_pane as gp;
use crate::mux::PaneId;
use crate::palette::Theme;
use crate::pane::Block;
use crate::tokens;
use gpui::prelude::*;
use gpui::*;

/// The shared cluster→color contract: `clusterId % 8` into the SAME order as
/// fleet-ui's CLUSTER_COLORS — accent, engaged, gated, resting, landed,
/// conflicted, alarm, muted — all resolved from the live theme (no hex here).
fn cluster_color(t: &Theme, cluster_id: usize) -> u32 {
    match cluster_id % 8 {
        0 => t.accent,
        1 => t.engaged,
        2 => t.gated,
        3 => t.resting,
        4 => t.landed,
        5 => t.conflict,
        6 => t.mayday,
        _ => t.muted,
    }
}

/// A faint wash of `color` at `alpha` (0x00-0xff) for chip/overlay backgrounds.
fn wash(color: u32, alpha: u8) -> Rgba {
    rgba((color << 8) | alpha as u32)
}

fn camera_button(id: &'static str, label: &'static str, t: &Theme) -> Stateful<Div> {
    div()
        .id(id)
        .min_w(px(28.0))
        .h(px(26.0))
        .px(px(7.0))
        .rounded(px(tokens::RADIUS_SM))
        .border_1()
        .border_color(rgb(t.line))
        .bg(wash(t.raised, 0xe8))
        .flex()
        .items_center()
        .justify_center()
        .text_size(px(tokens::TEXT_BODY))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(rgb(t.ink))
        .cursor_pointer()
        .hover(|s| {
            let t = current_theme();
            s.border_color(rgb(t.accent)).bg(rgb(t.panel))
        })
        .child(label)
}

fn camera_toolbar(view: &ConsoleView, t: &Theme, cx: &mut Context<ConsoleView>) -> AnyElement {
    div()
        .absolute()
        .top(px(tokens::SPACE_2))
        .right(px(tokens::SPACE_2))
        .px(px(tokens::SPACE_1))
        .py(px(tokens::SPACE_1))
        .rounded(px(tokens::RADIUS_MD))
        .border_1()
        .border_color(rgb(t.line))
        .bg(wash(t.bg, 0xf0))
        .flex()
        .items_center()
        .gap(px(tokens::SPACE_1))
        .occlude()
        .child(
            div()
                .min_w(px(44.0))
                .text_align(TextAlign::Center)
                .text_size(px(tokens::TEXT_CAPTION))
                .font_family("IBM Plex Mono")
                .text_color(rgb(t.muted))
                .child(format!("{:.0}%", view.galaxy_viewport.zoom * 100.0)),
        )
        .child(
            camera_button("galaxy-zoom-out", "-", t).on_click(cx.listener(
                |this, _ev, _window, cx| {
                    this.galaxy_zoom_center(1.0 / 1.22);
                    crate::audio::play(crate::audio::Cue::Tick);
                    cx.notify();
                },
            )),
        )
        .child(
            camera_button("galaxy-zoom-in", "+", t).on_click(cx.listener(
                |this, _ev, _window, cx| {
                    this.galaxy_zoom_center(1.22);
                    crate::audio::play(crate::audio::Cue::Tick);
                    cx.notify();
                },
            )),
        )
        .child(camera_button("galaxy-fit", "Fit", t).on_click(cx.listener(
            |this, _ev, _window, cx| {
                this.galaxy_fit_view();
                crate::audio::play(crate::audio::Cue::Tick);
                cx.notify();
            },
        )))
        .child(
            camera_button("galaxy-reset", "Reset", t).on_click(cx.listener(
                |this, _ev, _window, cx| {
                    this.galaxy_reset_view();
                    crate::audio::play(crate::audio::Cue::Tick);
                    cx.notify();
                },
            )),
        )
        .into_any_element()
}

/// Render the whole Sextant surface body: eyebrow + meta, the interactive map,
/// the hover readout strip, the selection/parley bar, and the detail drawer.
pub(crate) fn render_galaxy(
    view: &ConsoleView,
    pane_id: PaneId,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let t = current_theme();
    let snapshot = &view.galaxy;
    let selected_count = snapshot
        .points
        .iter()
        .filter(|p| view.galaxy_selected.contains(&p.id))
        .count();
    let parties = gp::distinct_agents(&snapshot.points, &view.galaxy_selected);
    let session_ids = gp::distinct_sessions(&snapshot.points, &view.galaxy_selected);
    let hover_point = view
        .galaxy_hover
        .as_ref()
        .and_then(|h| snapshot.points.iter().find(|p| &p.id == h));

    let base_meta = format!(
        "{} session(s)  \u{00b7}  {} cluster(s)",
        snapshot.points.len(),
        snapshot.clusters.len(),
    );
    let computed_meta = snapshot
        .computed_at
        .map(|at| format!("  \u{00b7}  computed {}", crate::util::age_short(at)))
        .unwrap_or_default();

    let mut root = div()
        .flex()
        .flex_col()
        .gap(px(tokens::SPACE_2))
        .px(px(tokens::SPACE_3))
        .pt(px(tokens::SPACE_3))
        .pb(px(tokens::SPACE_2))
        // Eyebrow (the allowed 12px exception: uppercase, ≥600 weight).
        .child(
            div()
                .text_size(px(tokens::TEXT_EYEBROW))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(t.accent_ink))
                .child("SEXTANT \u{00b7} SESSION ORIENTATION MAP"),
        )
        .child(meta_row(snapshot, &base_meta, &computed_meta, &t, cx));

    if let Some(err) = &snapshot.last_error {
        root = root.child(
            div()
                .px(px(tokens::SPACE_3))
                .py(px(tokens::SPACE_2))
                .rounded(px(tokens::RADIUS_MD))
                .border_1()
                .border_color(rgb(t.gated))
                .bg(wash(t.gated, 0x1c))
                .text_size(px(tokens::TEXT_BODY))
                .text_color(rgb(t.gated))
                .child(err.clone()),
        );
        // Degrade gracefully against an older daemon: the error is the surface.
        return root.into_any_element();
    }

    if snapshot.points.is_empty() {
        return root
            .child(
                div()
                    .w_full()
                    .h(px(220.0))
                    .rounded(px(tokens::RADIUS_LG))
                    .border_1()
                    .border_color(rgb(t.line))
                    .bg(rgb(t.raised))
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(tokens::SPACE_2))
                    .child(
                        div()
                            .text_size(px(tokens::TEXT_BODY_LG))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(rgb(t.accent_ink))
                            .child("no sessions in the window"),
                    )
                    .child(
                        div()
                            .text_size(px(tokens::TEXT_BODY))
                            .text_color(rgb(t.muted))
                            .child("fleet ships and harnessed agents appear here as they run"),
                    ),
            )
            .into_any_element();
    }

    root = root
        .child(galaxy_map(view, pane_id, &t, cx))
        .child(hover_strip(
            hover_point,
            &snapshot.clusters,
            snapshot.cluster,
            &t,
        ))
        .child(selection_bar(
            selected_count,
            &parties,
            session_ids.len(),
            &t,
            cx,
        ));

    if let Some(reason) = &view.galaxy_detail_error {
        root = root.child(
            div()
                .px(px(tokens::SPACE_3))
                .py(px(tokens::SPACE_2))
                .rounded(px(tokens::RADIUS_MD))
                .border_1()
                .border_color(rgb(t.gated))
                .bg(wash(t.gated, 0x1c))
                .text_size(px(tokens::TEXT_BODY))
                .text_color(rgb(t.gated))
                .child(format!("session detail failed: {reason}")),
        );
    }
    if let Some(detail) = &view.galaxy_detail {
        root = root.child(detail_drawer(pane_id, detail, &t, cx));
    }

    root.into_any_element()
}

/// The header's meta line: static session/cluster counts + an inline window
/// selector + clustering toggle. The window selector is deliberately not a
/// dropdown: GPUI 0.2.2 paints this pane's scatter plot as an occluding relative
/// surface, and a menu-shaped child here can visually disappear under the map.
/// Inline choices keep the operator in the flow and avoid a fourth layer owner.
fn meta_row(
    snapshot: &gp::GalaxySnapshot,
    base_meta: &str,
    computed_meta: &str,
    t: &Theme,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(px(tokens::SPACE_1))
        .text_size(px(tokens::TEXT_BODY))
        .font_family("IBM Plex Mono")
        .child(div().text_color(rgb(t.muted)).child(base_meta.to_string()))
        .child(
            div()
                .text_color(rgb(t.muted))
                .child("  \u{00b7}  ".to_string()),
        )
        .child(window_selector(snapshot.window_hours, t, cx))
        .child(
            div()
                .text_color(rgb(t.muted))
                .child("  \u{00b7}  ".to_string()),
        )
        .child(
            div()
                .id("galaxy-cluster-chip")
                .cursor_pointer()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(if snapshot.cluster { t.engaged } else { t.muted }))
                .hover(|s| s.text_color(rgb(current_theme().accent)))
                .child(if snapshot.cluster {
                    "clustering on"
                } else {
                    "clustering off"
                })
                .on_click(cx.listener(|this, _ev, _window, cx| {
                    this.toggle_galaxy_cluster();
                    crate::audio::play(crate::audio::Cue::Tick);
                    cx.notify();
                })),
        )
        .child(
            div()
                .text_color(rgb(t.muted))
                .child(computed_meta.to_string()),
        )
        .into_any_element()
}

fn window_selector(active_hours: u32, t: &Theme, cx: &mut Context<ConsoleView>) -> AnyElement {
    let mut row = div()
        .id("sextant-window-choices")
        .flex()
        .items_center()
        .gap(px(2.0))
        .rounded(px(tokens::RADIUS_MD))
        .border_1()
        .border_color(rgb(t.line))
        .bg(rgb(t.panel))
        .p(px(2.0))
        .child(
            div()
                .px(px(tokens::SPACE_1))
                .text_size(px(tokens::TEXT_CAPTION))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(t.muted))
                .child("window"),
        );

    for (hours, label) in [(24_u32, "24h"), (72, "3d"), (168, "7d"), (720, "30d")] {
        let selected = active_hours == hours;
        row = row.child(
            div()
                .id(SharedString::from(format!("sextant-window-{hours}h")))
                .min_w(px(32.0))
                .h(px(24.0))
                .px(px(tokens::SPACE_1))
                .rounded(px(tokens::RADIUS_SM))
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(tokens::TEXT_CAPTION))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(if selected { t.bg } else { t.ink2 }))
                .bg(if selected {
                    rgb(t.accent)
                } else {
                    rgba(0x00000000)
                })
                .cursor_pointer()
                .hover(|s| {
                    let t = current_theme();
                    s.text_color(rgb(if selected { t.bg } else { t.accent_ink }))
                        .bg(if selected {
                            rgb(t.accent)
                        } else {
                            rgb(t.raised)
                        })
                })
                .child(label)
                .on_click(cx.listener(move |this, _ev, _window, cx| {
                    this.set_galaxy_window(hours);
                    crate::audio::play(crate::audio::Cue::Tick);
                    cx.notify();
                })),
        );
    }

    row.into_any_element()
}

/// The scatter map itself: a relative container whose laid-out bounds a canvas
/// prepaint captures (the split_bounds pattern), cluster labels at their
/// centroids, one absolute element per point, and the live marquee overlay.
fn galaxy_map(
    view: &ConsoleView,
    pane_id: PaneId,
    t: &Theme,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let bounds_cell = view.galaxy_bounds.clone();
    let viewport = view.galaxy_viewport;
    let mut map = div()
        .id(SharedString::from(format!("galaxy-map-{pane_id}")))
        .relative()
        .w_full()
        .h(px(440.0))
        .rounded(px(tokens::RADIUS_LG))
        .border_1()
        .border_color(rgb(t.line))
        .bg(rgb(t.bg))
        .overflow_hidden()
        // Bounds capture — one frame stale is fine at the 500ms drain cadence.
        .child(
            canvas(
                move |bounds: Bounds<Pixels>, _window, _cx| {
                    *bounds_cell.borrow_mut() = Some(bounds);
                },
                |_bounds, _prepaint, _window, _cx| {},
            )
            .absolute()
            .size_full(),
        )
        // A press on empty map space arms the rectangle select; point elements
        // stop propagation first (the launcher-scrim ordering trap), so this
        // never fires for a press ON a point.
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(|this, ev: &MouseDownEvent, _window, cx| {
                this.galaxy_drag = Some((ev.position, ev.position));
                cx.notify();
            }),
        )
        .on_mouse_down(
            MouseButton::Right,
            cx.listener(|this, ev: &MouseDownEvent, _window, cx| {
                this.begin_galaxy_pan(ev.position);
                cx.stop_propagation();
                cx.notify();
            }),
        )
        .on_mouse_down(
            MouseButton::Middle,
            cx.listener(|this, ev: &MouseDownEvent, _window, cx| {
                this.begin_galaxy_pan(ev.position);
                cx.stop_propagation();
                cx.notify();
            }),
        )
        .on_scroll_wheel(cx.listener(|this, ev: &ScrollWheelEvent, _window, cx| {
            let dy = match ev.delta {
                ScrollDelta::Pixels(p) => f32::from(p.y),
                ScrollDelta::Lines(p) => p.y * 18.0,
            };
            if dy.abs() < 0.01 {
                return;
            }
            let factor = if dy < 0.0 { 1.14 } else { 1.0 / 1.14 };
            this.galaxy_zoom_at_position(ev.position, factor);
            cx.stop_propagation();
            cx.notify();
        }))
        // Hover readout: the nearest point within ~3.5% of normalized map space
        // (pure math in galaxy_pane, so the REPL bin gates it).
        .on_mouse_move(cx.listener(|this, ev: &MouseMoveEvent, _window, cx| {
            if this.galaxy_drag.is_some() || this.galaxy_pan.is_some() {
                return; // the root handler owns live marquee/pan updates
            }
            let Some(b) = *this.galaxy_bounds.borrow() else {
                return;
            };
            let vx = (f32::from(ev.position.x) - f32::from(b.origin.x))
                / f32::from(b.size.width).max(1.0);
            let vy = (f32::from(ev.position.y) - f32::from(b.origin.y))
                / f32::from(b.size.height).max(1.0);
            let (nx, ny) = this.galaxy_viewport.view_to_world(vx, vy);
            let radius = 0.035 / this.galaxy_viewport.zoom.max(1.0);
            let hover =
                gp::nearest_point(&this.galaxy.points, nx, ny, radius).map(|p| p.id.clone());
            if hover != this.galaxy_hover {
                this.galaxy_hover = hover;
                cx.notify();
            }
        }));

    // Cluster labels sit UNDER the points (painted first) at their centroids
    // — skipped entirely when clustering is off (defensive: even if the
    // daemon still sent some, "no centroid labels" is this toggle's contract).
    if view.galaxy.cluster {
        for cluster in &view.galaxy.clusters {
            let color = cluster_color(t, cluster.id);
            let (x, y) = viewport.world_to_view(cluster.cx, cluster.cy);
            map = map.child(
                div()
                    .absolute()
                    .left(relative(x))
                    .top(relative(y))
                    .ml(px(8.0))
                    .mt(px(-8.0))
                    .text_size(px(tokens::TEXT_CAPTION))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(wash(color, 0xb8))
                    .child(crate::util::trunc(&cluster.label, 40)),
            );
        }
    }

    // The points — daemon-normalized [0,1] coords placed as parent fractions.
    // Clustering off ⇒ one neutral tone for every point, regardless of
    // whatever `cluster_id` the response still carries.
    for point_data in &view.galaxy.points {
        let color = if view.galaxy.cluster {
            cluster_color(t, point_data.cluster_id)
        } else {
            t.ink2
        };
        let is_selected = view.galaxy_selected.contains(&point_data.id);
        let is_hovered = view.galaxy_hover.as_deref() == Some(point_data.id.as_str());
        let size = if is_selected || is_hovered { 13.0 } else { 9.0 };
        let pid = point_data.id.clone();
        let (x, y) = viewport.world_to_view(point_data.x, point_data.y);
        map = map.child(
            div()
                .id(SharedString::from(format!("galaxy-pt-{}", point_data.id)))
                .absolute()
                .left(relative(x))
                .top(relative(y))
                .ml(px(-size / 2.0))
                .mt(px(-size / 2.0))
                .w(px(size))
                .h(px(size))
                .rounded(px(size)) // full circle
                .bg(rgb(color))
                .cursor_pointer()
                // Selected points ring in theme ink (the shared contract).
                .when(is_selected, |s| {
                    s.border_2()
                        .border_color(rgb(t.ink))
                        .shadow(motion::glow(color, 0.55, 10.0, 1.0))
                })
                .when(is_hovered && !is_selected, |s| {
                    s.shadow(motion::glow(color, 0.40, 8.0, 0.0))
                })
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, ev: &MouseDownEvent, _window, cx| {
                        if ev.modifiers.platform {
                            // ⌘-click: toggle membership, keep the rest.
                            if !this.galaxy_selected.insert(pid.clone()) {
                                this.galaxy_selected.remove(&pid);
                            }
                        } else {
                            // Plain click: select this one + open its detail.
                            this.galaxy_selected.clear();
                            this.galaxy_selected.insert(pid.clone());
                            this.request_galaxy_detail(pid.clone());
                        }
                        crate::audio::play(crate::audio::Cue::Tick);
                        // A point press is a selection, never a marquee arm:
                        // stop the map/root mouse-down handlers (the
                        // launcher-scrim ordering trap, solved the same way).
                        cx.stop_propagation();
                        cx.notify();
                    }),
                ),
        );
    }

    map = map.child(camera_toolbar(view, t, cx));

    // The live marquee overlay (theme accent at low alpha). NOT occluded — an
    // occluding overlay under the cursor would block the ROOT's mouse-move
    // hitbox and stall its own drag updates.
    if let (Some((start, end)), Some(b)) = (view.galaxy_drag, *view.galaxy_bounds.borrow()) {
        let (sx, sy) = (f32::from(start.x), f32::from(start.y));
        let (ex, ey) = (f32::from(end.x), f32::from(end.y));
        let left = sx.min(ex) - f32::from(b.origin.x);
        let top = sy.min(ey) - f32::from(b.origin.y);
        map = map.child(
            div()
                .absolute()
                .left(px(left))
                .top(px(top))
                .w(px((sx - ex).abs()))
                .h(px((sy - ey).abs()))
                .rounded(px(tokens::RADIUS_SM))
                .border_1()
                .border_color(rgb(t.accent))
                .bg(wash(t.accent, 0x2e)),
        );
    }

    map.into_any_element()
}

/// The fixed hover readout — a descriptor strip under the map (min-height so
/// the layout never jumps as hover flickers), all text ≥ the 14px body floor.
fn hover_strip(
    hover: Option<&gp::GalaxyPoint>,
    clusters: &[gp::GalaxyCluster],
    clustering: bool,
    t: &Theme,
) -> AnyElement {
    let strip = div()
        .min_h(px(56.0))
        .px(px(tokens::SPACE_3))
        .py(px(tokens::SPACE_2))
        .rounded(px(tokens::RADIUS_MD))
        .border_1()
        .border_color(rgb(t.line))
        .bg(rgb(t.raised))
        .flex()
        .flex_col()
        .gap(px(2.0));
    match hover {
        None => strip
            .justify_center()
            .child(
                div()
                    .text_size(px(tokens::TEXT_BODY))
                    .text_color(rgb(t.muted))
                    .child(
                        "hover a point for detail \u{00b7} click to open a session \u{00b7} \
                         drag a rectangle or \u{2318}-click to multi-select",
                    ),
            )
            .into_any_element(),
        Some(p) => {
            let color = if clustering {
                cluster_color(t, p.cluster_id)
            } else {
                t.ink2
            };
            let cluster_label = if clustering {
                clusters
                    .iter()
                    .find(|c| c.id == p.cluster_id)
                    .map(|c| c.label.clone())
                    .unwrap_or_default()
            } else {
                String::new()
            };
            let head = p
                .purpose
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "(no purpose recorded)".to_string());
            let mut meta_parts = vec![p.agent_id.clone(), p.status.clone()];
            if let Some(session_id) = &p.session_id {
                meta_parts.push(format!("session {session_id}"));
            }
            if let Some(ship) = &p.ship {
                meta_parts.push(ship.clone());
            }
            if let Some(project) = &p.project {
                meta_parts.push(project.clone());
            }
            if !cluster_label.is_empty() {
                meta_parts.push(cluster_label);
            }
            if let Some(pr) = p.pr_number {
                meta_parts.push(format!("PR #{pr}"));
            }
            meta_parts.push(format!("~{} tokens", p.tail_tokens));
            strip
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(tokens::SPACE_2))
                        .child(
                            div()
                                .w(px(10.0))
                                .h(px(10.0))
                                .rounded(px(10.0))
                                .bg(rgb(color)),
                        )
                        .child(
                            div()
                                .text_size(px(tokens::TEXT_BODY))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(rgb(t.ink))
                                .child(crate::util::trunc(&head, 96)),
                        ),
                )
                .child(
                    div()
                        .text_size(px(tokens::TEXT_BODY))
                        .text_color(rgb(t.muted))
                        .font_family("IBM Plex Mono")
                        .child(crate::util::trunc(
                            &meta_parts
                                .into_iter()
                                .filter(|s| !s.is_empty())
                                .collect::<Vec<_>>()
                                .join(" \u{00b7} "),
                            140,
                        )),
                )
                .when(!p.snippet.is_empty(), |s| {
                    s.child(
                        div()
                            .text_size(px(tokens::TEXT_BODY))
                            .text_color(rgb(t.ink2))
                            .child(format!(
                                "\u{201c}{}\u{201d}",
                                crate::util::trunc(&p.snippet, 140)
                            )),
                    )
                })
                .into_any_element()
        }
    }
}

/// The selection bar: count + actor-hint chips + Clear + Initiate parley.
/// The chips remain useful labels, but durable session ids are the only manual
/// participant authority sent to the daemon.
fn selection_bar(
    selected_count: usize,
    parties: &[String],
    session_count: usize,
    t: &Theme,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let can_parley = session_count >= 2;
    let mut bar = div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(px(tokens::SPACE_2))
        .px(px(tokens::SPACE_3))
        .py(px(tokens::SPACE_2))
        .rounded(px(tokens::RADIUS_MD))
        .border_1()
        .border_color(rgb(t.line))
        .bg(rgb(t.panel))
        .child(
            div()
                .text_size(px(tokens::TEXT_BODY))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(t.ink))
                .child(format!(
                    "{selected_count} selected \u{00b7} {session_count} attributable session(s)",
                )),
        );

    for agent in parties.iter().take(6) {
        bar = bar.child(
            div()
                .px(px(tokens::SPACE_2))
                .py(px(2.0))
                .rounded(px(tokens::RADIUS_SM))
                .bg(wash(t.engaged, 0x24))
                .text_size(px(tokens::TEXT_CAPTION))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(t.engaged))
                .font_family("IBM Plex Mono")
                .child(crate::util::trunc(agent, 22)),
        );
    }
    if parties.len() > 6 {
        bar = bar.child(
            div()
                .text_size(px(tokens::TEXT_CAPTION))
                .text_color(rgb(t.muted))
                .child(format!("+{} more", parties.len() - 6)),
        );
    }

    bar = bar.child(div().flex_1());

    if selected_count > 0 {
        bar = bar.child(
            div()
                .id("galaxy-clear-selection")
                .px(px(tokens::SPACE_3))
                .py(px(tokens::SPACE_1))
                .rounded(px(tokens::RADIUS_MD))
                .border_1()
                .border_color(rgb(t.line))
                .text_size(px(tokens::TEXT_BODY))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(t.ink2))
                .cursor_pointer()
                .hover(|s| {
                    let t = current_theme();
                    s.border_color(rgb(t.accent)).text_color(rgb(t.accent_ink))
                })
                .child("Clear")
                .on_click(cx.listener(|this, _ev, _window, cx| {
                    this.galaxy_selected.clear();
                    cx.notify();
                })),
        );
    }

    let parley_btn = div()
        .id("galaxy-initiate-parley")
        .px(px(tokens::SPACE_3))
        .py(px(tokens::SPACE_1))
        .rounded(px(tokens::RADIUS_MD))
        .text_size(px(tokens::TEXT_BODY))
        .font_weight(FontWeight::SEMIBOLD);
    let parley_btn = if can_parley {
        parley_btn
            .bg(rgb(t.accent))
            .text_color(rgb(t.bg))
            .cursor_pointer()
            .hover(|s| s.shadow(motion::glow(current_theme().accent, 0.35, 12.0, 0.0)))
            .child("Initiate parley")
            .on_click(cx.listener(|this, _ev, _window, cx| {
                this.open_galaxy_parley_command();
                cx.notify();
            }))
    } else {
        // Disabled + the explanatory tooltip-as-text: never a dead control the
        // operator has to guess at (and never a doomed daemon 400 round-trip).
        parley_btn
            .border_1()
            .border_color(rgb(t.line))
            .text_color(rgb(t.muted))
            .child("Initiate parley")
    };
    bar = bar.child(parley_btn);
    if !can_parley {
        bar = bar.child(
            div()
                .text_size(px(tokens::TEXT_CAPTION))
                .text_color(rgb(t.muted))
                .child("needs \u{2265}2 sessions with durable identity receipts"),
        );
    }

    bar.into_any_element()
}

/// The session-detail drawer: the parsed `GET /galaxy/session/:id` payload
/// rendered through the shared Block renderer inside its own stable-id scroll
/// region (long transcripts scroll independently instead of clipping).
fn detail_drawer(
    pane_id: PaneId,
    detail: &gp::GalaxyDetail,
    t: &Theme,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let blocks = gp::detail_blocks(detail);
    // Every block goes through the shared `render_block` EXCEPT this pane's
    // `"file"`-labeled ArtifactRef rows: those get a bespoke clickable row
    // that opens the Harbor Editor surface, since the shared renderer has no
    // click affordance for ArtifactRef (and other panes' PR/commit refs must
    // stay inert — this is intentionally scoped to just the galaxy drawer).
    let rendered: Vec<AnyElement> = blocks
        .into_iter()
        .map(|b| match b {
            Block::ArtifactRef { label, path, .. } if label == "file" => {
                file_artifact_row(pane_id, path, t, cx)
            }
            other => render_block(other, FlagMotion::default()).into_any_element(),
        })
        .collect();
    div()
        .rounded(px(tokens::RADIUS_LG))
        .border_1()
        .border_color(rgb(t.line))
        .bg(rgb(t.panel))
        .flex()
        .flex_col()
        // Drawer header: title + close.
        .child(
            div()
                .flex()
                .items_center()
                .px(px(tokens::SPACE_3))
                .py(px(tokens::SPACE_2))
                .border_b_1()
                .border_color(rgb(t.line))
                .child(
                    div()
                        .flex_1()
                        .text_size(px(tokens::TEXT_BODY_LG))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(rgb(t.accent_ink))
                        .child("session detail"),
                )
                .child(
                    div()
                        .id("galaxy-detail-close")
                        .px(px(tokens::SPACE_2))
                        .py(px(2.0))
                        .rounded(px(tokens::RADIUS_MD))
                        .cursor_pointer()
                        .text_size(px(tokens::TEXT_CAPTION))
                        .text_color(rgb(t.muted))
                        .hover(|s| {
                            let t = current_theme();
                            s.text_color(rgb(t.ink)).bg(rgb(t.raised))
                        })
                        .child("\u{2715} close")
                        .on_click(cx.listener(|this, _ev, _window, cx| {
                            this.galaxy_detail = None;
                            cx.notify();
                        })),
                ),
        )
        .child(
            div()
                .id(SharedString::from(format!("galaxy-detail-{pane_id}")))
                .max_h(px(380.0))
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .pb(px(tokens::SPACE_2))
                .children(rendered),
        )
        .into_any_element()
}

/// One clickable "files touched" row in the session-detail drawer. The
/// daemon sends repo-relative paths (per the concurrent daemon-lane
/// contract); a click opens the SAME `SurfaceKind::Editor` surface the
/// FileTree's file row opens (`render_filetree_row` in app.rs) — reusing the
/// Editor surface rather than inventing a second file-preview affordance.
fn file_artifact_row(
    pane_id: PaneId,
    path: String,
    t: &Theme,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let color = t.engaged;
    let click_path = path.clone();
    div()
        .id(SharedString::from(format!("galaxy-file-{pane_id}-{path}")))
        .mx(px(tokens::SPACE_3))
        .my(px(2.0))
        .px(px(tokens::SPACE_2))
        .py(px(tokens::SPACE_2))
        .border_l_2()
        .border_color(rgb(color))
        .bg(wash(color, 0x12))
        .cursor_pointer()
        .flex()
        .items_center()
        .gap(px(tokens::SPACE_2))
        .hover(|s| s.bg(wash(current_theme().engaged, 0x22)))
        .child(
            div()
                .text_color(rgb(color))
                .text_size(px(tokens::TEXT_BODY))
                .font_weight(FontWeight::BOLD)
                .child("\u{25a3}"),
        )
        .child(
            div()
                .rounded(px(tokens::RADIUS_SM))
                .border_1()
                .border_color(rgb(color))
                .px(px(tokens::SPACE_1))
                .py(px(1.0))
                .text_color(rgb(color))
                .text_size(px(tokens::TEXT_CAPTION))
                .font_weight(FontWeight::SEMIBOLD)
                .child("FILE"),
        )
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .text_color(rgb(t.ink))
                .text_size(px(tokens::TEXT_BODY))
                .font_family("IBM Plex Mono")
                .child(path),
        )
        .child(
            div()
                .text_color(rgb(t.muted))
                .text_size(px(tokens::TEXT_CAPTION))
                .child("open in editor"),
        )
        .on_click(cx.listener(move |this, _ev, _window, cx| {
            this.open_galaxy_file(pane_id, click_path.clone());
            crate::audio::play(crate::audio::Cue::Tick);
            cx.notify();
        }))
        .into_any_element()
}
