# Forecast record, resolution binding, and evaluation modes

A forecast is an event-specific prospective record: nonblank `forecastId`, artifact
ID/digest/version, event ID/predicate/evaluator/version, forecast time, resolution
deadline, cohort, and probability. `status=declined` carries a null probability and
must have no fit or evaluation evidence. `status=uncalibrated` means this record has
not been scored; it does **not** infer whether comparable outcomes exist, are
available, or are sufficient elsewhere.

An evaluated record supplies scored samples. Each sample names `forecastId`,
`eventId`, probability, binary outcome, `resolvedAt`, and a nonblank
`resolutionSource`. The current record’s sample must occur exactly once, use its event
ID and original probability, and resolve after the forecast. The declared denominator
must equal the supplied sample count. Given `(p,y)=(.8,1),(.8,0),(.2,0)`, Brier losses
`(p-y)^2` are `.04,.64,.04`, so the supplied arithmetic is `(.04+.64+.04)/3=.24`.
That is a score for three resolved forecasts, not a calibration claim.

`evaluation.mode=raw` evaluates direct prospective probabilities and carries neither
fit evidence nor a calibration map. Its `cohortId` equals the current forecast’s
`cohortId`; mixed cohorts require a different contract that supplies a per-sample cohort
and selection policy. `evaluation.mode=calibrated` requires a named map and fit
evidence, and its scored forecast IDs must be disjoint from the fit IDs. This compact
contract treats the map as the fitted model, so `calibrationMap.id` equals
`fitEvidence.modelId` and the corresponding fit-cohort IDs agree. A
`calibration-fitted` record requires the same model/cohort/IDs and map but no
evaluation. This separates a raw score from a calibration claim and prevents a fitting
set from masquerading as held-out evaluation. Schema and the portable validator check
record consistency; neither establishes the authenticity of an outcome, evaluator, or
resolution source.

The bundle declares `ajv@^8.20.0` and `ajv-formats@^3.0.1` in `package.json`.
From a consumer checkout of this bundle, install those development dependencies with
your normal Node package manager and run `npm test`. No machine-specific module path
is part of the method.

[Gneiting & Raftery (2007)](https://sites.stat.washington.edu/people/raftery/Research/PDF/Gneiting2007jasa.pdf),
*Strictly Proper Scoring Rules, Prediction, and Estimation*, describes proper scoring
rules, including the Brier score. [Dimitriadis, Gneiting & Jordan (2020)](https://arxiv.org/abs/2008.03033),
*Evaluating probabilistic classifiers: Reliability diagrams and score decompositions revisited*,
discusses reliability evaluation and uncertainty. Both title/URL pairings were directly
opened on 2026-09-24 and are recorded in the confidence repair evidence. Neither paper
automatically calibrates LLM judgments, chooses an action, or supplies a universal
sample-size threshold.
