#!/usr/bin/env tsx

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderHarnessAdapterMarkdown } from '../lib/backend-catalog.js';
import { renderHarnessContinuationMatrix } from '../lib/harness-conformance.js';

export const GENERATED_ADAPTER_TABLE_BEGIN = '<!-- BEGIN GENERATED HARNESS ADAPTER TABLE -->';
export const GENERATED_ADAPTER_TABLE_END = '<!-- END GENERATED HARNESS ADAPTER TABLE -->';
export const GENERATED_CONTINUATION_MATRIX_BEGIN = '<!-- BEGIN GENERATED HARNESS CONTINUATION MATRIX -->';
export const GENERATED_CONTINUATION_MATRIX_END = '<!-- END GENERATED HARNESS CONTINUATION MATRIX -->';
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

export function generatedHarnessContinuationMatrixSection(): string {
  return [
    GENERATED_CONTINUATION_MATRIX_BEGIN,
    '```text',
    renderHarnessContinuationMatrix().trimEnd(),
    '```',
    GENERATED_CONTINUATION_MATRIX_END,
  ].join('\n');
}

function replaceGeneratedSection(
  document: string,
  beginMarker: string,
  endMarker: string,
  generated: string,
): string {
  const begin = document.indexOf(beginMarker);
  const end = document.indexOf(endMarker);
  if (begin < 0 || end < begin) {
    throw new Error(`ADR-0118 is missing generated markers: ${beginMarker}`);
  }
  const after = end + endMarker.length;
  return `${document.slice(0, begin)}${generated}${document.slice(after)}`;
}

export function replaceGeneratedHarnessAdapterSection(document: string): string {
  const withAdapters = replaceGeneratedSection(
    document,
    GENERATED_ADAPTER_TABLE_BEGIN,
    GENERATED_ADAPTER_TABLE_END,
    generatedHarnessAdapterSection(),
  );
  return replaceGeneratedSection(
    withAdapters,
    GENERATED_CONTINUATION_MATRIX_BEGIN,
    GENERATED_CONTINUATION_MATRIX_END,
    generatedHarnessContinuationMatrixSection(),
  );
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
