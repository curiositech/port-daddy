/**
 * Purser contract for #7504, obligations 4, 6 and 7 — the accuracy gate runs
 * green over the README, `readme-verify: run` blocks are never silently
 * counted as passes when no daemon executed them, drifted verbs/flags are
 * actually caught, and the hero is a real, valid recording.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol). Defects in the authored
 * draft, each fixed while keeping the adversarial intent:
 *
 *   1. FANTASY FLAG CONTRACT. The draft ran `--ci --run` and parsed the
 *      output as JSON with a top-level `pass` field and a `findings` array.
 *      The real contract (scripts/check-readme-accuracy.mjs): `--ci` prints
 *      HUMAN-readable text with no color; JSON comes only from `--json`,
 *      and its shape is `{ ok, stats, errors, warnings, unresolved }` —
 *      there is no `pass` and no `findings`. Repaired to the real flags and
 *      the real shape.
 *   2. FANTASY ENVIRONMENT. `--run` executes the run-tier blocks with the
 *      installed `pd` against a LIVE daemon — which a unit test job does not
 *      have (that execution belongs to the fresh-install smoke, where #7504
 *      wires it against a brew-installed daemon). The gate's own design
 *      covers exactly this situation: checks that could not run are reported
 *      `unresolved`, never as passes. So the honest unit-level assertion is
 *      the one now made: without `--run`, the run blocks MUST surface in
 *      `unresolved` under rule `run-not-executed` — if the gate ever starts
 *      laundering unexecuted blocks into a green result, this fails.
 *   3. INVENTED DEPRECATIONS. The draft greped the README for
 *      `--roadmap <x>` / `--identity <x>` as "deprecated patterns" — neither
 *      is deprecated; both are real flags in the CLI corpus, so the test
 *      failed a correct README. And its `pd notez` / `--sinces` greps
 *      asserted absence only — trivially green, no teeth. Repaired into the
 *      executable form of #7504's own negative test: inject `pd notez
 *      --sinces` into a copy of the README's example corpus and assert the
 *      gate's real surface/corpus data REJECTS both (unknown verb, unknown
 *      flag) while accepting the untampered examples.
 *   4. FRAGILE PATHS. Bare relative paths depended on jest's cwd; `__dirname`
 *      does not exist in ESM. Repaired via `import.meta.url`.
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadCommandSurface, loadFlagCorpus } from '../../../scripts/check-readme-accuracy.mjs';
import { extractFences, shellInvocations } from '../../../skills/readme-craft/scripts/extract-examples.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');

describe('README readme-verify blocks and the accuracy gate', () => {
  it('check-readme-accuracy --json reports ok with zero errors, and run blocks as unresolved — never as passes', () => {
    const output = execFileSync('node', ['scripts/check-readme-accuracy.mjs', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    });

    const json = JSON.parse(output);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.errors)).toBe(true);
    expect(json.errors).toHaveLength(0);

    // The unresolved discipline (the same one `pd attest` uses): the README's
    // run-tier blocks were NOT executed here (no live daemon in a unit job),
    // so the gate must say so out loud rather than count them green.
    expect(json.stats.runBlocks).toBeGreaterThan(0);
    expect(json.stats.runExecuted).toBe(0);
    const rules = (json.unresolved as Array<{ rule: string }>).map((u) => u.rule);
    expect(rules).toContain('run-not-executed');
  });

  it('the gate catches injected drift: pd notez and --sinces are rejected, real examples are not', () => {
    const surface = loadCommandSurface();
    const corpus = loadFlagCorpus();

    // Tamper with a COPY of the README's example corpus, the way drift
    // actually arrives: one plausible-looking bad verb, one misspelled flag.
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const tampered =
      readme +
      '\n```bash\n# readme-verify: surface\npd notez --sinces 1h\n```\n';

    const bad: string[] = [];
    for (const block of extractFences(tampered)) {
      if (block.tier !== 'surface' && block.tier !== 'run') continue;
      for (const inv of shellInvocations(block.code)) {
        if (inv.argv[0] !== 'pd') continue;
        const verb = inv.argv[1];
        if (verb && !surface.verbs.has(verb)) bad.push(`verb:${verb}`);
        for (const flag of inv.argv.slice(2).filter((t: string) => /^--[a-z]/i.test(t))) {
          if (!corpus.has(flag.split('=')[0])) bad.push(`flag:${flag}`);
        }
      }
    }

    // Exactly the injected drift is caught — nothing more (the untampered
    // README examples all resolve), nothing less (the gate has teeth).
    expect(bad).toEqual(['verb:notez', 'flag:--sinces']);
  });

  it('has a valid VHS recording as the hero', () => {
    const gifPath = path.join(ROOT, 'website-v2', 'public', 'gifs', 'quickstart.gif');
    expect(existsSync(gifPath)).toBe(true);

    const data = readFileSync(gifPath);
    expect(data.length).toBeGreaterThan(0);

    const header = data.slice(0, 6).toString('ascii');
    const isGif = header === 'GIF89a' || header === 'GIF87a';
    expect(isGif).toBe(true);
  });
});
