#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, "index.html"), "utf8");
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

expect(/STATIC PROTOTYPE/.test(html), "missing static-prototype disclosure");
expect(/No runtime, provider, daemon, network, or command channel/.test(html), "missing no-runtime disclosure");
expect(/<span id="prototype-truth">Truth: T0_STATIC_WITH_T1_MODEL_FIXTURE · Anchor:/.test(html), "prototype rail must carry the exact composite truth label");
expect(/NO EXECUTION AUTHORITY/.test(html), "missing authority footer");
expect(/BLOCKED_BY_HALT/.test(html), "missing halt truth state");

for (const [name, panel] of [
  ["proposal", "panel-proposal"],
  ["work", "panel-work"],
  ["review", "panel-review"],
]) {
  expect(new RegExp(`id="tab-${name}"[^>]+role="tab"[^>]+aria-controls="${panel}"`).test(html), `missing bound ${name} tab`);
  expect(new RegExp(`id="${panel}"[^>]+role="tabpanel"[^>]+aria-labelledby="tab-${name}"`).test(html), `missing bound ${name} panel`);
}
expect(/role="tablist"/.test(html), "missing tablist semantics");
expect(/ArrowRight/.test(html) && /ArrowLeft/.test(html) && /Home/.test(html) && /End/.test(html), "missing roving keyboard navigation");

const buttonTags = html.match(/<button\b[^>]*>/g) ?? [];
expect(buttonTags.length >= 10, "prototype needs its full control vocabulary");
for (const button of buttonTags) expect(/\btype="button"/.test(button), `button lacks inert explicit type: ${button}`);

for (const forbidden of [
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket\s*\(/,
  /EventSource\s*\(/,
  /sendBeacon\s*\(/,
  /<form\b/i,
  /<script[^>]+src=/i,
  /<link[^>]+href=/i,
]) {
  expect(!forbidden.test(html), `prototype contains forbidden effect or dependency: ${forbidden}`);
}

expect(/data-evidence="proposal"/.test(html), "missing first evidence activation");
expect(/data-open-primary/.test(html) && /#primary-evidence/.test(html), "missing second activation to primary evidence");
expect(/≤2 activations/.test(html), "missing evidence-zoom ceiling");
expect(!/\.innerHTML\s*=/.test(html), "evidence values must not flow through an HTML parsing sink");
expect(/fields\.replaceChildren\(\)/.test(html), "evidence dialog must clear nodes without parsing HTML");
expect(/term\.textContent = key/.test(html) && /description\.textContent = value/.test(html), "evidence dialog must render keys and values as text");
expect(/BLOCKED_BY_HALT[\s\S]+UNKNOWN[\s\S]+UNTESTED_HUMAN/.test(html), "result vector must preserve subordinate non-pass states");
expect(/Preview Stop sequence/.test(html) && /No host request will be sent/.test(html), "Stop preview lacks local-only boundary");
expect(/Request prepared locally[\s\S]+Delivery not witnessed[\s\S]+teardown not witnessed/.test(html), "Stop lifecycle is collapsed or incomplete");
expect(/@media \(prefers-reduced-motion: reduce\)/.test(html), "missing reduced-motion branch");
expect(/@media \(forced-colors: active\)/.test(html), "missing forced-colors branch");
expect(/\.shell > \*, \.masthead > \*, \.workspace > \*, \.authority-footer > \* \{ min-width: 0; \}/.test(html), "missing intrinsic-grid overflow guard");
expect(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html), "missing responsive viewport contract");

const result = {
  valid: failures.length === 0,
  failures,
  counts: {
    buttons: buttonTags.length,
    tabs: (html.match(/role="tab"/g) ?? []).length,
    panels: (html.match(/role="tabpanel"/g) ?? []).length,
    evidenceTriggers: (html.match(/data-evidence=/g) ?? []).length,
  },
  truth: "T0_STATIC_WITH_T1_MODEL_FIXTURE",
  runtimeAuthority: "NONE",
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.valid ? 0 : 1);
