import { PRODUCT_FEATURES } from '@/data/product'
import type { DocsContentSection } from './types'

const productPrimitiveItems = PRODUCT_FEATURES.map(
  (feature) => `${feature.title}: ${feature.description}`,
)

export const tutorialsSection: DocsContentSection = {
  slug: 'tutorials',
  title: 'Tutorials',
  summary:
    'Longer guided workflows that take you from a clean machine or repo to useful Port Daddy habits.',
  pages: [
    {
      slug: 'bootstrap-a-project-fleet',
      title: 'Bootstrap A Project Fleet',
      summary:
        'Create the starter fleet file, validate it, and bring the first project automation loop online.',
      truth: 'source-backed',
      goals: [
        'Initialize a real fleet config.',
        'Validate the topology before it starts running.',
        'Know where to inspect the fleet once it is alive.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Bring automation online without hand-wiring scripts',
          paragraphs: [
            'A fleet is the always-on side of Port Daddy. It is where repo stewardship moves from one-shot delegation into declared background automation: triggers, schedules, singleton guards, and the project-wide operating loop.',
            'This tutorial is about getting to that first live loop without drama. The goal is not to dazzle you with twenty agents. The goal is to create one readable fleet file, validate it, and watch Port Daddy manage it instead of hiding behavior in shell scripts.',
          ],
        },
        {
          type: 'command',
          title: 'Initialize and validate the fleet',
          command: 'pd fleet init\npd fleet validate\npd fleet up\npd fleet status',
          output: 'SUCCESS: Created pd-fleet.yml\nSUCCESS: Fleet "myapp-dev" parsed successfully\nSUCCESS: Fleet started\nFleet: 1 project(s), 5 agent(s), 3/5 launchable',
          notes: [
            'Initialize the project config first so the topology is declared on disk.',
            'Validate before starting so bad YAML or broken topology does not become a runtime mystery.',
            'Bring the fleet up only after the config parses cleanly.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Expect `pd-fleet.yml` to become part of the project’s operating contract.',
            'Use `pd fleet status` as the quick check after startup.',
            'Treat trigger channels and singleton policy as part of the fleet’s correctness, not as incidental config detail.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What completion looks like',
          paragraphs: [
            'You are done when the project has one readable fleet definition, Port Daddy can validate it, and the status view explains what is armed and why.',
            'At that point, the fleet stops looking like magic background AI. It becomes project automation you can inspect, pause, resume, and debug.',
          ],
        },
      ],
      sources: [
        {
          path: 'README.md',
          rationale: 'README documents `pd fleet init`, `pd fleet validate`, `pd fleet up`, and `pd fleet status` as the user-facing workflow.',
        },
        {
          path: 'docs/adr/0019-declarative-fleet-yaml.md',
          rationale: 'ADR defines the `pd-fleet.yml` model and the CLI lifecycle around it.',
        },
        {
          path: 'routes/fleet.ts',
          rationale: 'Fleet routes expose bootstrap, status, reload, and config behavior for the running daemon.',
        },
      ],
    },
    {
      slug: 'recover-a-dead-agent-session',
      title: 'Recover A Dead Agent Session',
      summary:
        'Use the salvage queue to pick up abandoned work, inspect the inherited context, and continue without losing the original thread.',
      truth: 'source-backed',
      goals: [
        'Treat salvage as a normal recovery workflow.',
        'Inspect the dead agent context before continuing.',
        'Bring the work back into an active session.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Recovery is part of the product, not a footnote',
          paragraphs: [
            'Agents die. Terminals close. Background work gets interrupted. Port Daddy keeps a salvage queue because this is normal, not rare.',
            'This tutorial shows the recovery path you should actually expect to use: inspect the queue, claim the abandoned work, and continue from the preserved session context instead of rebuilding the thread from memory.',
          ],
        },
        {
          type: 'command',
          title: 'Inspect and claim the dead work',
          command: 'pd salvage --project myapp\npd salvage claim dead-agent-99\npd notes --session <session-id>',
          output: 'Recoverable work for myapp:\n  dead-agent-99  abandoned  auth layer\nSUCCESS: Salvage claimed dead-agent-99\n[progress] Preserved context is ready for recovery.',
          notes: [
            'Start with the queue so you know what died and how long ago.',
            'Claiming returns the preserved context for that dead agent.',
            'Read the session notes before you resume work so the continuation is evidence-based, not guessed.',
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Do not bypass the queue with fresh anonymous work',
          body:
            'If an agent died mid-task and you simply start over without salvage, you have thrown away the saved context Port Daddy preserved for you.',
        },
        {
          type: 'paragraph',
          title: 'What a good salvage handoff feels like',
          paragraphs: [
            'A good salvage claim gives you enough context to continue confidently: session id, purpose, notes, and any file or task state that survived the crash. You should feel like you inherited a trail, not like you got a vague hint.',
            'If the queue is empty when it should not be, that is a product bug worth investigating. The tutorial outcome is not only “continue the work.” It is “prove Port Daddy preserved recoverable state in the first place.”',
          ],
        },
      ],
      sources: [
        {
          path: 'website-v2/src/data/docs.ts',
          rationale: 'CLI reference documents `pd salvage` and `pd salvage claim` as the recovery path.',
        },
        {
          path: 'README.md',
          rationale: 'README shows salvage queue inspection and claim commands in the core coordination workflow.',
        },
        {
          path: 'AGENTS.md',
          rationale: 'Repo instructions tell users to run salvage when abandoned work might still matter.',
        },
      ],
    },
    {
      slug: 'launch-and-inspect-a-sortie',
      title: 'Launch And Inspect A Sortie',
      summary:
        'Create a tracked mission, inspect the saved sortie record, and read the event log.',
      truth: 'source-backed',
      goals: [
        'Use the shipped sortie workflow as it exists today.',
        'Inspect status and logs from the persisted record.',
        'Understand the current boundary between shipped sortie state and future richer orchestration.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Use sortie for tracked missions',
          paragraphs: [
            'A sortie is for work you want to inspect later as a mission, not just as one terminal run. The current slice is intentionally modest: it gives you a durable id, a persisted mission record, and an event log you can read back after the coordinating run finishes.',
            'That matters because many delegation failures are really inspection failures. If you cannot come back later and understand what happened, the system has not given you a useful mission record. This tutorial stays inside what the repo actually ships today.',
          ],
        },
        {
          type: 'command',
          title: 'Run and inspect the sortie',
          command:
            'pd sortie "Review the latest auth changes and summarize the real risks" --budget 0.50\npd sortie list\npd sortie status <sortie-id>\npd sortie logs <sortie-id>',
          output: 'SUCCESS: Sortie sortie-1234 created\nsortie-1234  running  Review the latest auth changes\nStatus: completed\n[sortie-1234] completed with residual risk summary',
          notes: [
            'Launch with an explicit budget ceiling so spend stays visible.',
            'Use the persisted sortie id for later inspection instead of scraping raw child-process output.',
            'Read the logs when you need the event narrative, not just the final status.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Expect durable ids, status, and logs from the shipped slice.',
            'Do not expect approval queues or rich multi-agent mission authoring yet.',
            'Use sortie when you need a tracked mission, not when one bounded `pd agent` run is enough.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What the current slice buys you',
          paragraphs: [
            'The shipped slice already solves one important user problem: you can launch a mission, walk away, and return to a durable record instead of hoping the terminal scrollback still tells the story.',
            'The richer multi-agent mission engine is still a later layer. The tutorial should make that boundary feel crisp rather than coy, because that honesty is what keeps the docs credible.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/DELEGATION-MODES.md',
          rationale: 'Delegation modes document defines current sortie behavior and gaps.',
        },
        {
          path: 'routes/sorties.ts',
          rationale: 'Sortie routes expose create, list, status, and logs on the live daemon.',
        },
        {
          path: 'tests/unit/sortie-cli.test.js',
          rationale: 'CLI tests cover sortie launch, status lookup, and log inspection behavior.',
        },
      ],
    },
    {
      slug: 'walk-the-eleven-primitives',
      title: 'Walk The Primitives',
      summary:
        'Use the Mac app and CLI together so every public primitive has a concrete place in a first-day workflow.',
      truth: 'source-backed',
      goals: [
        'Tie the public primitive cards to real product features.',
        'Use FleetBar, Shipwright, and Flow in one cold-start path.',
        'Know which docs and tutorial page to open next.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Start from the product',
          paragraphs: [
            'Open the Mac preview when the question is visual: what does the app do, what does FleetBar embed, and where do resources, sorties, Shipwright, backend readiness, and agent communication appear?',
            'Open the primitives tutorial when the question is procedural: which command or app view proves each primitive is real, and what should you inspect after running it?',
          ],
        },
        {
          type: 'command',
          title: 'Move through the first-day primitive path',
          command:
            'pd setup --project ~/coding/my-app\npd status\npd briefing\npd fleet models\npd guard status\npd salvage --project my-app',
          output: 'SUCCESS: Setup complete for ~/coding/my-app\nPort Daddy is running\nSUCCESS: Briefing generated: .portdaddy/briefing.md\n3 launchable backend tiers\nCoordination Guard: enforce\nNo recoverable work for my-app',
          notes: [
            'Setup installs the local daemon and FleetBar path.',
            'Status, briefing, model readiness, guard status, and salvage show whether the product is ready before you launch more work.',
            'Shipwright and Flow keep the proposed fleet attached to project identity after cold start.',
          ],
        },
        {
          type: 'checklist',
          items: productPrimitiveItems,
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Tutorial and docs coverage are paired',
          body:
            'Concepts names the primitives and explains the model. The primitives tutorial walks them as a first-day path using the Mac app, CLI, and Fleet Control Center together.',
        },
      ],
      sources: [
        {
          path: 'website-v2/src/data/product.ts',
          rationale: 'The product data is the source for the primitive names and descriptions.',
        },
        {
          path: 'website-v2/src/data/tutorials.ts',
          rationale: 'The tutorial catalog exposes the dedicated primitives walkthrough.',
        },
      ],
    },
    {
      slug: 'pd-tube-agent-handoffs',
      title: 'PD Tube Agent Handoffs',
      summary:
        'Send, reply, and resume a daemon-backed channel conversation, then inspect the same output as a terminal recording.',
      truth: 'source-backed',
      goals: [
        'Use PD Tube for durable threaded handoffs.',
        'Prove the output came from the live daemon.',
        'Regenerate the checked-in cast and GIF artifacts.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Coordination should be visible while it happens',
          paragraphs: [
            'The strongest Port Daddy demo is not a polished final summary. It is the operator seeing agents inspect live sessions, check file ownership, message an overlapping worker, and publish proof through a shared channel before edits collide.',
            'PD Tube gives that story a tiny command surface. It wraps a daemon channel in a thread-aware envelope and emits clean JSON lines so humans, scripts, and agents can read the same trail.',
          ],
        },
        {
          type: 'command',
          title: 'Run the live proof script',
          command:
            'examples/pd-tube/demo.sh\nasciinema rec --overwrite -q -c "examples/pd-tube/demo.sh" demos/pd-tube/pd-tube-real-output.cast\nagg demos/pd-tube/pd-tube-real-output.cast demos/pd-tube/pd-tube-real-output.gif\nvhs demos/pd-tube/pd-tube-real-output.tape',
          output: 'SUCCESS: tube: posted id=30160 to port-daddy:demo:tube\nSUCCESS: tube: posted reply id=30161 to port-daddy:demo:tube\nwrote demos/pd-tube/pd-tube-real-output.cast\nwrote demos/pd-tube/pd-tube-real-output.gif',
          notes: [
            'The script posts two real messages to `port-daddy:demo:tube`.',
            'The second message replies to the first id.',
            'The readback command proves both rows came from live daemon channel history.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Use `--send` and `--reply` with stdin so scripts cannot accidentally hang on a missing message body.',
            'Use `--once --json` for deterministic automation.',
            'Use `--since` for explicit cursors, and `--no-history` only when recording or testing.',
          ],
        },
      ],
      sources: [
        {
          path: 'cli/commands/tube.ts',
          rationale: 'CLI implementation defines listen, send, reply, cursor, and JSON behavior.',
        },
        {
          path: 'lib/tube.ts',
          rationale: 'Core tube module defines the envelope, decoding, history guard, send, reply, and listen operations.',
        },
        {
          path: 'demos/pd-tube/pd-tube-real-output.cast',
          rationale: 'Asciinema artifact records real daemon-backed output from the demo script.',
        },
      ],
    },
    {
      slug: 'relay-pki-boundary',
      title: 'Relay PKI Boundary',
      summary:
        'Reproduce the ADR-0025 PKI score, then read the v0 security boundary for OIDC, ACME, and Web-of-Trust.',
      truth: 'source-backed',
      goals: [
        'Reproduce the canonical PKI decision score.',
        'Understand why OIDC-first won the v0 lane.',
        'Keep Web-of-Trust out of the managed global registry.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'The relay identity layer is deliberately narrow',
          paragraphs: [
            'ADR-0025 picks an OIDC-first relay bootstrap because it is reversible, fast enough for relay v0, and already matches CI workload identity. ACME stays in the data model as a proof method, but it does not become the daemon transport credential.',
            'Web-of-Trust remains valid for self-hosted or air-gapped operators, but only with explicit admin-approved fingerprints or signed pairing receipts. A self-attested fingerprint plus a log line is not accepted into the managed registry.',
          ],
        },
        {
          type: 'command',
          title: 'Run the decision matrix',
          command:
            'python3 skills/pd-relay-zero-trust/scripts/pki_decision.py <<\'JSON\'\n{"kind":"request","version":"1","command":"pki.score","payload":{"options":["ACME","OIDC","WoT","Hybrid"]}}\nJSON',
          output: '{"winner":"OIDC","score":0.86,"runnerUp":"Hybrid","decision":"smallest managed v0 path"}',
          notes: [
            'OIDC and Hybrid tie in the score, but OIDC is the smallest v0 path.',
            'ACME remains a proof method for name control rather than the daemon transport credential.',
            'WoT is explicitly scoped to self-hosted/local authority.',
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'No self-attested managed relay identity',
          body:
            'Managed/global relay bootstrap must fail closed on unknown issuers, wrong audience, expired claims, ambiguous namespace mapping, and missing repository owner.',
        },
      ],
      sources: [
        {
          path: 'docs/adr/0025-pki-decision.md',
          rationale: 'ADR-0025 is the authority for relay PKI and Web-of-Trust boundaries.',
        },
        {
          path: 'skills/pd-relay-zero-trust/scripts/pki_decision.py',
          rationale: 'Decision script reproduces the PKI option score used by the docs.',
        },
      ],
    },
  ],
}
