import { describe, expect, test, beforeEach } from "@jest/globals";
import Database from "better-sqlite3";
import { createRoadmapPopper } from "../../lib/roadmap-popper.ts";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE roadmap_items (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL, summary_md TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'backlog',
      promoted_from_feedback_id TEXT, promoted_by_agent_id TEXT, promoted_at INTEGER,
      last_touched_at INTEGER NOT NULL,
      dependencies_json TEXT NOT NULL DEFAULT '[]',
      notes_json TEXT NOT NULL DEFAULT '[]',
      harbor TEXT NOT NULL, created_at INTEGER NOT NULL,
      nightshift_eligible INTEGER NOT NULL DEFAULT 0, dispatch_id TEXT,
      UNIQUE(slug, harbor));
  `);
  return db;
}
function seed(db, rows) {
  const stmt = db.prepare(`INSERT INTO roadmap_items (id, slug, summary_md, status, last_touched_at, dependencies_json, harbor, created_at, nightshift_eligible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const r of rows) stmt.run(r.id, r.slug, r.summary, r.status ?? "backlog", r.touched ?? Date.now(), JSON.stringify(r.deps ?? []), r.harbor ?? "port-daddy", r.created ?? Date.now(), r.eligible ?? 0);
}
describe("roadmap-popper", () => {
  let db, proposer, calls, popper;
  beforeEach(() => {
    db = setupDb(); calls = [];
    proposer = async (input) => { calls.push(input); return { dispatchId: `d-${calls.length}` }; };
    popper = createRoadmapPopper({ db, dispatchProposer: proposer, log: () => {} });
  });
  test("nextCandidate null when no eligible", () => { seed(db, [{ id: "1", slug: "a", summary: "a" }]); expect(popper.nextCandidate()).toBeNull(); });
  test("returns most recent eligible", () => { seed(db, [{ id: "1", slug: "old", summary: "o", touched: 100, eligible: 1 }, { id: "2", slug: "new", summary: "n", touched: 200, eligible: 1 }]); expect(popper.nextCandidate()?.slug).toBe("new"); });
  test("skips unmet deps", () => { seed(db, [{ id: "1", slug: "dep", summary: "d", status: "backlog", eligible: 0 }, { id: "2", slug: "blocked", summary: "b", touched: 200, eligible: 1, deps: ["dep"] }]); expect(popper.nextCandidate()).toBeNull(); });
  test("includes when deps done", () => { seed(db, [{ id: "1", slug: "dep", summary: "d", status: "done" }, { id: "2", slug: "ok", summary: "o", touched: 200, eligible: 1, deps: ["dep"] }]); expect(popper.nextCandidate()?.slug).toBe("ok"); });
  test("popNext calls proposer", async () => { seed(db, [{ id: "1", slug: "add-hdr", summary: "Add LICENSE header", eligible: 1, touched: 200 }]); const r = await popper.popNext(); expect(r).toEqual({ itemId: "1", itemSlug: "add-hdr", dispatchId: "d-1" }); expect(calls[0].goal).toBe("Add LICENSE header"); });
  test("popNext stamps dispatch_id", async () => { seed(db, [{ id: "1", slug: "x", summary: "x", eligible: 1 }]); await popper.popNext(); expect(db.prepare("SELECT dispatch_id FROM roadmap_items WHERE id=?").get("1").dispatch_id).toBe("d-1"); });
  test("picks next after first popped", async () => { seed(db, [{ id: "1", slug: "first", summary: "f", touched: 200, eligible: 1 }, { id: "2", slug: "second", summary: "s", touched: 100, eligible: 1 }]); expect((await popper.popNext())?.itemSlug).toBe("first"); expect((await popper.popNext())?.itemSlug).toBe("second"); });
  test("status counts update", async () => { seed(db, [{ id: "1", slug: "a", summary: "a", eligible: 1, touched: 200 }, { id: "2", slug: "b", summary: "b", eligible: 1, touched: 100 }]); expect(popper.status().eligibleCount).toBe(2); await popper.popNext(); expect(popper.status().eligibleCount).toBe(1); });
  test("respects harbor scoping", () => { seed(db, [{ id: "1", slug: "pd", summary: "p", harbor: "port-daddy", eligible: 1, touched: 200 }, { id: "2", slug: "wd", summary: "w", harbor: "jury_rig", eligible: 1, touched: 300 }]); expect(popper.nextCandidate("port-daddy")?.slug).toBe("pd"); expect(popper.nextCandidate("jury_rig")?.slug).toBe("wd"); });
});
