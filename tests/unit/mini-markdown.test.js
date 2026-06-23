import { renderMarkdown } from '../../lib/mini-markdown.js';

describe('renderMarkdown', () => {
  test('headings', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>');
    expect(renderMarkdown('### Sub')).toContain('<h3>Sub</h3>');
  });

  test('paragraphs and inline bold/italic/code/links', () => {
    const h = renderMarkdown('Some **bold** and *em* and `code` and [x](https://e.com).');
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('<em>em</em>');
    expect(h).toContain('<code>code</code>');
    expect(h).toContain('<a href="https://e.com"');
  });

  test('GFM pipe table', () => {
    const md = '| Phase | Slug |\n|---|---|\n| 1a | foo |\n| 1b | bar |';
    const h = renderMarkdown(md);
    expect(h).toContain('<table>');
    expect(h).toContain('<th>Phase</th>');
    expect(h).toContain('<td>foo</td>');
  });

  test('fenced code block is preserved and escaped', () => {
    const h = renderMarkdown('```\nconst x = a < b;\n```');
    expect(h).toContain('<pre><code>');
    expect(h).toContain('a &lt; b');
  });

  test('lists', () => {
    expect(renderMarkdown('- one\n- two')).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(renderMarkdown('1. a\n2. b')).toContain('<ol><li>a</li><li>b</li></ol>');
  });

  test('rejects javascript:/data: URL schemes in links (only http/relative/anchor)', () => {
    const h = renderMarkdown('[bad](javascript:alert(1)) and [ok](https://e.com) and [rel](./x.md)');
    expect(h).not.toContain('href="javascript:');
    expect(h).not.toMatch(/href="javascript/);
    expect(h).toContain('href="https://e.com"');
    expect(h).toContain('href="./x.md"');
  });

  test('HTML in source is escaped (no injection)', () => {
    const h = renderMarkdown('a <script>alert(1)</script> b');
    expect(h).not.toContain('<script>alert(1)</script>');
    expect(h).toContain('&lt;script&gt;');
  });

  test('blockquote and hr', () => {
    expect(renderMarkdown('> quoted')).toContain('<blockquote>quoted</blockquote>');
    expect(renderMarkdown('---')).toContain('<hr/>');
  });
});
