import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';
import { readCurrentContext } from '../utils/current-context.js';

export async function handlePlan(args: string[], options: CLIOptions): Promise<void> {
  const action = args[0];
  const data = args.slice(1).join(' ');
  const current = readCurrentContext();
  const sessionId = (options.session as string) || current?.sessionId;

  if (!sessionId) {
    ui.error('No active session found. Use --session <id> or start one with pd begin.');
    process.exit(1);
  }

  const act = action || 'show';

  if (act === 'show') {
    const res = await pdFetch(`${PORT_DADDY_URL}/sessions/${sessionId}/notes?type=todo_list`);
    const json = (await res.json()) as any;
    if (!res.ok) {
      ui.error(json.error || 'Failed to fetch plan');
      process.exit(1);
    }
    const plans = json.notes || [];
    if (plans.length === 0) {
      console.log('No plan exists for this session.');
      return;
    }
    const latestPlan = plans[plans.length - 1];
    console.log(`Plan for session ${sessionId}:\n`);
    console.log(latestPlan.content || latestPlan.note);
    return;
  }

  if (act === 'set') {
    if (!data) {
      ui.error('Usage: pd plan set "<markdown checklist>"');
      process.exit(1);
    }
    const res = await pdFetch(`${PORT_DADDY_URL}/sessions/${sessionId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note: data,
        content: data,
        type: 'todo_list',
        agentId: current?.agentId
      })
    });
    if (!res.ok) {
      const json = (await res.json()) as any;
      ui.error(json.error || 'Failed to set plan');
      process.exit(1);
    }
    if (!isQuiet(options)) console.log(`Plan updated for session ${sessionId}`);
    return;
  }

  if (act === 'check') {
    if (!data) {
      ui.error('Usage: pd plan check "<item text or index>"');
      process.exit(1);
    }
    const res = await pdFetch(`${PORT_DADDY_URL}/sessions/${sessionId}/notes?type=todo_list`);
    const json = (await res.json()) as any;
    const plans = json.notes || [];
    if (plans.length === 0) {
      ui.error('No plan exists for this session.');
      process.exit(1);
    }
    const latestPlan = plans[plans.length - 1].content || plans[plans.length - 1].note;
    const lines = latestPlan.split('\n');
    const index = parseInt(data, 10);
    
    let updated = false;
    if (!isNaN(index) && index > 0 && index <= lines.length) {
      lines[index - 1] = lines[index - 1].replace(/\[ \]/, '[x]').replace(/\[-\]/, '[x]');
      updated = true;
    } else {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(data) && (lines[i].includes('[ ]') || lines[i].includes('[-]'))) {
          lines[i] = lines[i].replace(/\[ \]/, '[x]').replace(/\[-\]/, '[x]');
          updated = true;
          break;
        }
      }
    }

    if (!updated) {
      ui.error('Could not find unchecked item matching: ' + data);
      process.exit(1);
    }

    const setRes = await pdFetch(`${PORT_DADDY_URL}/sessions/${sessionId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note: lines.join('\n'),
        content: lines.join('\n'),
        type: 'todo_list',
        agentId: current?.agentId
      })
    });
    if (!setRes.ok) {
      ui.error('Failed to save updated plan');
      process.exit(1);
    }
    if (!isQuiet(options)) console.log(`Plan item checked off.`);
    return;
  }

  ui.error(`Unknown plan action: ${act}. Use show, set, or check.`);
  process.exit(1);
}
