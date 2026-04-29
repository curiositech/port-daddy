import type { DocsContentSection } from './types'

export const bestPracticesSection: DocsContentSection = {
  slug: 'best-practices',
  title: 'Best Practices',
  summary:
    'Operator discipline for keeping runtime truth, coordination, and promotion honest under real repo pressure.',
  pages: [
    {
      slug: 'operator-loop',
      title: 'Operator Loop',
      summary:
        'Use the Port Daddy-first loop before broad repo work so the daemon and other agents can see your slice.',
      truth: 'source-backed',
      goals: [
        'Start work with the repo’s expected operator sequence.',
        'Leave machine-visible context before edits.',
        'Escalate to shared primitives when work can collide.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Run the operator loop before the repo gets noisy',
          paragraphs: [
            'The operator loop exists to make your slice visible before you start changing a busy repo. It is how you tell the daemon, other agents, and future recovery work what you are about to do.',
            'This is why Port Daddy-first is a rule in this repo rather than a nice suggestion. Shell archaeology without a session anchor is invisible work, and invisible work is exactly what the control plane is supposed to eliminate.',
          ],
        },
        {
          type: 'command',
          title: 'Start here',
          command: 'pd status\npd briefing\npd salvage',
          notes: [
            'This is the default entry loop for recovery, debugging, and parallel-work sessions on this machine.',
          ],
        },
        {
          type: 'command',
          title: 'Leave context before edits',
          command:
            'pd note "Owning a narrow slice. State intended files and constraints before broad edits."',
          notes: [
            'Use notes to make your slice visible to other agents.',
            'When overlap risk is real, move beyond prose and use locks or other coordination primitives.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Treat plain shell inspection without a Port Daddy session as insufficient for non-trivial repo work.',
            'Use locks or other shared coordination primitives for overlapping edits or critical sections.',
            'Hand off work with the live Port Daddy session anchor, not just free-form prose.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What good operator behavior looks like',
          paragraphs: [
            'Good operator behavior is explicit, attributable, and recoverable. It leaves enough state behind that another person or agent can route around your slice instead of stumbling into it.',
            'That is the difference between “many tools running in one repo” and an actual control plane.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale: 'Port Daddy-first coordination and note/claim expectations are defined here.',
        },
        {
          path: 'website-v2/src/data/publicSite.ts',
          rationale: 'Current guides content already reflects the operator loop at a high level.',
        },
      ],
    },
    {
      slug: 'runtime-truth',
      title: 'Runtime Truth Over Source Assumptions',
      summary:
        'The daemon serving users is the authority for operator truth. Current source only matters after rebuild and relaunch.',
      truth: 'source-backed',
      goals: [
        'Verify the live daemon instead of assuming the current checkout is active.',
        'Keep one canonical daemon story.',
        'Prevent stale UI or stale shim state from rewriting reality.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Keep one canonical runtime story',
          paragraphs: [
            'Operator trust collapses as soon as the daemon, the browser surface, and the CLI disagree about what is live. That is why this repo keeps such a hard line about canonical runtime checks.',
            'The goal is not ritual. The goal is to keep every operator-facing surface attached to the same process and the same shared state.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Do not assume the live daemon is running the current checkout.',
            'Treat the canonical daemon on preferred port `9876` as replaceable stale runtime if a fresher canonical install must take over.',
            'Use shared discovery rather than sprinkling new hardcoded localhost URLs around the repo.',
            'If socket and TCP checks disagree, trust live process and launchd output over docs or memory.',
          ],
        },
        {
          type: 'command',
          title: 'Canonical runtime verification',
          command:
            'port-daddy status\nlaunchctl print gui/501/com.portdaddy.daemon\ncurl -sS "$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed \'s#^#http://localhost:#\')/fleet"\nwhich port-daddy',
          notes: [
            'This command set separates daemon health, launchd state, TCP reachability, and shell shim truth.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Why this page exists',
          paragraphs: [
            'Most “the feature does not work” reports in a system like this are really “the runtime story drifted” reports. This page exists so that drift gets diagnosed in minutes instead of hours.',
            'Once you trust the live process checks, the daemon becomes much easier to operate and much harder to lie to yourself about.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale: 'Canonical runtime and one-daemon rules are defined here.',
        },
        {
          path: 'docs/recovery/README.md',
          rationale: 'Recovery authority documents preferred port and runtime-discovery discipline.',
        },
      ],
    },
    {
      slug: 'coordination-discipline',
      title: 'Coordination Discipline',
      summary:
        'Use session context, notes, and locks as the baseline coordination contract. Treat salvage as standard recovery, not as an afterthought.',
      truth: 'source-backed',
      goals: [
        'Make session context explicit.',
        'Use shared state to reduce collisions.',
        'Keep recovery discoverable when an agent dies.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Coordination is the product, not the overhead',
          paragraphs: [
            'Sessions, notes, locks, and salvage are not side features around the real work. They are the real work of making multi-agent execution understandable and recoverable.',
            'If those primitives are treated as optional, the repo falls back to guesswork. That is exactly the failure mode Port Daddy is here to replace.',
          ],
        },
        {
          type: 'command',
          title: 'Session baseline',
          command: 'pd begin --identity myapp:api --purpose "Fix auth bug"\npd whoami',
          notes: [
            'Use explicit identity and purpose instead of anonymous local work.',
          ],
        },
        {
          type: 'command',
          title: 'Contested work',
          command: 'pd lock acquire <name>\npd with-lock <name> -- <command>',
          notes: [
            'Escalate to locks when work can collide or a critical section must be serialized.',
          ],
        },
        {
          type: 'command',
          title: 'Recovery path',
          command: 'pd salvage\npd salvage claim <agentId>',
          notes: [
            'Keep salvage visible in best practices because crash recovery is part of the product’s normal coordination story.',
          ],
        },
        {
          type: 'paragraph',
          title: 'The recovery standard',
          paragraphs: [
            'Crash recovery has to be ordinary. A daemon that only looks good when everything exits cleanly is not serious operator infrastructure.',
            'By keeping salvage in the normal best-practices flow, the docs make that expectation explicit.',
          ],
        },
      ],
      sources: [
        {
          path: 'website-v2/src/data/docs.ts',
          rationale: 'CLI command source documents begin, whoami, lock acquire, with-lock, salvage, and salvage claim.',
        },
        {
          path: 'docs/adr/0008-agent-resurrection-pattern.md',
          rationale: 'ADR explains why salvage is a deliberate operator flow instead of automatic cleanup.',
        },
      ],
    },
    {
      slug: 'testing-and-promotion',
      title: 'Testing and Promotion Discipline',
      summary:
        'Use the test gate, promote through the supported script, and verify the Port Daddy app a user actually opens.',
      truth: 'source-backed',
      goals: [
        'Run the documented test gate before claiming release readiness.',
        'Use the promotion script so install, daemon, and UI assets move together.',
        'Verify the promoted Port Daddy app from the surfaces users actually open.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Test the change, then test the installed app',
          paragraphs: [
            'Tests tell you whether the checkout is healthy. Promotion decides what users will actually run. Treat those as separate checks so a fixed bug does not stay trapped in an unpromoted build.',
            'For Port Daddy contributors, that means running the repo gate, using the supported promotion script, and opening the installed app or control plane before calling the release ready.',
          ],
        },
        {
          type: 'command',
          title: 'Test gate',
          command: 'npm test',
          notes: [
            'Run focused tests while iterating, then use this as the broad gate before release claims.',
            'If Jest reports worker-exit warnings, chase them before treating the run as clean.',
          ],
        },
        {
          type: 'command',
          title: 'Promote the supported way',
          command: './scripts/promote-stable.sh',
          notes: [
            'This script rebuilds and restarts the stable install.',
            'Report the script’s blocker instead of improvising a launchd sequence.',
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Verify what users will open',
          body:
            'After promotion, open the CLI status and the web or FleetBar surface from the promoted daemon. The release is ready when the installed app and browser UI both show the change you tested.',
        },
        {
          type: 'paragraph',
          title: 'What this gives users',
          paragraphs: [
            'The payoff is simple: the person who launches Port Daddy gets the same behavior the contributor just tested.',
            'Promotion discipline prevents users from seeing an old daemon, stale UI bundle, or missing command after the code has already been fixed.',
          ],
        },
      ],
      sources: [
        {
          path: 'package.json',
          rationale: 'Defines the repo test script used as the broad health gate.',
        },
        {
          path: 'scripts/promote-stable.sh',
          rationale: 'Canonical promotion entry point for the stable install.',
        },
      ],
    },
    {
      slug: 'onboarding-surfaces',
      title: 'Onboarding Surfaces',
      summary:
        'Project setup, fleet setup, and MCP setup are real entry points today. The remaining work is turning them into one coherent first-run experience.',
      truth: 'blocked',
      goals: [
        'Show the available onboarding commands clearly.',
        'Set expectations honestly about what is already smooth and what still needs product work.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Three real surfaces, one unfinished journey',
          paragraphs: [
            'Project setup, fleet setup, and MCP setup are already real surfaces. They are not imaginary roadmap bullets.',
            'What is still being productized is the feeling of one coherent first-run journey from install to configured project to working control plane.',
          ],
        },
        {
          type: 'command',
          title: 'Available onboarding commands',
          command: 'pd init\npd fleet init\npd mcp install',
          notes: [
            'These commands already exist and are usable today.',
            'Use them when you are setting up a project, a fleet surface, or an MCP connection.',
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'Real commands, unfinished journey',
          body:
            'The commands work. What is still being tightened is the first-run story that carries an operator cleanly from install to a configured project and working control plane.',
        },
        {
          type: 'paragraph',
          title: 'How to write about this honestly',
          paragraphs: [
            'The right public stance is directness. Show the working commands, explain what each one is for, and stop short of pretending the onboarding flow is already seamless.',
            'That kind of honesty does more for trust than a fake frictionless story ever could.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/V4-UNIFIED-ROADMAP.md',
          rationale: 'Roadmap notes that pd init, pd fleet init, and pd mcp install are built onboarding surfaces.',
        },
        {
          path: 'docs/MULTI-ENTRY-STRATEGY.md',
          rationale: 'Strategy doc explains these as distinct onboarding entry points with uneven maturity.',
        },
        {
          path: 'docs/recovery/CURRENT-WORK.md',
          rationale: 'Recovery queue shows add-project and onboarding flows are still being productized.',
        },
      ],
    },
  ],
}
