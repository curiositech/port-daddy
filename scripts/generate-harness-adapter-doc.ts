#!/usr/bin/env tsx

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderHarnessAdapterMarkdown } from '../lib/backend-catalog.js';

export const GENERATED_ADAPTER_TABLE_BEGIN = '<!-- BEGIN GENERATED HARNESS ADAPTER TABLE -->';
export const GENERATED_ADAPTER_TABLE_END = '<!-- END GENERATED HARNESS ADAPTER TABLE -->';
export const HARNESS_ADAPTER_ADR_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'docs',
  'adr',
  '0118-harness-adapter-contract.md',
);

export function generatedHarnessAdapterSection(): string {
  return [
    GENERATED_ADAPTER_TABLE_BEGIN,
    renderHarnessAdapterMarkdown().trimEnd(),
    GENERATED_ADAPTER_TABLE_END,
  ].join('\n');
}

export function replaceGeneratedHarnessAdapterSection(document: string): string {
  const begin = document.indexOf(GENERATED_ADAPTER_TABLE_BEGIN);
  const end = document.indexOf(GENERATED_ADAPTER_TABLE_END);
  if (begin < 0 || end < begin) {
    throw new Error('ADR-0118 is missing the generated harness adapter table markers');
  }
  const after = end + GENERATED_ADAPTER_TABLE_END.length;
  return `${document.slice(0, begin)}${generatedHarnessAdapterSection()}${document.slice(after)}`;
}

function main(): void {
  const current = readFileSync(HARNESS_ADAPTER_ADR_PATH, 'utf8');
  const generated = replaceGeneratedHarnessAdapterSection(current);
  if (process.argv.includes('--write')) {
    writeFileSync(HARNESS_ADAPTER_ADR_PATH, generated, 'utf8');
    console.log(`Wrote ${HARNESS_ADAPTER_ADR_PATH}`);
    return;
  }
  if (current !== generated) {
    console.error('ADR-0118 harness adapter table is stale. Run this script with --write.');
    process.exitCode = 1;
    return;
  }
  console.log('ADR-0118 harness adapter table is current.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
