#!/usr/bin/env node

/**
 * Read-only live commentary for the Porthole Parley source recording.
 *
 * This polls GET /parley/:id without an `as` query, so it cannot advance a
 * participant's seen receipt. It repeats only the participants' public text
 * and labels what changed in the durable protocol. It never claims to expose
 * private reasoning or chain of thought.
 */

import { readFile } from 'node:fs/promises';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const idFile = arg('--id-file');
const doneFile = arg('--done-file');
const noraFile = arg('--nora-file');
const miloFile = arg('--milo-file');
const ayaFile = arg('--aya-file');
const expectedTurns = Number(arg('--expected-turns', '6'));
const daemonUrl = (process.env.PORT_DADDY_URL ?? process.env.PD_PORTHOLE_DAEMON_URL ?? '').replace(/\/$/, '');

if (!idFile || !doneFile || !noraFile || !miloFile || !ayaFile) {
  throw new Error('live commentary requires id, completion, and three participant identity files');
}
if (!daemonUrl) throw new Error('live commentary requires PORT_DADDY_URL');
if (!Number.isSafeInteger(expectedTurns) || expectedTurns < 1 || expectedTurns > 32) {
  throw new Error('expected turn count must be between 1 and 32');
}

const participantStyles = [
  { file: noraFile, name: 'NORA', shape: '◆', color: 114 },
  { file: miloFile, name: 'MILO', shape: '◇', color: 117 },
  { file: ayaFile, name: 'AYA', shape: '●', color: 208 },
];
const actionLabels = {
  propose: ['OPENING POSITION', 'opens a candidate plan; nothing is settled'],
  critique: ['RISK EXPOSED', 'names a blocking failure mode the proposal must answer'],
  inform: ['CONSTRAINT ADDED', 'adds execution evidence the shared plan must preserve'],
  revise: ['PLAN CHANGED', 'records how the proposal changed after public objections'],
  agree: ['OBJECTION CLOSED', 'closes one participant’s objection; this is not global settlement'],
  refuse: ['DISSENT RECORDED', 'keeps refusal explicit and prevents false consensus'],
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function optionalText(path) {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function participantByActor() {
  const pairs = await Promise.all(participantStyles.map(async (style) => [await optionalText(style.file), style]));
  return new Map(pairs.filter(([actor]) => actor));
}

console.log('\u001b[1;38;5;45mPORT DADDY WITNESS · READ ONLY\u001b[0m');
console.log('\u001b[38;5;250mpublic rationale as committed · no read receipt · no private chain of thought\u001b[0m\n');

const startedAt = Date.now();
let emitted = 0;
let parleyId = '';
while (Date.now() - startedAt < 80_000) {
  parleyId ||= await optionalText(idFile);
  if (!parleyId) {
    await sleep(200);
    continue;
  }

  const response = await fetch(`${daemonUrl}/parley/${encodeURIComponent(parleyId)}`);
  if (!response.ok) throw new Error(`read-only Parley witness received HTTP ${response.status}`);
  const payload = await response.json();
  const summary = payload.summary ?? payload;
  const turns = Array.isArray(summary.turns) ? summary.turns : [];
  const identities = await participantByActor();

  for (const turn of turns.slice(emitted)) {
    const style = identities.get(turn.party) ?? { name: turn.party, shape: '•', color: 250 };
    const [label, explanation] = actionLabels[turn.performative] ?? ['DURABLE TURN', 'adds a public statement to the shared record'];
    console.log(`\u001b[1;38;5;${style.color}m${style.shape} ${style.name}\u001b[0m  \u001b[1;38;5;221m${label}\u001b[0m`);
    console.log(`\u001b[38;5;255m${turn.content}\u001b[0m`);
    console.log(`\u001b[38;5;45mWITNESS\u001b[0m · ${explanation}\n`);
    emitted += 1;
  }

  const done = Boolean(await optionalText(doneFile));
  if (done && emitted === turns.length && emitted >= expectedTurns) {
    console.log(`\u001b[1;38;5;114mCAUGHT UP · ${emitted} durable turns\u001b[0m`);
    console.log(`\u001b[38;5;250mstate ${summary.status ?? 'unknown'} · settlement ${summary.outcome ? 'recorded' : 'none'}\u001b[0m`);
    process.exit(0);
  }
  await sleep(250);
}

throw new Error(`live commentary timed out after emitting ${emitted}/${expectedTurns} expected turns`);
