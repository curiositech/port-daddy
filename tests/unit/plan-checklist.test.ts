import { describe, expect, test } from '@jest/globals';
import { scanPlanChecklist } from '../../lib/plan-checklist.js';

describe('shared visible plan checklist', () => {
  test('keeps source positions separate from task ordinals and preserves CRLF', () => {
    const content = '# Plan\r\n\r\n  * [-] Working\r\n1. [X] Finished\r\n<!-- hidden --> + [ ] Last\r\n';
    const tasks = scanPlanChecklist(content);
    expect(tasks.map(({ line, checked, label }) => ({ line, checked, label }))).toEqual([
      { line: 2, checked: false, label: 'Working' },
      { line: 3, checked: true, label: 'Finished' },
      { line: 4, checked: false, label: 'Last' },
    ]);
    const lines = content.split('\n');
    for (const task of tasks) {
      expect(lines[task.line][task.marker]).toBe(task.checked ? 'X' : task.label === 'Working' ? '-' : ' ');
    }
    const selected = tasks[2];
    lines[selected.line] = lines[selected.line].slice(0, selected.marker)
      + 'x' + lines[selected.line].slice(selected.marker + 1);
    expect(lines.join('\n')).toBe(content.replace('+ [ ] Last', '+ [x] Last'));
  });

  test.each(['- [ ] Pending', '+ [-] Pending', '* [ ] Pending', '1. [-] Pending', '2) [ ] Pending'])
  ('recognizes unfinished visible task %s', (content) => {
    expect(scanPlanChecklist(content)).toEqual([
      { line: 0, marker: content.indexOf('[') + 1, checked: false, label: 'Pending' },
    ]);
  });

  test.each([
    ['empty', ''],
    ['prose', 'An example marker [ ] is not a task.'],
    ['backtick fence', '```md\n- [ ] Example\n```'],
    ['tilde fence', '~~~~md\n- [-] Example\n~~~\n- [ ] Still example\n~~~~'],
    ['unclosed fence', '```\n- [ ] Example'],
    ['HTML comment', '<!--\n- [ ] Hidden\n-->'],
    ['inline comment', '<!-- - [ ] Hidden -->'],
    ['unclosed comment', '<!--\n- [-] Hidden'],
  ])('excludes %s', (_name, content) => {
    expect(scanPlanChecklist(content)).toEqual([]);
  });

  test.each(['\n', '\r\n'])('literal comments inside fences cannot hide later tasks (%j)', (newline) => {
    const content = ['```md <!-- literal', '- [ ] Example', '```', '- [X] Actual'].join(newline);
    expect(scanPlanChecklist(content)).toEqual([
      { line: 3, marker: 3, checked: true, label: 'Actual' },
    ]);
  });

  test('a trailing comment is hidden but its preceding visible task still counts', () => {
    const content = '- [-] Actual <!-- comment\n- [ ] Hidden\n-->\n- [x] Finished';
    expect(scanPlanChecklist(content).map(({ checked, label }) => ({ checked, label }))).toEqual([
      { checked: false, label: 'Actual' }, { checked: true, label: 'Finished' },
    ]);
  });

  test('a fence after a closed comment masks examples but not the later task', () => {
    const content = '<!-- comment --> ```md\n- [ ] Example\n```\n- [ ] Actual';
    expect(scanPlanChecklist(content)).toEqual([
      { line: 3, marker: 3, checked: false, label: 'Actual' },
    ]);
  });
});
