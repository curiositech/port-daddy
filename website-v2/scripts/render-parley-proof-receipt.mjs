#!/usr/bin/env node

/**
 * Render the actual JSON returned by `pd parley show --json` as a compact,
 * audience-facing decision receipt. The raw two-pane protocol transcript is
 * retained separately as evidence; this formatter deliberately does not turn
 * debug protocol verbs into the product-facing recording.
 */
import { readFileSync } from 'node:fs';

const roleFlag = process.argv.indexOf('--role');
const role = roleFlag >= 0 ? process.argv[roleFlag + 1] : 'participant';
const input = readFileSync(0, 'utf8').trim();

if (!input) throw new Error('decision receipt needs JSON from pd parley show --json');

const parsed = JSON.parse(input);
const summary = parsed.summary ?? parsed;
const parley = summary.parley ?? {};
const turns = Array.isArray(summary.turns) ? summary.turns : [];
const receipts = Array.isArray(summary.receipts) ? summary.receipts : [];
const stage = {
  propose: 'opening position',
  critique: 'risk exposed',
  revise: 'revised settlement',
  agree: 'review confirmed',
  refuse: 'dissent recorded',
  inform: 'evidence added',
};

function line(label, value) {
  console.log(`  \u001b[38;5;117m${label.padEnd(10)}\u001b[0m ${value}`);
}

console.log(`\u001b[1;38;5;221mDECISION RECEIPT · ${role.toUpperCase()}\u001b[0m`);
line('surface', parley.surface ?? 'unknown surface');
line('state', summary.status ?? 'unknown');
line('parties', Array.isArray(parley.parties) ? parley.parties.join(', ') : 'unknown');
line('missing', Array.isArray(summary.missingParties) && summary.missingParties.length ? summary.missingParties.join(', ') : 'none');

console.log(`\n  \u001b[38;5;114mDECISION PATH (${turns.length})\u001b[0m`);
for (const [index, turn] of turns.entries()) {
  const label = stage[turn.performative] ?? 'recorded step';
  console.log(`  ${String(index + 1).padStart(2, '0')} · \u001b[1m${label}\u001b[0m · ${turn.party}`);
  console.log(`       ${turn.content}`);
}

console.log('\n  \u001b[38;5;114mREAD RECEIPTS\u001b[0m');
for (const receipt of receipts) {
  const state = receipt.unseenTurns === 0 ? 'caught up' : `${receipt.unseenTurns} unseen`;
  console.log(`  ${receipt.party} · ${state}`);
}
