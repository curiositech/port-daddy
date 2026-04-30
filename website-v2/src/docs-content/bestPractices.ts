import type { DocsContentSection } from './types'

export const bestPracticesSection: DocsContentSection = {
  slug: 'best-practices',
  title: 'Best Practices',
  summary:
    'Practical habits for keeping agent work visible, recoverable, and safe to ship.',
  pages: [
    {
      slug: 'operator-loop',
      title: 'Daily Work Loop',
      summary:
        'Use the Port Daddy-first loop before broad repo work so other agents can see your slice.',
      truth: 'source-backed',
      goals: [
        'Start work with the expected command sequence.',
        'Leave machine-visible context before edits.',
        'Use locks or file claims when work can collide.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Run the work loop before the repo gets noisy',
          paragraphs: [
            'The work loop exists to make your slice visible before you start changing a busy repo. It tells Port Daddy, other agents, and future recovery work what you are about to do.',
            'This is why Port Daddy-first is a rule in this repo rather than a nice suggestion. Local shell work without a session anchor is invisible work.',
          ],
        },
        {
          type: 'command',
          title: 'Start here',
          command: 'pd status\npd briefing\npd salvage',
          output: 'Port Daddy is running\nSUCCESS: Briefing generated: .portdaddy/briefing.md\n6 dead agent(s) in myapp. Run: pd salvage --project myapp',
          notes: [
            'This is the default entry loop for recovery, debugging, and parallel-work sessions on this machine.',
          ],
        },
        {
          type: 'command',
          title: 'Leave context before edits',
          command:
            'pd note "Owning a narrow slice. State intended files and constraints before broad edits."',
          output: 'SUCCESS: Note added to session session-current-work',
          notes: [
            'Use notes to make your slice visible to other agents.',
            'When overlap risk is real, use locks or file claims instead of relying on prose.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Treat plain shell inspection without a Port Daddy session as insufficient for non-trivial repo work.',
            'Use locks or file claims for overlapping edits or critical sections.',
            'Hand off work with the live Port Daddy session anchor, not just free-form prose.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What good coordination looks like',
          paragraphs: [
            'Good coordination is explicit, attributable, and recoverable. It leaves enough state behind that another person or agent can route around your slice instead of stumbling into it.',
            'That is the difference between “many tools running in one repo” and work that other people and agents can understand.',
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
          rationale: 'Current guides content already reflects the daily work loop at a high level.',
        },
      ],
    },
    {
      slug: 'runtime-truth',
      title: 'Running App Over Source Assumptions',
      summary:
        'Source changes only help users after the running daemon and UI have been rebuilt and relaunched.',
      truth: 'source-backed',
      goals: [
        'Verify the live daemon instead of assuming the current checkout is active.',
        'Keep one expected daemon running.',
        'Catch stale UI or stale shell commands before they waste time.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Keep one running-app story',
          paragraphs: [
            'Debugging gets messy as soon as the daemon, browser dashboard, and CLI disagree about what is live.',
            'The goal is simple: make sure the CLI and UI are attached to the same running Port Daddy process before you trust either one.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Do not assume the live daemon is running the current checkout.',
            'Treat an old daemon on preferred port `9876` as replaceable if a newer install should be serving.',
            'Use shared discovery rather than sprinkling new hardcoded localhost URLs around the repo.',
            'If socket and browser checks disagree, inspect the live process and launchd output.',
          ],
        },
        {
          type: 'command',
          title: 'Runtime verification',
          command:
            'port-daddy status\nlaunchctl print gui/501/com.portdaddy.daemon\ncurl -sS "$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed \'s#^#http://localhost:#\')/fleet"\nwhich port-daddy',
          output: 'Port Daddy is running\nstate = running\n{"running":true,"projects":[],"agents":[]}\n/opt/homebrew/bin/port-daddy',
          notes: [
            'This command set separates daemon health, launchd state, browser reachability, and shell command location.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Why this page exists',
          paragraphs: [
            'Many “the feature does not work” reports are really “I am looking at an old daemon or UI bundle” reports.',
            'Once you verify the live process, the rest of the debugging gets much easier.',
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
          rationale: 'Recovery docs describe preferred port and runtime-discovery discipline.',
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
            'If those habits are treated as optional, the repo falls back to guesswork.',
          ],
        },
        {
          type: 'command',
          title: 'Session baseline',
          command: 'pd begin --identity myapp:api --purpose "Fix auth bug"\npd whoami',
          output: 'SUCCESS: Agent Fix auth bug ready\nAgent:    Fix auth bug\nIdentity: myapp:api',
          notes: [
            'Use explicit identity and purpose instead of anonymous local work.',
          ],
        },
        {
          type: 'command',
          title: 'Contested work',
          command: 'pd lock acquire <name>\npd with-lock <name> -- <command>',
          output: 'SUCCESS: Lock "<name>" acquired\nSUCCESS: command completed and lock released',
          notes: [
            'Escalate to locks when work can collide or a critical section must be serialized.',
          ],
        },
        {
          type: 'command',
          title: 'Recovery path',
          command: 'pd salvage\npd salvage claim <agentId>',
          output: 'Recoverable work:\n  <agentId>  abandoned  preserved session context\nSUCCESS: Salvage claimed <agentId>',
          notes: [
            'Keep salvage visible in best practices because crash recovery is part of the product’s normal coordination story.',
          ],
        },
        {
          type: 'paragraph',
          title: 'The recovery standard',
          paragraphs: [
            'Crash recovery has to be ordinary. Agents stop, terminals close, and work still needs to be recoverable.',
            'Keeping salvage in the normal best-practices flow makes that expectation explicit.',
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
          rationale: 'ADR explains why salvage is a deliberate recovery flow instead of automatic cleanup.',
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
        'Verify the promoted Port Daddy app from the places users actually open.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Test the change, then test the installed app',
          paragraphs: [
            'Tests tell you whether the checkout is healthy. Promotion decides what users will actually run. Treat those as separate checks so a fixed bug does not stay trapped in an unpromoted build.',
            'For Port Daddy contributors, that means running the repo gate, using the supported promotion script, and opening the installed app or dashboard before calling the release ready.',
          ],
        },
        {
          type: 'command',
          title: 'Test gate',
          command: 'npm test',
          output: 'Test Suites: all passed\nTests: all passed',
          notes: [
            'Run focused tests while iterating, then use this as the broad gate before release claims.',
            'If Jest reports worker-exit warnings, chase them before treating the run as clean.',
          ],
        },
        {
          type: 'command',
          title: 'Promote the supported way',
          command: './scripts/promote-stable.sh',
          output: 'SUCCESS: stable checkout rebuilt\nSUCCESS: canonical daemon relaunched',
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
            'After promotion, open CLI status and the web or FleetBar app from the promoted daemon. The release is ready when the installed app and browser UI both show the change you tested.',
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
      title: 'Onboarding Entry Points',
      summary:
        'Project setup, fleet setup, and MCP setup are real entry points today. The remaining work is turning them into one coherent first-run experience.',
      truth: 'blocked',
      goals: [
        'Show the available onboarding commands clearly.',
        'Set expectations clearly about what is already smooth and what still needs product work.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Three entry points, one unfinished journey',
          paragraphs: [
            'Project setup, fleet setup, and MCP setup already exist. They are not imaginary roadmap bullets.',
            'What is still being productized is the feeling of one clear first-run journey from install to configured project to working app.',
          ],
        },
        {
          type: 'command',
          title: 'Available onboarding commands',
          command: 'pd init\npd fleet init\npd mcp install',
          output: 'SUCCESS: Project initialized\nSUCCESS: Created pd-fleet.yml\nSUCCESS: MCP configuration installed',
          notes: [
            'These commands already exist and are usable today.',
            'Use them when you are setting up a project, a fleet, or an MCP connection.',
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'Real commands, unfinished journey',
          body:
            'The commands work. What is still being tightened is the first-run story that carries a new user cleanly from install to a configured project and working app.',
        },
        {
          type: 'paragraph',
          title: 'How to write about this clearly',
          paragraphs: [
            'The right public stance is directness. Show the working commands, explain what each one is for, and stop short of pretending the onboarding flow is already seamless.',
            'That kind of clarity does more for trust than a fake frictionless story ever could.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/V4-UNIFIED-ROADMAP.md',
          rationale: 'Roadmap notes that pd init, pd fleet init, and pd mcp install are built onboarding entry points.',
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
