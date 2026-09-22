-- Bind read-only receipt recovery to the exact standing grant, request, git
-- heads, and session that produced an intent. Legacy rows remain NULL and are
-- deliberately unrecoverable through the new endpoint.
ALTER TABLE github_publisher_intents
  ADD COLUMN recovery_binding_json TEXT
  CHECK (
    recovery_binding_json IS NULL OR (
      json_valid(recovery_binding_json)
      AND json_type(recovery_binding_json) = 'object'
      AND json_type(recovery_binding_json, '$.grantId') = 'text'
      AND length(json_extract(recovery_binding_json, '$.grantId')) = 36
      AND substr(json_extract(recovery_binding_json, '$.grantId'), 1, 4) = 'pdg_'
      AND substr(json_extract(recovery_binding_json, '$.grantId'), 5) NOT GLOB '*[^0-9a-f]*'
      AND json_type(recovery_binding_json, '$.grantEpoch') = 'integer'
      AND json_extract(recovery_binding_json, '$.grantEpoch') > 0
      AND json_type(recovery_binding_json, '$.repository') = 'text'
      AND length(json_extract(recovery_binding_json, '$.repository')) BETWEEN 3 AND 201
      AND instr(json_extract(recovery_binding_json, '$.repository'), '/') > 1
      AND json_type(recovery_binding_json, '$.operation') = 'text'
      AND json_extract(recovery_binding_json, '$.operation') IN (
        'pull-request.publish','pull-request.update','pull-request.ready',
        'pull-request.request-reviewers','pull-request.comment',
        'pull-request.review-reply','pull-request.enqueue','pull-request.inspect')
      AND json_type(recovery_binding_json, '$.baseBranch') = 'text'
      AND length(json_extract(recovery_binding_json, '$.baseBranch')) BETWEEN 1 AND 255
      AND json_type(recovery_binding_json, '$.baseSha') = 'text'
      AND length(json_extract(recovery_binding_json, '$.baseSha')) = 40
      AND json_extract(recovery_binding_json, '$.baseSha') NOT GLOB '*[^0-9a-fA-F]*'
      AND json_type(recovery_binding_json, '$.headSha') = 'text'
      AND length(json_extract(recovery_binding_json, '$.headSha')) = 40
      AND json_extract(recovery_binding_json, '$.headSha') NOT GLOB '*[^0-9a-fA-F]*'
      AND json_type(recovery_binding_json, '$.sessionId') = 'text'
      AND length(json_extract(recovery_binding_json, '$.sessionId')) BETWEEN 1 AND 256
      AND json_type(recovery_binding_json, '$.requestHash') = 'text'
      AND length(json_extract(recovery_binding_json, '$.requestHash')) = 64
      AND json_extract(recovery_binding_json, '$.requestHash') NOT GLOB '*[^0-9a-fA-F]*'
      AND json_type(recovery_binding_json, '$.idempotencyKey') = 'text'
      AND length(json_extract(recovery_binding_json, '$.idempotencyKey')) BETWEEN 1 AND 256
    )
  );
