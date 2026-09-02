import { pdFetch, PORT_DADDY_URL, type FetchOptions } from '../utils/fetch.js';
import { type CLIOptions, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';
import { resolveCurrentContext } from '../utils/current-context.js';
import { resolveCliActorCredential } from '../utils/actor-credential.js';

/**
 * Read or append an exact session's canonical checklist. The design binds writes
 * to the selected caller, never to a credential discovered from the target.
 * Updates append a complete plan; they are not an atomic compare-and-swap.
 * @param args - Action followed by complete Markdown or an exact task selector.
 * @param options - CLI options; session selects the target, not its authority.
 * @returns After displaying the plan or receiving a successful append receipt.
 */
export async function handlePlan(args: string[], options: CLIOptions): Promise<void> {
  const action = args[0] || 'show';
  const data = args.slice(1).join(' ');
  /**
   * The purpose is one bounded diagnostic and an unsuccessful CLI result.
   * @param message - Local diagnostic, never an arbitrary remote body.
   * @returns Never; exit keeps failed writes from looking successful.
   */
  const fail: (message: string) => never = (message) => {
    ui.error(message);
    process.exit(1);
  };
  if (!['show', 'set', 'check'].includes(action)) fail('Unknown plan action. Use show, set, or check.');
  const resolution = resolveCurrentContext();
  if (!resolution.success) {
    fail('CONTEXT_CONFLICT: environment identity and context slot disagree. Inspect pd whoami and select the intended caller context; --session changes only the target.');
  }
  const current = resolution.context;
  if (options.session !== undefined && (typeof options.session !== 'string' || !options.session.trim())) {
    fail('Invalid --session target. Supply an exact non-empty session id; no active-session fallback was selected.');
  }
  const sessionId = typeof options.session === 'string' && options.session.trim()
    ? options.session.trim() : current?.sessionId;
  if (!sessionId) fail('No active session found. Use --session <id> to read an exact plan, or pd begin for new work.');
  if (action !== 'show' && !data.trim()) fail(`Usage: pd plan ${action} "${action === 'set' ? '<markdown checklist>' : '<task number or exact label>'}"`);
  if (action !== 'show' && !current?.agentId) {
    fail('CALLER_CONTEXT_REQUIRED: select your existing caller context before writing. --session does not borrow the target owner’s credential.');
  }
  const credential = current?.agentId ? resolveCliActorCredential(current.agentId) : undefined;
  if (action !== 'show' && !credential) {
    fail('IDENTITY_CREDENTIAL_REQUIRED: no credential is available for the selected caller. Inspect pd whoami; no other context or identity was substituted.');
  }
  const headers: Record<string, string> = credential ? { 'x-actor-credential': credential } : {};
  const notesUrl = `${PORT_DADDY_URL}/sessions/${encodeURIComponent(sessionId)}/notes`;
  // One total command budget, not only the socket's resettable inactivity timer.
  const signal = AbortSignal.timeout(10_000);
  // Never print arbitrary response bodies, nested errors, credential-bearing
  // URLs, or transport exceptions. Status plus an allowlisted hint is useful.
  const hints: Record<string, string> = {
    IDENTITY_CREDENTIAL_REQUIRED: 'The daemon requires the selected caller’s credential.',
    IDENTITY_CREDENTIAL_INVALID: 'The daemon rejected the selected caller’s credential.',
    IDENTITY_ALIAS_MISMATCH: 'The caller alias does not belong to the presented actor.',
    SESSION_OWNERSHIP_MISMATCH: 'The selected caller does not own this exact session.',
    SESSION_OWNER_UNVERIFIABLE: 'The daemon cannot verify the stored session owner.',
    SESSION_NOT_ACTIVE: 'The exact session is not active; no automatic resume was attempted.',
    SESSION_NOT_FOUND: 'The exact session does not exist on the selected daemon.',
    SESSION_SCOPE_REQUIRED: 'The daemon requires an exact session target.',
    VALIDATION_ERROR: 'The daemon rejected the plan payload.',
    ADVERSARIAL_PROJECT_GUARD: 'This project requires its protected note envelope.',
  };
  /**
   * The design makes one attempt on the selected transport; appends are not
   * idempotent, so ambiguous completion must be inspected rather than replayed.
   * @param operation - Read or append, used for bounded outcome diagnostics.
   * @param init - Method and canonical payload; caller credential stays fixed.
   * @returns Valid JSON or an unsuccessful, privacy-preserving CLI outcome.
   */
  const request = async (operation: 'read' | 'append', init: FetchOptions): Promise<Record<string, unknown>> => {
    let response;
    try {
      response = await pdFetch(notesUrl + (operation === 'read' ? '?type=todo_list&limit=1' : ''), {
        ...init, headers: { ...headers, ...init.headers }, retry: false, socketFallback: false, signal,
      });
    } catch {
      return fail(`Plan ${operation} transport failed. ${operation === 'append' ? 'The append outcome is unknown; read the exact plan before retrying.' : 'Nothing was written.'}`);
    }
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = await response.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
    } catch { /* Status remains useful even when the body is not JSON. */ }
    if (!response.ok || body?.success === false) {
      const code = typeof body?.code === 'string' && Object.hasOwn(hints, body.code) ? body.code : null;
      fail(`Plan ${operation} failed (HTTP ${response.status ?? 'unknown'}${code ? `, ${code}` : ''}). ${code ? hints[code] : 'The selected daemon rejected the request.'}`);
    }
    if (!body) fail(`Plan ${operation} returned malformed JSON. ${operation === 'append' ? 'The append outcome is unknown; read the exact plan before retrying.' : 'Nothing was written.'}`);
    return body;
  };
  /**
   * Append rather than overwrite: the design retains original plan evidence.
   * @param content - Complete canonical plan with the selected marker changed.
   * @returns After receiving this exact session's note receipt.
   */
  const append = async (content: string): Promise<void> => {
    const result = await request('append', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // The server checks its stamped owner; a redundant display agentId can
      // falsely conflict even when this caller presents the same actor.
      body: JSON.stringify({ content, type: 'todo_list' }),
    });
    if (result.success !== true || result.sessionId !== sessionId || !Number.isSafeInteger(result.noteId)) {
      fail('Plan append receipt is incomplete or names a different session. Read the exact plan before retrying; no automatic retry was attempted.');
    }
  };
  if (action === 'set') {
    await append(data);
    if (!isQuiet(options)) console.log(`Plan updated for session ${sessionId}`);
    return;
  }
  const result = await request('read', {});
  if (!Array.isArray(result.notes)) fail('Plan read returned an invalid notes envelope. Nothing was written.');
  const plans = result.notes as Array<{ id: number; createdAt: number; content: string; sessionId: string; type: string }>;
  if (plans.some((note) => !note || note.sessionId !== sessionId || note.type !== 'todo_list'
    || !Number.isSafeInteger(note.id) || !Number.isFinite(note.createdAt) || typeof note.content !== 'string')) {
    fail('Plan read returned an invalid or wrong-session note. Nothing was written.');
  }
  if (!plans.length) {
    if (action === 'check') fail('No plan exists for this exact session. Nothing was written.');
    console.log('No plan exists for this session.');
    return;
  }
  // The session API returns the newest tail. Explicit timestamp/id ordering
  // also keeps adapters from accidentally selecting the first/oldest note.
  const latest = [...plans].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).at(-1)!;
  if (action === 'show') {
    console.log(`Plan for session ${sessionId}:\n`);
    console.log(latest.content);
    return;
  }
  const lines = latest.content.split('\n');
  const tasks: Array<{ line: number; marker: number; checked: boolean; label: string }> = [];
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
  const selector = data.trim();
  let target;
  if (/^\d+$/.test(selector)) {
    const ordinal = Number(selector);
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > tasks.length) fail(`Task number out of range: this plan has ${tasks.length} checklist items.`);
    target = tasks[ordinal - 1];
  } else {
    const matches = tasks.filter((task) => task.label === selector);
    if (matches.length > 1) fail('Ambiguous task label. Use its checklist number; nothing was written.');
    if (!matches.length) fail('No exact task label matches. Use the complete label or its checklist number; nothing was written.');
    target = matches[0];
  }
  if (target.checked) fail('That task is already checked; no duplicate plan was appended.');
  const line = lines[target.line];
  lines[target.line] = line.slice(0, target.marker) + 'x' + line.slice(target.marker + 1);
  await append(lines.join('\n'));
  if (!isQuiet(options)) console.log('Plan item checked off.');
}
