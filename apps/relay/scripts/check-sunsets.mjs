/**
 * X6 pre-sunset CI gate (grand-plan SX6): the build FAILS from 7 days before
 * any registered sunset until the surface is tombstoned (registry entry gains
 * tombstoned: true and the relay answers a structured 410) or the sunset is
 * extended by commit (sunsetAt moved later). Run from apps/relay:
 *
 *   node scripts/check-sunsets.mjs
 *
 * Pure logic is exported so the relay vitest suite can demonstrate the gate
 * on synthetic fixtures (tests/deprecation-sightings.test.ts) - the CI step
 * and the test exercise the SAME function.
 *
 * NOTE deliberately narrow: this gate reads only src/deprecations.json. The
 * companion runtime question - did anyone actually call the surface in the
 * last 30 days - is a D1 query (surfaceRemovalAllowed in src/deprecations.ts)
 * because CI has no business holding database credentials.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PRE_SUNSET_WINDOW_DAYS = 7;
const DAY_SECONDS = 24 * 60 * 60;

export function parseIsoDayUtc(day) {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`bad ISO day in deprecations registry: ${day}`);
  return Math.floor(ms / 1000);
}

/**
 * @param entries  registry entries ({ id, sunsetAt?, tombstoned? })
 * @param nowUnix  injected clock (unix seconds)
 * @returns        array of failures; empty = gate passes
 */
export function checkSunsetGate(entries, nowUnix, windowDays = PRE_SUNSET_WINDOW_DAYS) {
  const failures = [];
  for (const e of entries) {
    if (!e.sunsetAt) continue;          // no sunset scheduled - nothing to gate
    if (e.tombstoned === true) continue; // 410 already ships - gate satisfied
    const sunset = parseIsoDayUtc(e.sunsetAt);
    const secondsLeft = sunset - nowUnix;
    if (secondsLeft <= windowDays * DAY_SECONDS) {
      const daysLeft = Math.floor(secondsLeft / DAY_SECONDS);
      failures.push({
        id: e.id,
        sunsetAt: e.sunsetAt,
        daysLeft,
        reason:
          `${e.id}: sunset ${e.sunsetAt} is ` +
          (secondsLeft < 0 ? `${-daysLeft} day(s) PAST` : `${daysLeft} day(s) away`) +
          ` - tombstone the surface (tombstoned: true in src/deprecations.json)` +
          ` or extend sunsetAt by commit`,
      });
    }
  }
  return failures;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const registryPath = join(here, "..", "src", "deprecations.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const failures = checkSunsetGate(registry.deprecations, Math.floor(Date.now() / 1000));
  if (failures.length > 0) {
    console.error("X6 sunset gate FAILED:");
    for (const f of failures) console.error(`  - ${f.reason}`);
    process.exit(1);
  }
  console.log(
    `X6 sunset gate: ${registry.deprecations.length} registered deprecation(s), ` +
    `none within ${PRE_SUNSET_WINDOW_DAYS} days of sunset without a tombstone.`,
  );
}
