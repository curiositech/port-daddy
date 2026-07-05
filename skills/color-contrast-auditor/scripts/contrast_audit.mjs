#!/usr/bin/env node
// contrast_audit.mjs — deterministic WCAG 2.x contrast-ratio audit.
// Pure stdlib, no deps. Computes REAL relative-luminance contrast ratios
// from hex color pairs; never infers "safe" from a missing signal.
//
// Usage:
//   node contrast_audit.mjs --input <contrast-spec>.json
//
// Exports:
//   auditContrast(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// WCAG 2.x minimum ratios (2.1 §1.4.3 / §1.4.11). "ui-component" covers
// borders/icons/focus-rings, which share the 3:1 non-text floor with large
// text. "decorative" elements carry no text/meaning and are exempt.
const REQUIRED_RATIO = {
  'body-text': 4.5,
  'large-text': 3,
  'ui-component': 3,
};
const EXEMPT_USAGE = new Set(['decorative']);
const KNOWN_USAGE = new Set([...Object.keys(REQUIRED_RATIO), ...EXEMPT_USAGE]);

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function severityWeight(severity) {
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, severity)) {
    throw new Error(`unknown finding severity "${severity}" (expected one of ${Object.keys(SEVERITY_WEIGHT).join(', ')})`);
  }
  return SEVERITY_WEIGHT[severity];
}

const HEX3 = /^#?([0-9a-fA-F]{3})$/;
const HEX6 = /^#?([0-9a-fA-F]{6})$/;

/**
 * Parse a hex color string into [r, g, b] in 0-255, or null if unparseable.
 * Accepts #RGB and #RRGGBB, with or without the leading '#'.
 */
export function parseHex(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const m6 = HEX6.exec(trimmed);
  if (m6) {
    const hex = m6[1];
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  const m3 = HEX3.exec(trimmed);
  if (m3) {
    const hex = m3[1];
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  return null;
}

/** WCAG relative luminance for an sRGB [r,g,b] triple (0-255 each). */
export function relativeLuminance([r, g, b]) {
  const gamma = (channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [r, g, b].map(gamma);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio between two sRGB [r,g,b] triples. Always >= 1. */
export function contrastRatio(rgbA, rgbB) {
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditContrast: input must be a JSON object');
  }
  if (!Array.isArray(spec.pairs) || spec.pairs.length === 0) {
    throw new Error('auditContrast: "pairs" must be a non-empty array of color pairs');
  }
  for (const [i, pair] of spec.pairs.entries()) {
    if (!pair || typeof pair !== 'object') {
      throw new Error(`auditContrast: pairs[${i}] must be an object`);
    }
    if (typeof pair.name !== 'string' || pair.name.trim() === '') {
      throw new Error(`auditContrast: pairs[${i}] requires a non-empty "name"`);
    }
    if (typeof pair.foreground !== 'string' || typeof pair.background !== 'string') {
      throw new Error(`auditContrast: pairs[${i}] ("${pair.name}") requires string "foreground" and "background"`);
    }
    if (typeof pair.usage !== 'string' || !KNOWN_USAGE.has(pair.usage)) {
      throw new Error(
        `auditContrast: pairs[${i}] ("${pair.name}") "usage" must be one of ${[...KNOWN_USAGE].join(', ')}`,
      );
    }
  }
  if (spec.semanticSignals !== undefined) {
    if (!Array.isArray(spec.semanticSignals)) {
      throw new Error('auditContrast: "semanticSignals" must be an array when present');
    }
    for (const [i, signal] of spec.semanticSignals.entries()) {
      if (!signal || typeof signal !== 'object' || typeof signal.name !== 'string') {
        throw new Error(`auditContrast: semanticSignals[${i}] must have a string "name"`);
      }
      if (typeof signal.conveyedByColorOnly !== 'boolean') {
        throw new Error(`auditContrast: semanticSignals[${i}] ("${signal.name}") requires boolean "conveyedByColorOnly"`);
      }
    }
  }
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a set of foreground/background color pairs against WCAG 2.x
 * contrast minimums, computing the real relative-luminance ratio for each
 * pair rather than trusting a declared or eyeballed value. Fails closed:
 * an unparseable color or an undeclared color-only semantic signal is
 * treated as a defect, never as "probably fine."
 *
 * @param {object} spec
 * @param {Array<{name:string, foreground:string, background:string, usage:'body-text'|'large-text'|'ui-component'|'decorative'}>} spec.pairs
 * @param {Array<{name:string, conveyedByColorOnly:boolean}>} [spec.semanticSignals]
 *   Declares whether a piece of meaning (e.g. error/success state) is
 *   conveyed by color alone, with no icon/text/pattern backup (WCAG 1.4.1).
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditContrast(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  for (const pair of spec.pairs) {
    const fg = parseHex(pair.foreground);
    const bg = parseHex(pair.background);

    if (!fg || !bg) {
      const badField = !fg ? 'foreground' : 'background';
      const badValue = !fg ? pair.foreground : pair.background;
      pushFinding(
        findings, 'critical', 'invalid-color',
        `Pair "${pair.name}": ${badField} "${badValue}" is not a parseable #RGB or #RRGGBB hex color.`,
        `Fix the ${badField} value on "${pair.name}" to a valid hex color before this pair can be verified — an unparseable color cannot be assumed safe.`,
        recommendations,
      );
      continue;
    }

    if (EXEMPT_USAGE.has(pair.usage)) {
      continue;
    }

    const ratio = contrastRatio(fg, bg);
    const required = REQUIRED_RATIO[pair.usage];
    const roundedRatio = Math.round(ratio * 100) / 100;

    if (ratio < required) {
      pushFinding(
        findings, 'critical', 'contrast-below-threshold',
        `Pair "${pair.name}" (${pair.usage}): computed ratio ${roundedRatio}:1 is below the required ${required}:1 (foreground ${pair.foreground} on background ${pair.background}).`,
        `Darken "${pair.name}"'s foreground or lighten/darken its background until the computed ratio reaches ${required}:1 — see references/safe-color-pairs.md for pre-verified alternatives.`,
        recommendations,
      );
    }
  }

  for (const signal of spec.semanticSignals ?? []) {
    if (signal.conveyedByColorOnly === true) {
      pushFinding(
        findings, 'high', 'color-only-signal',
        `Semantic signal "${signal.name}" is conveyed by color alone, with no icon/text/pattern backup — fails WCAG 1.4.1 (Use of Color) regardless of contrast ratio.`,
        `Add a non-color indicator (icon, label, pattern, or underline) alongside "${signal.name}" so the meaning survives color-blindness and grayscale rendering.`,
        recommendations,
      );
    }
  }

  const totalWeight = findings.reduce((sum, f) => sum + (severityWeight(f.severity)), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push('All pairs meet their WCAG 2.x contrast floor and no semantic signal relies on color alone.');
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: contrast_audit.mjs --input <contrast-spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditContrast(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`contrast_audit: ${error.message}\n`);
    process.exit(1);
  }
}
