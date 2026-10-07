# Port Daddy source note: resolution damping

This is a source-only description of linked worktree commit `00ab2c9ab2197ff97e85edc173370b7446fdb2ef`; it does not establish deployed daemon behavior.

- `lib/pheromone.ts:28-32`: `dampedStrength` clamps `damping * resolution` to `[0,1]`, then multiplies raw signal by `1-r`.
- `lib/pheromone.ts:85`: default manager config is `decayRate=0.95`, `intervalMs=60000`.
- `lib/pheromone.ts:152-170`: pheromone decays by `decayRate`; resolution decays by `decayRate²`; values below `0.01` are deleted.
- `lib/pheromone.ts:291-303`: `sprayResolution` checks ordinary numeric bounds 0 through 1, without an explicit finite/type check, and replaces one value in the separate `metadata.resolutions` map.
- `lib/pheromone.ts:312-321`: `sniffEffective` defaults damping to 1, applies `applyResolutionDamping`, and returns the resulting map.
- `lib/pheromone.ts:35-44`: `applyResolutionDamping` omits effective entries below `0.01`.

The code provides an inspectable resolution signal and a fading policy at this source snapshot. It does not establish that agents use the effective read, that `gradient()` is damped, or that duplicate work decreases. Treat “resolved” as revocable application policy and test re-opening, effect precedence, and consumer behavior.

Root read `routes/pheromone.ts:212-222` at the same commit on 2026-09-24. The GET route selects the effective helper only when the query requests it (`1`, `true`, or `yes`); otherwise it selects raw `sniff`. This establishes an available source-level read path, not that an agent navigation policy uses it. No route or daemon was executed.
