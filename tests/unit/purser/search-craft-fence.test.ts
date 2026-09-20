// tests/unit/purser/search-craft-fence.test.ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  SkillGraftIndex,
  renderSkillSearchResults,
} from '../../../lib/skill-graft.ts';

type SearchResult = {
  id: string;
  label: string;
  summary: string;
  // deliberately no body / top / sourcePath
};

type CraftResult = SearchResult & {
  body: string;
};

describe('SkillGraft search vs craft isolation', () => {
  let tempRoot: string;

  // Helper to write a minimal SKILL.md file
  const writeSkill = (id: string, summary: string, body: string) => {
    const dir = join(tempRoot, id);
    mkdirSync(dir, { recursive: true });
    const content = [
      '---',
      `name: ${id}`,
      `summary: ${summary}`,
      '---',
      '',
      body,
    ].join('\n');
    writeFileSync(join(dir, 'SKILL.md'), content);
  };

  beforeAll(() => {
    // create an isolated temporary root for the test suite
    tempRoot = mkdtempSync(join(tmpdir(), 'purser-search-craft-'));

    // two distinct skills to exercise the index
    writeSkill(
      'alpha',
      'Alpha skill summary',
      '# Alpha\n\nThis is the **alpha** body with markdown.'
    );
    writeSkill(
      'beta',
      'Beta skill summary',
      '# Beta\n\nBeta body containing *markdown* elements.'
    );
  });

  afterAll(() => {
    // clean up the temporary directory after the suite finishes
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('search() returns only metadata without bodies or internal fields', async () => {
    const idx = new SkillGraftIndex(tempRoot);
    const results: SearchResult[] = await idx.search();

    // sanity checks
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(2);

    // each result must expose only the allowed metadata fields
    for (const res of results) {
      expect(res).toHaveProperty('id');
      expect(res).toHaveProperty('label');
      expect(res).toHaveProperty('summary');

      // explicitly forbid any body‑related leakage
      expect(res).not.toHaveProperty('body');
      expect(res).not.toHaveProperty('top');
      expect(res).not.toHaveProperty('sourcePath');
    }
  });

  test('craft() returns full body together with metadata', async () => {
    const idx = new SkillGraftIndex(tempRoot);
    const result: CraftResult = await idx.craft('alpha');

    // metadata must still be present
    expect(result).toHaveProperty('id', 'alpha');
    expect(result).toHaveProperty('label', 'alpha');
    expect(result).toHaveProperty('summary', 'Alpha skill summary');

    // body must be present and contain markdown (the heading we wrote)
    expect(result).toHaveProperty('body');
    expect(typeof result.body).toBe('string');
    expect(result.body).toMatch(/^# Alpha/);
    expect(result.body).toContain('**alpha**');
  });

  test('renderSkillSearchResults sanitizes any markdown from SKILL.md files', async () => {
    const idx = new SkillGraftIndex(tempRoot);
    const results: SearchResult[] = await idx.search();

    // The utility is expected to return a plain‑text representation (no markdown)
    const rendered = renderSkillSearchResults(results);

    // IDs and summaries should be present
    expect(rendered).toContain('alpha');
    expect(rendered).toContain('beta');

    // No markdown constructs should leak into the rendered string
    // (headings, bold, italics, code fences, etc.)
    const markdownPatterns = [/#\s/, /\*\*/, /\*/, /`/, /\[.*\]\(.*\)/];
    for (const pat of markdownPatterns) {
      expect(rendered).not.toMatch(pat);
    }
  });
});