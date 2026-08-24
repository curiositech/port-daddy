// ----- BEGIN FILE: apps/relay/src/index.ts -----
import { Router } from "express";
import { getD1, getR2 } from "../db";
import { safeDecodeSegment } from "./utils"; // newly added utility

const router = Router();

// Existing human‑facing transcript page route (HTML)
router.get("/fleet/runs/:runId/transcript", async (req, res) => {
  const { runId } = req.params;
  // NOTE: Previously used decodeURIComponent directly – now replaced with safeDecodeSegment
  const decodedRunId = safeDecodeSegment(runId);
  if (!decodedRunId) {
    return res.status(404).send("Not found");
  }
  // ... existing logic to render the transcript page ...
});

// Existing human‑facing segment route (HTML)
router.get("/fleet/runs/:runId/transcript/:segment", async (req, res) => {
  const { runId, segment } = req.params;
  const decodedRunId = safeDecodeSegment(runId);
  const decodedSegment = safeDecodeSegment(segment);
  if (!decodedRunId || !decodedSegment) {
    return res.status(404).send("Not found");
  }
  // ... existing logic to render the specific segment ...
});

// New machine‑facing JSON index route (added in PR #9850)
router.get("/fleet/runs/:runId/transcripts.json", async (req, res) => {
  const { runId } = req.params;
  const decodedRunId = safeDecodeSegment(runId);
  if (!decodedRunId) {
    return res.status(404).json({ error: "not found" });
  }
  // ... logic that queries D1 with WHERE ship = ? and returns JSON ...
});

// New machine‑facing JSONL route (added in PR #9850)
router.get("/fleet/runs/:runId/transcript.jsonl", async (req, res) => {
  const { runId } = req.params;
  const decodedRunId = safeDecodeSegment(runId);
  if (!decodedRunId) {
    return res.status(404).type("application/json").send({ error: "not found" });
  }
  // ... logic that streams .jsonl, respects ?after slicing, etc. ...
});

export default router;
// ----- END FILE: apps/relay/src/index.ts -----