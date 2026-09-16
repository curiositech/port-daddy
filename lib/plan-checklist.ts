/** One visible checklist task, located in the unchanged Markdown source. */
export interface PlanChecklistTask {
  /** Zero-based line in a newline-split plan, not a checklist ordinal. */
  line: number;
  /** UTF-16 offset of the marker character within that original line. */
  marker: number;
  checked: boolean;
  label: string;
}

/**
 * Find actionable tasks using the same grammar for plan edits and completion.
 * The design excludes fenced examples and HTML comments without rewriting the
 * original plan: marker offsets still permit a one-character, history-preserving
 * edit. This is the existing plan CLI grammar, not a general Markdown renderer.
 * Spaces and hyphens are unfinished; either case of x is complete.
 * @param content - Complete canonical Markdown plan, including its line endings.
 * @returns Visible tasks in source order with original line/marker positions.
 */
export function scanPlanChecklist(content: string): PlanChecklistTask[] {
  const lines = content.split('\n');
  const tasks: PlanChecklistTask[] = [];
  let fence: { character: string; length: number } | undefined;
  let comment = false;
  for (let line = 0; line < lines.length; line++) {
    // Fence contents are literal examples, including apparent HTML comments.
    if (fence) {
      const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[line]);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = undefined;
      continue;
    }
    // An eligible fence owns its entire info string, even apparent HTML. Do
    // this before comment scanning, but never open a fence inside a comment.
    const opening = !comment && /^\s*(`{3,}|~{3,})(.*)\r?$/.exec(lines[line]);
    if (opening) {
      fence = { character: opening[1][0], length: opening[1].length };
      continue;
    }
    // Mask comments positionally, including a comment opened after a visible
    // task. Offsets still address the original canonical string positions.
    const visible = lines[line].split('');
    for (let at = 0; at < lines[line].length;) {
      if (!comment && lines[line].startsWith('<!--', at)) comment = true;
      if (comment && lines[line].startsWith('-->', at)) {
        visible.fill(' ', at, at + 3);
        comment = false;
        at += 3;
      } else {
        if (comment) visible[at] = ' ';
        at++;
      }
    }
    const visibleLine = visible.join('');
    const boundary = /^\s*(`{3,}|~{3,})(.*)\r?$/.exec(visibleLine);
    if (boundary) {
      fence = { character: boundary[1][0], length: boundary[1].length };
      continue;
    }
    const task = /^(\s*(?:[-+*]|\d+[.)])\s+\[)([ xX-])(\]\s+)(.*)\r?$/.exec(visibleLine);
    if (task) tasks.push({ line, marker: task[1].length, checked: /[xX]/.test(task[2]), label: task[4].trim() });
  }
  return tasks;
}
