# Example Output: Agent Compliance Conformance

Scenario: a team ships a `compliance-ladder` design where the `doc` surface renamed C3 from "Suggestible" to "Controllable," the `schema` surface silently dropped C1 entirely, nobody wired a `ui` or `probe` surface at all, one adapter claims a level that doesn't exist, another's forgery probe fired and wasn't caught, a third has a duplicated probe entry, a fourth references a ladder that was never defined, and C1 ends up with zero adapters backing it. This is the "drifted, self-attesting ladder" `conformance_audit.mjs` is designed to catch.

## Weak design — input

```json
{
  "ladders": [
    {
      "name": "compliance-ladder",
      "levels": [
        { "id": "C0", "order": 0, "name": "Registered", "requiredPredicates": ["agent-node-identity-exists"] },
        { "id": "C1", "order": 1, "name": "Transcripted", "requiredPredicates": ["t4-verified-transcript-active"] },
        { "id": "C2", "order": 2, "name": "Governed", "requiredPredicates": ["tool-preflight-witnessed", "destructive-action-gate-witnessed"] },
        { "id": "C3", "order": 3, "name": "Suggestible", "requiredPredicates": ["scoped-injection-with-provenance"] }
      ]
    }
  ],
  "surfaces": [
    {
      "kind": "doc",
      "ladder": "compliance-ladder",
      "levels": [
        { "id": "C0", "order": 0, "name": "Registered", "requiredPredicates": ["agent-node-identity-exists"] },
        { "id": "C1", "order": 1, "name": "Transcripted", "requiredPredicates": ["t4-verified-transcript-active"] },
        { "id": "C2", "order": 2, "name": "Governed", "requiredPredicates": ["tool-preflight-witnessed", "destructive-action-gate-witnessed"] },
        { "id": "C3", "order": 3, "name": "Controllable", "requiredPredicates": ["scoped-injection-with-provenance"] }
      ]
    },
    {
      "kind": "schema",
      "ladder": "compliance-ladder",
      "levels": [
        { "id": "C0", "order": 0, "name": "Registered", "requiredPredicates": ["agent-node-identity-exists"] },
        { "id": "C2", "order": 2, "name": "Governed", "requiredPredicates": ["tool-preflight-witnessed", "destructive-action-gate-witnessed"] },
        { "id": "C3", "order": 3, "name": "Suggestible", "requiredPredicates": ["scoped-injection-with-provenance"] }
      ]
    }
  ],
  "adapters": [
    {
      "name": "codex",
      "ladder": "compliance-ladder",
      "claimedLevel": "C9",
      "negativeProbes": [
        { "kind": "forged-level", "present": true, "downgraded": true },
        { "kind": "direct-mcp-bypass", "present": true, "downgraded": true },
        { "kind": "disabled-hook-after-launch", "present": true, "downgraded": true }
      ]
    },
    {
      "name": "claude-code",
      "ladder": "compliance-ladder",
      "claimedLevel": "C2",
      "negativeProbes": [
        { "kind": "forged-level", "present": true, "downgraded": true },
        { "kind": "direct-mcp-bypass", "present": true, "downgraded": false },
        { "kind": "disabled-hook-after-launch", "present": true, "downgraded": true },
        { "kind": "forged-heartbeat", "present": true, "downgraded": true },
        { "kind": "observed-to-controlled", "present": true, "downgraded": true }
      ]
    },
    {
      "name": "cloudflare",
      "ladder": "compliance-ladder",
      "claimedLevel": "C3",
      "negativeProbes": [
        { "kind": "forged-level", "present": true, "downgraded": true },
        { "kind": "forged-level", "present": true, "downgraded": true },
        { "kind": "direct-mcp-bypass", "present": true, "downgraded": true },
        { "kind": "disabled-hook-after-launch", "present": true, "downgraded": true },
        { "kind": "forged-heartbeat", "present": true, "downgraded": true },
        { "kind": "observed-to-controlled", "present": true, "downgraded": true }
      ]
    },
    {
      "name": "custom-stdio",
      "ladder": "made-up-ladder",
      "claimedLevel": "C1",
      "negativeProbes": [
        { "kind": "forged-level", "present": true, "downgraded": true },
        { "kind": "direct-mcp-bypass", "present": true, "downgraded": true },
        { "kind": "disabled-hook-after-launch", "present": true, "downgraded": true },
        { "kind": "forged-heartbeat", "present": true, "downgraded": true },
        { "kind": "observed-to-controlled", "present": true, "downgraded": true }
      ]
    }
  ]
}
```

This is `examples/weak-input.json`, unmodified.

## Weak design — audit result

```json
{
  "pass": false,
  "score": 4,
  "findings": [
    { "severity": "critical", "id": "ladder-name-order-drift", "message": "Surface \"doc\" for ladder \"compliance-ladder\" disagrees with the canonical definition of level \"C3\": canonical is {order:3, name:\"Suggestible\", requiredPredicates:[scoped-injection-with-provenance]}, surface has {order:3, name:\"Controllable\", requiredPredicates:[scoped-injection-with-provenance]}." },
    { "severity": "critical", "id": "ladder-name-order-drift", "message": "Surface \"schema\" for ladder \"compliance-ladder\" omits level \"C1\" (\"Transcripted\") that the canonical ladder defines." },
    { "severity": "medium", "id": "incomplete-surface-coverage", "message": "Ladder \"compliance-ladder\" has no surface declaration for: ui, probe. A frozen ladder must agree across doc, schema, UI, and probe form." },
    { "severity": "high", "id": "unknown-claimed-level", "message": "Adapter \"codex\" claims level \"C9\", which ladder \"compliance-ladder\" does not define." },
    { "severity": "critical", "id": "missing-negative-probe", "message": "Adapter \"codex\" has no falsifiable, daemon-witnessed fixture for the \"forged-heartbeat\" negative probe." },
    { "severity": "critical", "id": "missing-negative-probe", "message": "Adapter \"codex\" has no falsifiable, daemon-witnessed fixture for the \"observed-to-controlled\" negative probe." },
    { "severity": "critical", "id": "no-downgrade-on-forgery", "message": "Adapter \"claude-code\"'s \"direct-mcp-bypass\" probe fired but did not downgrade the claimed level \"C2\" — the adversarial behavior was not caught." },
    { "severity": "medium", "id": "duplicate-negative-probe", "message": "Adapter \"cloudflare\" declares more than one \"forged-level\" negative probe." },
    { "severity": "high", "id": "undeclared-ladder-reference", "message": "Adapter \"custom-stdio\" claims a level on ladder \"made-up-ladder\", which is not defined in \"ladders\"." },
    { "severity": "critical", "id": "level-advances-on-self-report", "message": "Level \"C1\" (\"Transcripted\") on ladder \"compliance-ladder\" is reachable with zero adapters backed by a daemon-witnessed, correctly-downgrading negative probe — nothing but self-report establishes it." }
  ],
  "recommendations": [
    "Freeze one ladder definition and make the \"doc\" surface match it exactly (same name, order, and requiredPredicates for \"C3\").",
    "Add level \"C1\" to the \"schema\" surface with the exact name, order, and requiredPredicates from the canonical ladder.",
    "Add a surface entry for ui, probe declaring ladder \"compliance-ladder\" so drift can be caught wherever it could appear.",
    "Fix \"codex\"'s claimedLevel to a level id that actually exists on \"compliance-ladder\".",
    "Wire an actual \"forged-heartbeat\" hostile-probe fixture against \"codex\" and mark it present once the daemon actually runs it.",
    "Wire an actual \"observed-to-controlled\" hostile-probe fixture against \"codex\" and mark it present once the daemon actually runs it.",
    "Fix the daemon-side check so a fired \"direct-mcp-bypass\" probe against \"claude-code\" downgrades its effective compliance level.",
    "Keep exactly one fixture per probe kind per adapter; merge or remove the duplicate \"forged-level\" entry for \"cloudflare\".",
    "Add \"made-up-ladder\" to \"ladders\", or fix \"custom-stdio\"'s \"ladder\" reference.",
    "Add at least one adapter fixture claiming \"C1\" with a present, honestly-downgrading negative probe before that level can be granted."
  ]
}
```

## What fixing it actually looked like

1. **Froze the ladder definition** and made every surface — doc, schema, ui, probe — declare the exact same id, order, name, and `requiredPredicates` for C0-C3. No more "Controllable" vs "Suggestible" for the same C3.
2. **Restored the missing C1 level** to the schema surface instead of letting it silently omit a level the canonical ladder defines.
3. **Added the missing `ui` and `probe` surfaces** so the ladder is declared everywhere it can drift, not just in two of the four places.
4. **Fixed `codex`'s claimed level** from the nonexistent `C9` to a real level, and wired the two missing negative-probe fixtures (`forged-heartbeat`, `observed-to-controlled`) instead of leaving them undeclared.
5. **Fixed the daemon-side `direct-mcp-bypass` check** for `claude-code` so the probe — which was already firing — actually downgrades the claimed level instead of letting the bypass through unnoticed.
6. **Removed the duplicate `forged-level` fixture** on `cloudflare` and kept one canonical entry.
7. **Fixed `custom-stdio`'s ladder reference** from the undefined `made-up-ladder` to the real `compliance-ladder`, and added the second ladder (`transcript-fidelity-ladder`) plus adapters covering every remaining non-base level so C1 (and every T-level) has a real witness.

## Frozen design — input

This is `examples/sample-input.json`, unmodified: both ladders, all four surface kinds identical to canonical for each, and one witnessing adapter per non-base level.

```json
{
  "ladders": [
    {
      "name": "compliance-ladder",
      "levels": [
        { "id": "C0", "order": 0, "name": "Registered", "requiredPredicates": ["agent-node-identity-exists"] },
        { "id": "C1", "order": 1, "name": "Transcripted", "requiredPredicates": ["t4-verified-transcript-active"] },
        { "id": "C2", "order": 2, "name": "Governed", "requiredPredicates": ["tool-preflight-witnessed", "destructive-action-gate-witnessed"] },
        { "id": "C3", "order": 3, "name": "Suggestible", "requiredPredicates": ["scoped-injection-with-provenance"] }
      ]
    },
    {
      "name": "transcript-fidelity-ladder",
      "levels": [
        { "id": "T0", "order": 0, "name": "Inventory only", "requiredPredicates": ["agent-session-exists"] },
        { "id": "T1", "order": 1, "name": "Run log", "requiredPredicates": ["structured-steps-recorded"] },
        { "id": "T2", "order": 2, "name": "Visible chat", "requiredPredicates": ["operator-assistant-messages-visible"] }
      ]
    }
  ],
  "surfaces": [
    { "kind": "doc", "ladder": "compliance-ladder", "levels": "identical to canonical compliance-ladder — see examples/sample-input.json" },
    { "kind": "schema", "ladder": "compliance-ladder", "levels": "identical to canonical compliance-ladder" },
    { "kind": "ui", "ladder": "compliance-ladder", "levels": "identical to canonical compliance-ladder" },
    { "kind": "probe", "ladder": "compliance-ladder", "levels": "identical to canonical compliance-ladder" },
    { "kind": "doc", "ladder": "transcript-fidelity-ladder", "levels": "identical to canonical transcript-fidelity-ladder" },
    { "kind": "schema", "ladder": "transcript-fidelity-ladder", "levels": "identical to canonical transcript-fidelity-ladder" },
    { "kind": "ui", "ladder": "transcript-fidelity-ladder", "levels": "identical to canonical transcript-fidelity-ladder" },
    { "kind": "probe", "ladder": "transcript-fidelity-ladder", "levels": "identical to canonical transcript-fidelity-ladder" }
  ],
  "adapters": [
    { "name": "codex", "ladder": "compliance-ladder", "claimedLevel": "C1", "negativeProbes": "all 5 kinds present:true, downgraded:true" },
    { "name": "claude-code", "ladder": "compliance-ladder", "claimedLevel": "C2", "negativeProbes": "all 5 kinds present:true, downgraded:true" },
    { "name": "cloudflare", "ladder": "compliance-ladder", "claimedLevel": "C3", "negativeProbes": "all 5 kinds present:true, downgraded:true" },
    { "name": "ollama", "ladder": "transcript-fidelity-ladder", "claimedLevel": "T1", "negativeProbes": "all 5 kinds present:true, downgraded:true" },
    { "name": "custom-stdio", "ladder": "transcript-fidelity-ladder", "claimedLevel": "T2", "negativeProbes": "all 5 kinds present:true, downgraded:true" }
  ]
}
```

The `levels`/`negativeProbes` values above are summarized for readability; `examples/sample-input.json` has the literal, schema-valid arrays.

## Frozen design — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Ladder is identical across every surface and every level is backed by a witnessed, honestly-downgrading negative probe. Safe to freeze and ship C-badges/T-labels."
  ]
}
```

Run it yourself: `node scripts/conformance_audit.mjs --input examples/sample-input.json`.
