# Constructed output and scope

The sample fixture is a constructed declaration. Its extra property is allowed
by the schema. The CLI reports a pass because required fields and declared
consistency conditions hold. It does not establish that constructed-ci-receipt-42
exists, that k2 was authenticated, or that any action ran.

A valid TrueSkill plan may return the medium finding
posterior-not-empirically-calibrated while retaining a pass: it must report
calibrationStatus not-estimated until a representative held-out test exists.
An invalid estimator string, missing judge block, missing uncertainty field,
null identity, or Infinity actor identifier returns false from schema validation.
