import type { DocsContentSection } from './types'

export const getStartedSection: DocsContentSection = {
  slug: 'get-started',
  title: 'Get Started',
  summary:
    'Install the daemon, verify the live runtime, and complete a first coordination loop using commands that already exist today.',
  pages: [
    {
      slug: 'install',
      title: 'Install',
      summary:
        'Install the daemon, bring up the control plane, and start working with agent operations from one command path.',
      truth: 'source-backed',
      goals: [
        'Install the daemon cleanly.',
        'Bring up the control plane without detouring through setup trivia.',
        'Understand what becomes available after install.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Install the daemon of record',
          paragraphs: [
            'Install the daemon that becomes the system of record for agent work on your machine. This path gives you the CLI, the runtime, and the control plane in one move.',
            'The point of the install is not merely to add another binary. It is to put one authority in charge of agent identity, coordination, shared state, and operator visibility before the repo gets noisy.',
          ],
        },
        {
          type: 'command',
          title: 'Install Port Daddy',
          command: 'brew install curiositech/tap/port-daddy && pd setup',
          notes: [
            'Use this when you want the full daemon and control-plane setup on your machine.',
            'After setup, you have one runtime for identity, coordination, and operator visibility.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Daemon runtime for agent identity, shared state, and coordination.',
            'CLI entry point for sessions, locks, notes, harbors, and fleet commands.',
            'Control-plane surface for inspecting and operating active work.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What success looks like',
          paragraphs: [
            'A successful install leaves you with one runtime you can interrogate, one CLI you can trust, and one control plane you can open without wondering which checkout or stale daemon you are actually talking to.',
            'From there, the rest of the docs stop being theory. You can verify the runtime, start a session, leave notes, and watch the daemon keep operator truth attached to the work.',
          ],
        },
      ],
      sources: [
        {
          path: 'website-v2/src/data/publicSite.ts',
          rationale: 'The public shell already uses Homebrew + pd setup as the install path.',
        },
        {
          path: 'website-v2/src/public-shell-contracts.test.ts',
          rationale: 'A contract test keeps the install path aligned with the shell copy.',
        },
        {
          path: 'docs/recovery/UNIFIED-ROADMAP.md',
          rationale: 'The roadmap treats `pd setup` as the direction for operator onboarding.',
        },
        {
          path: 'README.md',
          rationale: 'The README documents install and setup behavior from the operator side.',
        },
      ],
    },
    {
      slug: 'verify-runtime',
      title: 'Verify Runtime',
      summary:
        'Check the live daemon, then separately verify the socket, TCP path, and shell shim before trusting the runtime.',
      truth: 'source-backed',
      goals: [
        'Confirm that the daemon you are talking to is really the live one.',
        'Check both the socket path and the browser/TCP path.',
        'Catch stale shims or stale runtime state before they waste your time.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Verify the runtime before you trust it',
          paragraphs: [
            'Check the runtime before you trust it. The CLI can look healthy over the Unix socket while browser or FleetBar consumers are still pointed at stale TCP state, and the shell shim can still target the wrong install.',
            'This is why Port Daddy treats runtime discovery as operator work. If the daemon, TCP path, and shell shim disagree, the problem is not cosmetic. It means your surfaces are no longer telling one coherent story about the machine.',
          ],
        },
        {
          type: 'command',
          title: 'Operator baseline',
          command: 'pd status\npd briefing\npd salvage',
          notes: [
            'Use these three commands before local archaeology in active repo work.',
            'Briefing and salvage are normal operator moves, not panic buttons.',
          ],
        },
        {
          type: 'command',
          title: 'Canonical runtime checks',
          command:
            'port-daddy status\nlaunchctl print gui/501/com.portdaddy.daemon\ncurl -sS "$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed \'s#^#http://localhost:#\')/fleet"\nwhich port-daddy',
          notes: [
            'Use these when surfaces disagree or the daemon feels stale.',
            'Do not assume the current checkout is the live runtime just because local source changed.',
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Do not trust the default port blindly',
          body:
            'Port Daddy prefers `9876`, but the correct move is to discover the live daemon instead of hardcoding the port and hoping it is right.',
        },
        {
          type: 'paragraph',
          title: 'What this protects you from',
          paragraphs: [
            'These checks keep you from debugging the wrong daemon, trusting a stale shell shim, or believing a UI surface that is no longer attached to the live process.',
            'That may sound operationally fussy, but it is exactly what lets the control plane stay credible once agents, hooks, and multiple checkouts start competing for authority.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale: 'Canonical runtime section defines the verification commands and the socket-versus-TCP distinction.',
        },
        {
          path: 'docs/recovery/CURRENT-WORK.md',
          rationale: 'Recovery ledger explicitly calls out divergence between Unix-socket truth and browser/TCP truth.',
        },
        {
          path: 'README.md',
          rationale: 'README warns that the default daemon URL may differ and tells users to use pd status or PORT_DADDY_URL.',
        },
      ],
    },
    {
      slug: 'first-coordination-success',
      title: 'First Coordination Success',
      summary:
        'Prove the control plane is doing useful work by completing a real session loop and checking the current local context.',
      truth: 'source-backed',
      goals: [
        'Start a session with identity and purpose.',
        'Leave a note that other operators and agents can actually use.',
        'Confirm the current context, then end the session cleanly.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Complete the first real loop',
          paragraphs: [
            'The fastest way to feel Port Daddy doing real work is the session loop: start with `pd begin`, leave a note, confirm context with `pd whoami`, and close with `pd done`.',
            'This is the moment where the product stops being a daemon with a nice story and becomes operating infrastructure. Identity, notes, and finish state all become shared context that other agents and future operators can actually use.',
          ],
        },
        {
          type: 'command',
          title: 'Start the session',
          command: 'pd begin --identity myapp:api --purpose "Building the auth layer"',
          notes: [
            'Use `--identity` and `--purpose` explicitly in docs examples.',
            'This is the recommended way to start coordinated work in the current CLI docs.',
          ],
        },
        {
          type: 'command',
          title: 'Leave a session note',
          command: 'pd note "Auth middleware updated — JWT shape changed" --type milestone',
          notes: [
            'Notes are immutable session evidence.',
            'If scope is ambiguous, the CLI docs say to pass explicit targeting instead of relying on implicit lookup.',
          ],
        },
        {
          type: 'command',
          title: 'Inspect and finish',
          command: 'pd whoami\npd done',
          notes: [
            'Use `pd whoami` to confirm the current session context before ending work.',
            'Use `pd done` to close the session and unregister the agent cleanly.',
          ],
        },
        {
          type: 'command',
          title: 'If the agent crashes instead',
          command: 'pd salvage\npd salvage claim <agentId>',
          notes: [
            'Salvage is the recovery path when a session dies mid-task.',
            'Keep salvage framed as part of the normal coordination model, not as an exotic edge case.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Why this matters',
          paragraphs: [
            'A first coordination success is not about typing four commands. It is about proving that the daemon can carry intent, evidence, and recovery state across real work.',
            'If that loop feels clean, the rest of the system makes sense. If it does not, the product has not earned the rest of your trust yet.',
          ],
        },
      ],
      sources: [
        {
          path: 'README.md',
          rationale: 'README documents begin/done and shows a real session example.',
        },
        {
          path: 'website-v2/src/data/docs.ts',
          rationale: 'CLI source already documents begin, note, whoami, done, salvage, and salvage claim.',
        },
        {
          path: 'website-v2/src/data/blogData.ts',
          rationale: 'Blog source treats begin/whoami/salvage as the primary coordination workflow.',
        },
      ],
    },
    {
      slug: 'stale-daemon-cli-runtime',
      title: 'Troubleshoot Stale Daemon, CLI, and Runtime Drift',
      summary:
        'When source, daemon, and UI disagree, trust the live process checks and rebuild/relaunch discipline instead of hand-waving the mismatch away.',
      truth: 'source-backed',
      goals: [
        'Distinguish stale daemon from stale CLI shim from stale UI client.',
        'Use live process checks before assuming a feature is imaginary.',
        'Apply the repo’s restart discipline after runtime-serving changes.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Source truth is not operator truth',
          paragraphs: [
            'When source, daemon, and UI disagree, the live process wins. Current source only becomes operator truth after rebuild and relaunch.',
            'That rule prevents a lot of wasted time. It stops you from chasing imaginary missing features when the real problem is stale dist output, a stale daemon, or a shell shim that still points to another install root.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'If a command exists in source but the installed CLI gets `Not Found`, suspect stale `dist/` or a stale daemon first.',
            'If the control plane or FleetBar looks wrong, verify the TCP path separately from socket-based CLI health.',
            'If `which port-daddy` points at the wrong checkout, fix the shell shim story before trusting command behavior.',
            'After runtime-serving code changes, rebuild and relaunch before treating any dogfood result as operator truth.',
          ],
        },
        {
          type: 'command',
          title: 'Drift triage',
          command:
            'pd status\nport-daddy status\nlaunchctl print gui/501/com.portdaddy.daemon\nwhich port-daddy',
          notes: [
            'Use this set when the daemon, CLI, and code checkout tell different stories.',
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'When the runtime story splits, trust the live process',
          body:
            'If the daemon, the CLI, and the UI disagree, treat the live process checks as the authority. Rebuild and relaunch before you decide the feature is missing.',
        },
        {
          type: 'paragraph',
          title: 'The discipline behind the rule',
          paragraphs: [
            'This repo has enough moving parts that runtime drift is not a rare accident. It is a normal failure mode. Good operator habits have to assume that and verify accordingly.',
            'Once the runtime is aligned again, everything else becomes simpler: the CLI, the browser surface, the docs, and the control plane all snap back to one shared truth.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale: 'Current repo-wide runtime drift rules and restart discipline live here.',
        },
        {
          path: 'docs/recovery/CURRENT-WORK.md',
          rationale: 'Recovery notes document the stale-runtime failure modes and operator-truth rules.',
        },
      ],
    },
  ],
}
