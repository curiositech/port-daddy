import type { DocsContentSection } from './types'

export const getStartedSection: DocsContentSection = {
  slug: 'get-started',
  title: 'Get Started',
  summary:
    'Install Port Daddy, confirm it is running, and try the first agent coordination loop.',
  pages: [
    {
      slug: 'install',
      title: 'Install',
      summary:
        'Install the local Port Daddy service, CLI, and dashboard entry points.',
      truth: 'source-backed',
      goals: [
        'Install Port Daddy cleanly.',
        'Know which pieces setup adds to your machine.',
        'Open the dashboard or CLI with confidence after setup.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Install Port Daddy locally',
          paragraphs: [
            'Port Daddy runs locally on your machine. Setup installs the background service, the CLI, and the pieces that let the dashboard and agent tools read the same coordination state.',
            'After setup, you can see active sessions, leave notes, claim files, inspect ports, and recover interrupted agent work from one place.',
          ],
        },
        {
          type: 'command',
          title: 'Install Port Daddy',
          command: 'brew install curiositech/tap/port-daddy && pd setup',
          notes: [
            'Use this when you want the normal local Port Daddy setup.',
            'After setup, use `pd status` to confirm the service is running.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'A local service that stores session, note, lock, port, and fleet state.',
            'A CLI entry point for everyday commands such as sessions, notes, locks, and salvage.',
            'A dashboard path for seeing active agent work.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What success looks like',
          paragraphs: [
            'A successful install gives you a CLI that answers, a local service that reports healthy status, and a dashboard you can open.',
            'From there, the docs get practical: verify the service, start a session, leave a note, and see the work show up where another agent or future you can find it.',
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
          rationale: 'The roadmap treats `pd setup` as the direction for first-run onboarding.',
        },
        {
          path: 'README.md',
          rationale: 'The README documents install and setup behavior for users.',
        },
      ],
    },
    {
      slug: 'verify-runtime',
      title: 'Verify Runtime',
      summary:
        'Check that the CLI, dashboard, and background service are all talking to the same running Port Daddy install.',
      truth: 'source-backed',
      goals: [
        'Confirm that Port Daddy is running.',
        'Check both CLI and browser access.',
        'Catch stale installs before you debug the wrong thing.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Verify the running app before you debug',
          paragraphs: [
            'If Port Daddy looks wrong, first make sure you are talking to the running install you think you are. The CLI, browser dashboard, and shell command can drift if an old daemon or shim is still around.',
            'These checks keep you from chasing a missing feature or broken page when the real problem is that an older process is serving the app.',
          ],
        },
        {
          type: 'command',
          title: 'Basic status check',
          command: 'pd status\npd briefing\npd salvage',
          notes: [
            'Use these commands before digging through a busy repo.',
            'Briefing and salvage show current context and abandoned work.',
          ],
        },
        {
          type: 'command',
          title: 'Check the local install',
          command:
            'pd status --json\nbrew services info port-daddy\nPD_URL="${PORT_DADDY_URL:-$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed \'s#^#http://127.0.0.1:#\')}"\ncurl -fsS "$PD_URL/fleet"\ncommand -v pd',
          notes: [
            'Use these when the CLI, FleetBar, or browser dashboard disagree.',
            'Do not assume the current checkout is the live runtime just because local source changed.',
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Do not trust the default port blindly',
          body:
            'The safer move is to ask the running install where it is listening, or read the published daemon.port file if you need a shell target.',
        },
        {
          type: 'paragraph',
          title: 'What this protects you from',
          paragraphs: [
            'These checks keep you from debugging the wrong daemon, trusting a stale shell shim, or believing a browser page that is no longer attached to the current process.',
            'Once the CLI and dashboard agree, the rest of your Port Daddy troubleshooting gets much simpler.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale: 'Runtime section defines the verification commands and the socket-versus-TCP distinction.',
        },
        {
          path: 'docs/recovery/CURRENT-WORK.md',
          rationale: 'Recovery notes call out divergence between Unix-socket status and browser/TCP status.',
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
        'Try the basic session loop so you can see Port Daddy record useful work.',
      truth: 'source-backed',
      goals: [
        'Start a session with identity and purpose.',
        'Leave a note that other people and agents can actually use.',
        'Confirm the current context, then end the session cleanly.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Complete the first real loop',
          paragraphs: [
            'The fastest way to feel Port Daddy doing real work is the session loop: start with `pd begin`, leave a note, confirm context with `pd whoami`, and close with `pd done`.',
            'This gives the work a name, a purpose, a note trail, and a clean ending. That is the basic shape other agents and future you can understand later.',
          ],
        },
        {
          type: 'command',
          title: 'Start the session',
          command: 'pd begin --identity myapp:api --purpose "Building the auth layer" --lifecycle durable',
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
            'If scope is ambiguous, pass explicit targeting instead of relying on implicit lookup.',
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
            'Keep salvage framed as a normal recovery path, not as an exotic edge case.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Why this matters',
          paragraphs: [
            'A first coordination success is not about typing four commands. It is about proving that Port Daddy can preserve intent, notes, and recovery state across real work.',
            'If that loop feels clean, the rest of the system makes more sense. If it does not, fix the basics before adding fleets or background agents.',
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
        'When code, CLI, and UI disagree, check which Port Daddy process is actually running.',
      truth: 'source-backed',
      goals: [
        'Distinguish stale daemon from stale CLI shim from stale UI client.',
        'Use live process checks before assuming a feature is imaginary.',
        'Apply the repo’s restart discipline after runtime-serving changes.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Local code is not always the running app',
          paragraphs: [
            'Changing source files does not automatically update the daemon, CLI bundle, or browser UI that is already running.',
            'That rule prevents a lot of wasted time. It stops you from chasing imaginary missing features when the real problem is stale build output, an old daemon, or a shell command pointing at another install.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'If a command exists in source but the installed CLI gets `Not Found`, suspect stale `dist/` or a stale daemon first.',
            'If the dashboard or FleetBar looks wrong, verify the browser path separately from CLI health.',
            'If `which port-daddy` points at the wrong checkout, fix the shell shim story before trusting command behavior.',
            'After runtime-serving code changes, rebuild and relaunch before trusting the result.',
          ],
        },
        {
          type: 'command',
          title: 'Drift triage',
          command:
            'pd status --json\nbrew services info port-daddy\npd dev list\ncommand -v pd',
          notes: [
            'Use this set when the stable Homebrew daemon, a named feature daemon, the CLI, and the code checkout tell different stories.',
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'When the runtime story splits, trust the live process',
          body:
            'If the daemon, CLI, and UI disagree, check the live process first. Rebuild and relaunch before you decide the feature is missing.',
        },
        {
          type: 'paragraph',
          title: 'The discipline behind the rule',
          paragraphs: [
            'This repo has enough moving parts that stale runtime state is not rare. Good debugging starts by checking what is actually running.',
            'Once the running install is aligned again, the CLI, browser UI, and docs are much easier to trust.',
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
          rationale: 'Recovery notes document stale runtime failure modes and verification rules.',
        },
      ],
    },
  ],
}
