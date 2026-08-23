async function replaceSnapshot(db, userId, repo, items, edges, activity) {
  const batch = [];
  batch.push(db.prepare('DELETE FROM roadmap_mirrors WHERE user_id = ? AND repo_full_name = ?').bind(userId, repo));
  batch.push(db.prepare('DELETE FROM roadmap_mirror_items WHERE user_id = ? AND repo_full_name = ?').bind(userId, repo));
  batch.push(db.prepare('DELETE FROM roadmap_mirror_edges WHERE user_id = ? AND repo_full_name = ?').bind(userId, repo));
  batch.push(db.prepare('DELETE FROM roadmap_mirror_activity WHERE user_id = ? AND repo_full_name = ?').bind(userId, repo));
  // Insert header placeholder: we'll insert after items
  // Insert items
  for (const item of items) {
    batch.push(db.prepare(`INSERT INTO roadmap_mirror_items (user_id, repo_full_name, slug, harbor, status, summary_md, last_touched_at, created_at, deleted_at, dependencies_json, notes_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(userId, repo, item.slug, item.harbor, item.status, item.summary_md, item.last_touched_at, item.created_at, item.deleted_at ?? null, item.dependencies_json ?? '[]', item.notes_json ?? '[]'));
  }
  // Insert edges
  for (const edge of edges) {
    batch.push(db.prepare(`INSERT INTO roadmap_mirror_edges (user_id, repo_full_name, scope, source_id, edge_type, target_id)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(userId, repo, edge.scope, edge.source_id, edge.edge_type, edge.target_id));
  }
  // Insert activity
  for (const act of activity) {
    batch.push(db.prepare(`INSERT INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind, by_id, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(userId, repo, act.at, act.slug, act.kind, act.by_id ?? null, act.detail_json ?? null));
  }
  // Insert header
  const itemCount = items.length;
  const edgeCount = edges.length;
  const activityCount = activity.length;
  const harbor = items[0]?.harbor ?? '';
  const harbor_id = null;
  const generated_at = Date.now();
  const received_at = Math.floor(Date.now() / 1000);
  batch.push(db.prepare(`INSERT INTO roadmap_mirrors (user_id, repo_full_name, harbor, daemon_label, generated_at, received_at, item_count, edge_count, harbor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(userId, repo, harbor, 'test-daemon', generated_at, received_at, itemCount, edgeCount, harbor_id));
  await db.batch(batch);
}