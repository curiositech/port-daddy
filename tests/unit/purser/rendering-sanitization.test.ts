// tests/unit/purser/rendering-sanitization.test.ts

import { renderSkillSearchResults } from '../../../lib/skill-graft.ts';

describe('renderSkillSearchResults sanitization', () => {
  test('returns empty string when there are no shortlist entries', () => {
    const emptyResult = {
      shortlist: [],
      scannedCount: 0,
    } as any;

    const rendered = renderSkillSearchResults(emptyResult);
    expect(rendered).toBe('');
  });

  test('excludes any SKILL.md body content or markdown syntax from the output', () => {
    const resultWithMarkdown = {
      shortlist: [
        {
          id: 'skill-foo',
          // Intentionally includes various markdown constructs that should be stripped.
          description: `
# Foo Skill

This **description** contains *markdown* elements, a [link](https://example.com), and \`code\` blocks.

- List item 1
- List item 2
`,
          similarity: 0.92,
        },
      ],
      scannedCount: 10,
    } as any;

    const rendered = renderSkillSearchResults(resultWithMarkdown);

    // Core metadata must be present.
    expect(rendered).toContain('Relevant skills');
    expect(rendered).toContain('skill-foo');

    // The renderer must not leak any raw markdown fragments.
    // Look for common markdown characters that should have been stripped.
    const markdownChars = /[#>*`\[\]!-]/;
    expect(rendered).not.toMatch(markdownChars);

    // Ensure no references to full bodies or SKILL.md files appear.
    expect(rendered).not.toMatch(/Full guidance/);
    expect(rendered).not.toMatch(/SKILL\.md/);
  });
});