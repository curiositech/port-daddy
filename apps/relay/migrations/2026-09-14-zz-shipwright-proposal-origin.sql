-- Preserve truthful provenance for every Shipwright draft. Historical rows
-- came only from assistant conversation turns; deterministic onboarding
-- drafts use the new explicit origin when inserted by the scoped endpoint.
ALTER TABLE shipwright_proposals
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'assistant_conversation'
  CHECK (origin IN ('assistant_conversation', 'deterministic_onboarding'));
