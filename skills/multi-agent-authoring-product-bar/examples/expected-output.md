# Example Output: Multi-Agent Authoring Product Bar

Scenario: a Fleet Console team ships a "Summon 5 agents" button, then — after
this audit fails it — spends a cycle earning table-stakes parity and wiring
real behavior behind the differentiators before shipping again.

## V1: Potemkin Swarm (fails)

The console launches five agents from one prompt. There's no per-file claim,
no visible ownership, no merge point, and the single-agent loop underneath it
is still slower than Claude Code because context attach requires manual
copy-paste. The team's only reported metric is "agents launched per week."

```json
{
  "product": "Fleet Console v0.3 — 'Summon 5 agents' launch",
  "tableStakes": {
    "singleAgentLoop": "below-par",
    "latency": "below-par",
    "contextAttach": "par",
    "recoverableEdits": "below-par"
  },
  "differentiatorThreshold": 3,
  "differentiators": {
    "isolationClaims": { "present": true, "hasRealBehavior": false, "leavesReceipt": false },
    "swarmVisibility": { "present": true, "hasRealBehavior": false, "leavesReceipt": false },
    "transcriptsSalvage": { "present": false, "hasRealBehavior": false, "leavesReceipt": false },
    "receipts": { "present": false, "hasRealBehavior": false, "leavesReceipt": false },
    "spendVisibility": { "present": false, "hasRealBehavior": false, "leavesReceipt": false }
  },
  "stickiness": {
    "comebackTriggers": [],
    "usesOverIncumbentForRealWork": false
  },
  "metricsHonest": false
}
```

```
$ node scripts/dogfood_bar.mjs --input v1-potemkin.json
{
  "pass": false,
  "tableStakesScore": 1,
  "tableStakesMax": 8,
  "tableStakesParity": false,
  "differentiatorScore": 0,
  "differentiatorThreshold": 3,
  "differentiatorsMeetThreshold": false,
  "honestStickiness": false,
  "recognizedTriggerCount": 0,
  "findings": [
    { "id": "table-stakes-gap-singleAgentLoop", "severity": "critical", "message": "singleAgentLoop is below-par against the incumbent single-agent loop (Claude Code/Codex); differentiators cannot compensate for this." },
    { "id": "table-stakes-gap-latency", "severity": "critical", "message": "latency is below-par against the incumbent single-agent loop (Claude Code/Codex); differentiators cannot compensate for this." },
    { "id": "table-stakes-gap-recoverableEdits", "severity": "critical", "message": "recoverableEdits is below-par against the incumbent single-agent loop (Claude Code/Codex); differentiators cannot compensate for this." },
    { "id": "potemkin-differentiator-isolationClaims", "severity": "high", "message": "isolationClaims is present but has no real behavior behind it — it looks like the differentiator without being one." },
    { "id": "potemkin-differentiator-swarmVisibility", "severity": "high", "message": "swarmVisibility is present but has no real behavior behind it — it looks like the differentiator without being one." },
    { "id": "insufficient-real-differentiators", "severity": "critical", "message": "Only 0 of 5 differentiators are real (present, working, receipted); threshold is 3." },
    { "id": "no-real-dogfood-signal", "severity": "critical", "message": "No signal that the makers actually use this over Claude Code/Codex for real work — the dogfood thesis is unproven." },
    { "id": "no-comeback-triggers", "severity": "high", "message": "No recognized comeback triggers recorded; stickiness is asserted, not evidenced." },
    { "id": "vanity-metrics-admitted", "severity": "high", "message": "metricsHonest is false: the team is reporting vanity counts (agents launched, demos run) as the primary success signal instead of real-work usage." }
  ]
}
```

Three separate gates fail at once: table-stakes parity, the differentiator
threshold, and honest stickiness. The recommendations point at the actual
sequencing fix — bring the single-agent loop and latency to parity first;
`isolationClaims` and `swarmVisibility` need real state machines and receipts,
not just a UI; and the team needs to stop counting launches as evidence of
anything.

## V2: Earns The Bar (passes)

A cycle later: the daemon warms up faster (latency now `above-par`), context
attach picked up automatic terminal/failed-test capture (`par`), checkpoint
revert is wired and verified (`recoverableEdits` now `above-par`). Claims,
swarm board, transcripts/salvage, and receipts are all real end-to-end.
`spendVisibility` is still just a raw token counter with no budget — honestly
left as Potemkin rather than claimed. A maker used it to fix a real launchd
PATH bug live and queued a follow-up task while the fix landed.

```json
{
  "product": "Port Daddy Agent Harbor (pd-console) — 2026-07 self-assessment",
  "tableStakes": {
    "singleAgentLoop": "par",
    "latency": "above-par",
    "contextAttach": "par",
    "recoverableEdits": "above-par"
  },
  "differentiatorThreshold": 3,
  "differentiators": {
    "isolationClaims": { "present": true, "hasRealBehavior": true, "leavesReceipt": true },
    "swarmVisibility": { "present": true, "hasRealBehavior": true, "leavesReceipt": true },
    "transcriptsSalvage": { "present": true, "hasRealBehavior": true, "leavesReceipt": true },
    "receipts": { "present": true, "hasRealBehavior": true, "leavesReceipt": true },
    "spendVisibility": { "present": true, "hasRealBehavior": false, "leavesReceipt": false }
  },
  "stickiness": {
    "comebackTriggers": ["fixed-while-watching", "queued-next-task", "swarm-no-collision"],
    "usesOverIncumbentForRealWork": true
  },
  "metricsHonest": true
}
```

```
$ node scripts/dogfood_bar.mjs --input v2-earned.json
{
  "pass": true,
  "tableStakesScore": 6,
  "tableStakesMax": 8,
  "tableStakesParity": true,
  "differentiatorScore": 4,
  "differentiatorThreshold": 3,
  "differentiatorsMeetThreshold": true,
  "honestStickiness": true,
  "recognizedTriggerCount": 3,
  "findings": [
    { "id": "potemkin-differentiator-spendVisibility", "severity": "high", "message": "spendVisibility is present but has no real behavior behind it — it looks like the differentiator without being one." }
  ],
  "recommendations": [
    "Either wire real behavior and a receipt into spendVisibility, or stop counting it as a reason to switch.",
    "Bar cleared: table-stakes parity holds, enough differentiators are real, and the dogfood signal is honest. Recheck after any table-stakes regression or new differentiator claim."
  ]
}
```

`pass: true` with one honest caveat left standing: `spendVisibility` is still
flagged as Potemkin rather than quietly counted, because four real
differentiators already clear the threshold of three. Nothing was hidden to
make the number look better — that's the point of the audit.
