import type { DocsContentSection } from './types'

export const tutorialsSection: DocsContentSection = {
  slug: 'tutorials',
  title: 'Tutorials',
  summary:
    'Longer guided workflows that take you from a clean machine or repo to a working operator pattern you can actually keep.',
  pages: [
    {
      slug: 'bootstrap-a-project-fleet',
      title: 'Bootstrap A Project Fleet',
      summary:
        'Create the starter fleet file, validate it, and bring the first project automation loop online without guessing what the daemon is doing.',
      truth: 'source-backed',
      goals: [
        'Initialize a real fleet config.',
        'Validate the topology before it starts running.',
        'Know which surfaces to inspect once the fleet is alive.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Bring automation online without hand-wiring scripts',
          paragraphs: [
            'A fleet is the always-on side of Port Daddy. It is where repo stewardship moves from one-shot delegation into declared background automation: triggers, schedules, singleton guards, and the project-wide operating loop.',
            'This tutorial is about getting to that first live loop honestly. The goal is not to dazzle you with twenty agents. The goal is to establish one readable fleet file, validate it, and watch the daemon manage it as a project surface instead of a pile of shell scripts.',
          ],
        },
        {
          type: 'command',
          title: 'Initialize and validate the fleet',
          command: 'pd fleet init\npd fleet validate\npd fleet up\npd fleet status',
          notes: [
            'Initialize the project config first so the topology is declared on disk.',
            'Validate before starting so bad YAML or broken topology does not become runtime mystery.',
            'Bring the fleet up only after the config parses cleanly.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Expect `pd-fleet.yml` to become part of the project’s operating contract.',
            'Use `pd fleet status` as the quick operator check after startup.',
            'Treat trigger channels and singleton policy as part of the fleet’s correctness, not as incidental config detail.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What completion looks like',
          paragraphs: [
            'You are done when the project has one readable fleet definition, the daemon can validate it, and the status surface tells a coherent story about what is armed and why.',
            'At that point, the fleet stops looking like magic background AI. It starts looking like declared repo infrastructure that the operator can inspect, pause, resume, and debug.',
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
          rationale: 'Fleet routes expose bootstrap, status, reload, and config surfaces for the running daemon.',
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
        'Bring the work back under active operator control.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Recovery is part of the product, not a footnote',
          paragraphs: [
            'Agents die. Terminals close. Background work gets interrupted. A control plane that only looks good when everything exits cleanly is not serious operator infrastructure, which is why Port Daddy keeps a salvage queue instead of pretending the problem is rare.',
            'This tutorial shows the recovery path you should actually expect to use: inspect the queue, claim the abandoned work, and continue from the preserved session context instead of rebuilding the thread from memory.',
          ],
        },
        {
          type: 'command',
          title: 'Inspect and claim the dead work',
          command: 'pd salvage --project myapp\npd salvage claim dead-agent-99\npd notes --session <session-id>',
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
            'If an agent died mid-task and you simply start over without salvage, you have thrown away the control plane’s recovery context. That is exactly the gap the product is supposed to close.',
        },
        {
          type: 'paragraph',
          title: 'What a good salvage handoff feels like',
          paragraphs: [
            'A good salvage claim gives you enough context to continue confidently: session id, purpose, notes, and any file or task state that survived the crash. You should feel like you inherited a trail, not like you got a vague hint.',
            'If the queue is empty when it should not be, that is a product bug worth investigating. The tutorial outcome is not only “continue the work.” It is “prove the daemon preserved recoverable state in the first place.”',
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
          rationale: 'Repo instructions tell operators to run salvage when abandoned work might still matter.',
        },
      ],
    },
    {
      slug: 'launch-and-inspect-a-sortie',
      title: 'Launch And Inspect A Sortie',
      summary:
        'Create a tracked mission, inspect the durable sortie record, and read the event log instead of trusting raw process output.',
      truth: 'source-backed',
      goals: [
        'Use the shipped sortie surface truthfully.',
        'Inspect status and logs from the persisted record.',
        'Understand the current boundary between shipped sortie state and future richer orchestration.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Use the sortie surface for tracked missions',
          paragraphs: [
            'A sortie is for work you want to inspect later as a mission, not just as one terminal run. The current slice is intentionally modest: it gives you a durable id, a persisted mission record, and an event log you can read back after the coordinating run finishes.',
            'That matters because many delegation failures are really inspection failures. If you cannot come back later and understand what happened, the system has not given you a usable mission surface. This tutorial stays inside the truth the repo actually ships today.',
          ],
        },
        {
          type: 'command',
          title: 'Run and inspect the sortie',
          command:
            'pd sortie "Review the latest auth changes and summarize the real risks" --budget 0.50\npd sortie list\npd sortie status <sortie-id>\npd sortie logs <sortie-id>',
          notes: [
            'Launch with an explicit budget ceiling so spend stays part of the operator contract.',
            'Use the persisted sortie id for later inspection instead of scraping raw child-process output.',
            'Read the logs when you need the event narrative, not just the final status.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Expect durable ids, status, and logs from the shipped slice.',
            'Do not expect approval queues or rich multi-agent mission authoring yet.',
            'Use sortie when you need a tracked mission surface, not when one bounded `pd agent` run is enough.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What the current slice buys you',
          paragraphs: [
            'The shipped slice already solves one important operator problem: you can launch a mission, walk away, and return to a durable record instead of hoping the terminal scrollback still tells the story.',
            'The richer multi-agent mission engine is still a later layer. The tutorial should make that boundary feel crisp rather than coy, because that honesty is what keeps the docs credible.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/DELEGATION-MODES.md',
          rationale: 'Delegation modes document defines the truthful current sortie surface and its gaps.',
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
  ],
}
