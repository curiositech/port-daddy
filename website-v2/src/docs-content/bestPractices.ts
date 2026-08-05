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
        'Run pd briefing before touching a coordinated repo, launch AI sessions through pd spawn, and close every session with pd done.',
      truth: 'source-backed',
      goals: [
        'Start every session with pd status, pd briefing, and pd salvage.',
        'Use pd spawn instead of raw claude -p so coordination is automatic.',
        'Close sessions with pd done — dangling agents become salvage-queue noise.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Run the loop before the repo gets noisy',
          paragraphs: [
            'The work loop solves the actual failures that ruin multi-agent work: stale runtime assumptions, invisible ownership, repeated archaeology, and ambiguous handoffs.',
            '**Run `pd status`, `pd briefing`, and `pd salvage` before touching a coordinated repo.** Local shell work without a session anchor is invisible work — other agents cannot route around your slice.',
          ],
        },
        {
          type: 'command',
          title: 'The entry sequence',
          command: 'pd status\npd briefing\npd salvage --project myapp',
          output:
            'Port Daddy is running\nSUCCESS: Briefing generated: .portdaddy/briefing.md\n2 dead agent(s) in myapp. Run: pd salvage --project myapp',
          notes: [
            'pd briefing reads live sessions, notes, file claims, and recent activity across the fleet. If you skip it, you are flying blind.',
            'pd salvage shows abandoned work. Check it before starting — you may be about to redo something an interrupted agent already completed.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Use pd spawn, not raw claude -p',
          paragraphs: [
            'Fleet scripts and one-off tasks that call `claude -p` directly are invisible to Port Daddy. They bypass session registration, heartbeats, notes, and budget gates.',
            '**Use `pd spawn` instead of raw `claude -p`.** Port Daddy wraps the launch with automatic registration, heartbeats, note trails, and cost accounting at no extra cost to you.',
          ],
        },
        {
          type: 'command',
          title: 'Spawn an AI session through Port Daddy',
          command:
            'pd spawn --identity myapp:api:auth --purpose "Fix session token refresh" -- "Read the session middleware and fix the token-refresh race condition."',
          output:
            'SUCCESS: Spawn launched\n  Identity: myapp:api:auth\n  Session:  session-fix-session-token-refresh',
          notes: [
            'Every pd spawn launch is registered, heartbeating, and draining toward the project budget ceiling.',
            'Raw `claude -p "..."` leaves no coordination trail, no cost record, and no salvageable session if it crashes.',
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'Never bypass Port Daddy for AI sessions in a coordinated repo',
          body: 'Raw `claude -p`, `aider`, or any backend invoked without `pd spawn` produces invisible work. The session cannot be salvaged if it crashes, its budget is untracked, and other agents cannot see its file claims.',
        },
        {
          type: 'paragraph',
          title: 'Close every session with pd done',
          paragraphs: [
            'When work ends, **run `pd done` to close the session and unregister the agent cleanly.** A session left open without heartbeats drifts to dead and lands in the salvage queue — creating noise for every future `pd briefing` run.',
            'If you forget and the session dies mid-task, use `pd salvage claim <agentId>` in the next session to pick up the context rather than starting cold.',
          ],
        },
        {
          type: 'command',
          title: 'Close the session cleanly',
          command:
            'pd note "Result: Auth middleware updated. JWT refresh race fixed. Validated with npm test."\npd done "Fixed session token refresh race condition"',
          output:
            'SUCCESS: Note added to session session-fix-session-token-refresh\nSUCCESS: Session completed — Fix session token refresh',
          notes: [
            'Leave a result note before pd done. It tells the next agent (or a resurrection) what changed, what was validated, and what remains.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'pd status + pd briefing + pd salvage before any coordinated work.',
            'pd spawn for every AI session — never raw claude -p.',
            'pd note with scope before edits, result before pd done.',
            'pd done when work finishes — not just closing the terminal.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale:
            'Port Daddy-first loop, pd spawn vs raw claude -p requirement, and pd done rules defined here.',
        },
        {
          path: 'docs/DELEGATION-MODES.md',
          rationale:
            'Canonical explanation of when to use pd spawn vs pd fleet vs raw invocations.',
        },
        {
          path: 'docs/adr/0019-declarative-fleet-yaml.md',
          rationale:
            'ADR documents why fleet scripts must route through pd spawn rather than calling claude -p directly.',
        },
      ],
    },
    {
      slug: 'runtime-truth',
      title: 'Semantic Identities and Runtime Discovery',
      summary:
        'Identify services by project:stack:context, never by hardcoded port numbers. Discover the live daemon through the shared helper instead of assuming a fixed local endpoint.',
      truth: 'source-backed',
      goals: [
        'Use semantic identity strings instead of hardcoded ports in all code and configuration.',
        'Discover the live daemon port through the shared helper, not inline localhost URLs.',
        'Verify the running process before debugging features or concluding that something is missing.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Port numbers are not identities',
          paragraphs: [
            'Port numbers change between machines, CI environments, and daemon restarts. A service that binds to 3001 today may bind to 3002 tomorrow if something else holds that port.',
            '**Use `project:stack:context` semantic identities everywhere. Never use a hardcoded port as a service identity.** The same identity string always hashes to the same Port Daddy-assigned port — across restarts, across machines, and across teammates. Any agent can discover your service port from your identity string without out-of-band coordination.',
          ],
        },
        {
          type: 'command',
          title: 'Claim a port by identity, discover it by identity',
          command: 'pd claim myapp:api:main\npd dns lookup myapp:api:main',
          output: 'SUCCESS: myapp:api:main → port 54321\nhost: localhost  port: 54321',
          notes: [
            'The same identity always resolves to the same port. Any other agent calling pd dns lookup myapp:api:main gets the same answer without reading a config file.',
            'Wildcard release: pd release myapp:* releases all ports for a project in one command.',
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'Never hardcode a daemon endpoint in production paths',
          body: 'The daemon may publish a different endpoint in CI, multi-machine setups, or when the preferred bind seed is already held. Production code in lib/, routes/, bin/, and server.ts must use resolveDaemonUrl() from shared/daemon-discovery.ts. This rule is enforced by a CI test (tests/unit/no-hardcoded-daemon-url.test.js).',
        },
        {
          type: 'paragraph',
          title: 'Verify the live daemon before debugging',
          paragraphs: [
            'Source changes do not automatically update the running daemon. If a command exists in source but the installed CLI returns `Not Found`, suspect a stale daemon or stale dist/ before concluding the feature is missing.',
            '**Run `pd status` and verify the actual running process before filing bugs or rewriting code.** Many apparent feature gaps are stale daemon problems.',
          ],
        },
        {
          type: 'command',
          title: 'Runtime verification',
          command:
            'pd status --json\nbrew services info port-daddy\nPD_URL="${PORT_DADDY_URL:-$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed \'s#^#http://127.0.0.1:#\')}"\ncurl -fsS "$PD_URL/health"\ncommand -v pd',
          output:
            '{ "running": true, "url": "http://127.0.0.1:<selected-port>" }\nport-daddy (homebrew.mxcl.port-daddy) running\n{ "ok": true }\n/opt/homebrew/bin/pd',
          notes: [
            'The Homebrew service owns the stable daemon; named `pd dev` instances are isolated feature runtimes.',
            'If the CLI and live daemon disagree, inspect the selected endpoint and executable before trusting any behavioral difference.',
            'After any runtime-serving code change (routes/, server.ts, lib/), rebuild and relaunch a named feature daemon before trusting dogfood results.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Use project:stack:context identity strings — never hardcoded ports — in code and configuration.',
            'Use resolveDaemonUrl() from shared/daemon-discovery.ts in production paths, not a fixed local endpoint.',
            'Run pd status before debugging missing features — it is usually a stale daemon.',
            'After changing runtime-serving code, rebuild and relaunch before trusting the result.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale:
            'Canonical runtime rules, hardcoded-URL prohibition, and shared discovery helper requirement defined here.',
        },
        {
          path: 'docs/adr/0003-semantic-identity-system.md',
          rationale:
            'ADR explains why project:stack:context was chosen and how deterministic port assignment works.',
        },
        {
          path: 'tests/unit/no-hardcoded-daemon-url.test.js',
          rationale:
            'CI test enforces that production source paths contain no fixed loopback literals.',
        },
      ],
    },
    {
      slug: 'coordination-discipline',
      title: 'Coordination Discipline',
      summary:
        'Claim files before editing, write durable notes, keep Coordination Guard in enforce mode, and never reset or stash without reading the active claim map.',
      truth: 'source-backed',
      goals: [
        'Claim the smallest real file or symbol region before making any edit.',
        'Write scope and result notes that a future agent can actually use as a handoff.',
        'Keep Coordination Guard in enforce mode so unclaimed edits cannot reach a commit.',
        'Never run git reset --hard or git stash without reading the active claim map first.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Claim before you edit, not after',
          paragraphs: [
            'A file claim tells other agents "I own this surface right now." Claiming after the edit is useless — the collision has already happened.',
            '**Run `pd session files add <path>` before touching any file.** For code edits, prefer symbol-level claims (`pd session files add <path> --symbol-path <functionName>`) when the work is naturally function-scoped. Narrower claims allow more parallel work.',
          ],
        },
        {
          type: 'command',
          title: 'Claim a symbol region, then edit',
          command:
            'pd session files add src/lib/sessions.ts --symbol-path "addNote"\n# now edit the file',
          output: 'SUCCESS: Claimed src/lib/sessions.ts (symbolPath: addNote)',
          notes: [
            'File claims are advisory by default. Guard enforce mode converts them into commit blockers.',
            'If the symbol index is stale, widen to a whole-file claim and add a note explaining the scope.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Notes are immutable audit trail, not chat',
          paragraphs: [
            'Session notes are append-only by design (ADR-0007). Once written, a note is permanent. This is the feature, not a limitation — other agents reading your notes can trust them as historical records, not chat that may have been edited.',
            '**Write notes that answer three questions: what files did you change, what did you validate, and what is left.** A note that cannot answer those three questions is not a handoff yet. Status-update chat ("looking at the bug now") does not qualify.',
          ],
        },
        {
          type: 'command',
          title: 'Scope note before work, result note before pd done',
          command:
            'pd note "Scope: src/lib/sessions.ts addNote(). Fixing timestamp drift on concurrent inserts. Validate: npm test -- sessions."\n# ... do the work ...\npd note "Result: Fixed addNote() timestamp collision with SQLite ROWID ordering. npm test passes, no worker-exit warnings."',
          output:
            'SUCCESS: Note added to session session-fix-sessions\nSUCCESS: Note added to session session-fix-sessions',
          notes: [
            'The scope note tells other agents to route around your claimed surface before they start.',
            'The result note is the handoff: it tells a future agent or a resurrection what was done, what was proven, and what remains.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Keep Coordination Guard in enforce mode',
          paragraphs: [
            'Advisory mode logs warnings but lets unclaimed edits commit anyway. Enforce mode blocks the commit. In a repo with multiple active agents, advisory mode provides no real coordination guarantee.',
            '**Run `pd guard install --mode enforce` before editing in a coordinated repo.** Then run `pd guard check --staged` before every commit. If the guard blocks, add the missing claim — never bypass with `--no-verify`.',
          ],
        },
        {
          type: 'command',
          title: 'Install the guard, verify before committing',
          command:
            'pd guard install --mode enforce\npd guard status\n# ... stage changes ...\npd guard check --staged',
          output:
            'SUCCESS: Coordination Guard installed (mode: enforce)\nCoordination Guard: enforce | hook: installed\nSUCCESS: All staged files have active claims',
          notes: [
            'If pd guard check --staged fails, a staged file has no active claim. Add the claim; do not bypass the hook.',
            'AGENTS.md requires enforce mode for this repo. If pd guard status shows advisory or missing, treat that as a blocker before editing toward a commit.',
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'Never git reset --hard or git stash without reading claims first',
          body: "git reset --hard and git stash discard working-tree changes. If another agent wrote those changes under an active PD claim, you will destroy their WIP with no warning. Run `pd sessions --all-worktrees` and `pd notes --limit 20` before any destructive git operation to confirm you are not touching another agent's surface.",
        },
        {
          type: 'command',
          title: 'Check the fleet before destructive git operations',
          command:
            'pd sessions --all-worktrees\npd notes --limit 20\n# only then: git reset --hard or git stash',
          output:
            'Active sessions (all worktrees):\n  session-qa-run   port-daddy:fleet:qa   active\nNotes (last 20): ...',
          notes: [
            'If a session is active and owns the files you are about to discard, wait for it to finish or coordinate through notes and claims before proceeding.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'pd session files add <path> (or --symbol-path) before editing any file.',
            'Write a scope note before editing, a result note before pd done.',
            'pd guard install --mode enforce at the start of every session in this repo.',
            'pd guard check --staged before every commit.',
            'pd sessions --all-worktrees + pd notes --limit 20 before git reset --hard or git stash.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale:
            'File claim rules, guard enforce requirement, and git reset warning all defined here.',
        },
        {
          path: 'docs/adr/0007-immutable-session-notes.md',
          rationale:
            'ADR explains why notes are append-only and what that means for coordination trust between agents.',
        },
        {
          path: 'docs/adr/0008-agent-resurrection-pattern.md',
          rationale:
            'ADR explains why salvage is a deliberate recovery flow and why notes must be durable handoffs, not chat.',
        },
      ],
    },
    {
      slug: 'testing-and-promotion',
      title: 'Worktrees, Git Discipline, and Promotion',
      summary:
        'Use isolated worktrees for parallel agent write work, commit before launching them, and rebase against origin/main before every push.',
      truth: 'source-backed',
      goals: [
        'Run parallel agent write work in isolated git worktrees, not in the main working tree.',
        'Commit current changes before launching any worktree-based agent.',
        'Fetch and rebase against origin/main before every push.',
        'Run the full test gate and use the promotion script before claiming the release is ready.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Use worktrees for parallel agent work',
          paragraphs: [
            'When two agents edit the same repo concurrently from the same working tree, merge conflicts are guaranteed. Worktrees give each agent an isolated HEAD and working directory so they can run in parallel without stepping on each other.',
            '**Set `worktree: true` in fleet agent definitions for any agent that writes to the repo.** An agent in an isolated worktree can commit freely; its changes merge back when the task completes, not mid-flight.',
          ],
        },
        {
          type: 'command',
          title: 'Worktree agent in pd-fleet.yml',
          command:
            'agents:\n  qa:\n    trigger: git:committed\n    backend: claude\n    worktree: true\n    prompt: "Adversarial review of the latest commit. Write tests for every bug found."\n    identity: "{project}:fleet:qa"',
          output:
            'SUCCESS: pd fleet validate — 1 agent configured with worktree isolation',
          notes: [
            'worktree: true causes pd fleet to provision an isolated git worktree for each run and clean it up on completion.',
            'Agents that only read the repo do not need worktree isolation.',
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'Commit before launching worktree agents',
          body: 'A worktree agent starts from the HEAD commit, not from your working-tree changes. If you have uncommitted changes when the agent starts, the agent works from a different base than you — guaranteeing a conflict when both sides try to push. Commit (or stash with a PD claim check) before launching worktree agents.',
        },
        {
          type: 'paragraph',
          title: 'Fetch and rebase before every push',
          paragraphs: [
            'In a multi-agent repo, origin/main can move while you work. Pushing on a stale base silently overwrites changes another agent already landed.',
            '**Run `git fetch origin && git rebase origin/main` before every push.** Then run `pd guard check --staged` to confirm all staged files have active claims. Review `pd sessions --all-worktrees` and `pd notes --limit 20` so you know the current fleet picture before publishing.',
          ],
        },
        {
          type: 'command',
          title: 'Pre-push reconciliation sequence',
          command:
            'git fetch origin\ngit rebase origin/main\npd sessions --all-worktrees\npd notes --limit 20\npd guard check --staged\ngit push -u origin <branch>',
          output:
            'Successfully rebased onto origin/main\n  session-qa-run   active   port-daddy:fleet:qa\nNotes (last 20): ...\nSUCCESS: All staged files have active claims\nBranch pushed to origin/<branch>',
          notes: [
            'This sequence is required by AGENTS.md before any commit, push, or deploy.',
            'If pd guard check --staged fails after the rebase, another agent may hold a claim on the conflicting file. Add your claim or wait for them to finish.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Test gate and release proof',
          paragraphs: [
            '`bun run test` and `bun run typecheck` are the minimum repo-health gates. A green exit code is not a clean result if the runner reports leaked workers or open handles.',
            'Runtime changes also need a named `pd dev` daemon built from the exact checkout. Release only through the GitHub release workflow and the `curiositech/homebrew-tap` formula described in `docs/RELEASING.md`.',
          ],
        },
        {
          type: 'command',
          title: 'Test gate, then prove the feature daemon',
          command: 'bun run test\nbun run typecheck\npd dev up --from "$(pwd)" --label <feature>\npd dev list\npd dev down <feature>',
          output:
            'Test Suites: all passed\nTypeScript: no errors\n<feature> running at its published endpoint\n<feature> stopped',
          notes: [
            'Use the selected named instance for CLI and browser proof; never infer its endpoint from the preferred seed.',
            'Follow `docs/RELEASING.md` after proof passes; do not improvise service promotion or publish from an unmerged checkout.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'worktree: true for every fleet agent that writes to the repo.',
            'Commit before launching any worktree agent — stale HEAD means guaranteed conflicts.',
            'git fetch origin + git rebase origin/main before every push.',
            'pd guard check --staged as the final gate before git push.',
            'bun run test plus typecheck before any release claim; chase worker-exit warnings until clean.',
            'Named feature-daemon proof from the exact checkout before a Homebrew release.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale:
            'Fetch+rebase discipline, guard check before push, and worktree rules all defined here.',
        },
        {
          path: 'docs/adr/0019-declarative-fleet-yaml.md',
          rationale:
            'ADR documents worktree: true for fleet agents and why pd spawn is the correct execution primitive.',
        },
        {
          path: 'docs/RELEASING.md',
          rationale: 'Canonical GitHub release and Homebrew tap procedure.',
        },
        {
          path: 'package.json',
          rationale: 'Defines the Bun test and typecheck gates used for repo-health checks.',
        },
      ],
    },
    {
      slug: 'onboarding-surfaces',
      title: 'Fleet Setup and Budget Discipline',
      summary:
        'Set limits.budget_usd_per_day before enabling any fleet agent triggers, and use pd fleet init to generate a starter configuration.',
      truth: 'blocked',
      goals: [
        'Set a daily budget ceiling before enabling any fleet agent on a trigger or schedule.',
        'Use pd fleet validate to catch schema errors and cost projections before pd fleet up.',
        'Understand what pd init, pd fleet init, and pd mcp install each set up.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Budget every fleet agent before enabling triggers',
          paragraphs: [
            'Fleet agents on triggers or schedules can spawn many AI runs in a short window. Without a budget ceiling, a trigger storm — a rapid series of git:committed events — can drain meaningful spend before you notice.',
            '**Set `limits.budget_usd_per_day` in pd-fleet.yml before enabling any trigger- or schedule-based agent.** The fleet engine enforces this ceiling at spawn time and blocks new launches once the day\'s budget is exhausted.',
          ],
        },
        {
          type: 'command',
          title: 'Always declare limits in pd-fleet.yml',
          command:
            'fleet:\n  name: myapp\n  limits:\n    budget_usd_per_day: 5.00\n  agents:\n    qa:\n      trigger: git:committed\n      backend: claude\n      worktree: true\n      prompt: "Adversarial review of the latest commit."\n      identity: "{project}:fleet:qa"',
          output:
            'SUCCESS: pd fleet validate — 1 agent, budget ceiling $5.00/day',
          notes: [
            '`pd fleet validate` warns "Fleet limits.budgetUsdPerDay is required for every agentic launch" when agents are non-empty and no budget is set. Fix it before `pd fleet up`.',
            'If predicted spend across all agents would exceed the ceiling, reduce the model tier or lower trigger frequency.',
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'A fleet without a budget ceiling is a spend incident waiting to happen',
          body: 'Fleet agents fire on every matching trigger event. A busy git workflow with four trigger agents and no budget ceiling can exhaust meaningful daily spend in a single active afternoon. Set limits.budget_usd_per_day before pd fleet up, not after your first bill.',
        },
        {
          type: 'paragraph',
          title: 'Three entry points, one unfinished journey',
          paragraphs: [
            'Project setup, fleet setup, and MCP setup already exist as working commands. They are not roadmap bullets.',
            'What is still being productized is the feeling of one clear first-run journey from install to a configured project, working fleet, and sensible budget.',
          ],
        },
        {
          type: 'command',
          title: 'Available onboarding commands',
          command: 'pd init\npd fleet init\npd mcp install',
          output:
            'SUCCESS: Project initialized\nSUCCESS: Created pd-fleet.yml\nSUCCESS: MCP configuration installed',
          notes: [
            'pd fleet init creates a starter pd-fleet.yml but does not include a limits section. Add `fleet.limits.budget_usd_per_day` manually before running pd fleet up.',
            'Run pd fleet validate after editing pd-fleet.yml to catch schema errors and projected-cost warnings before launching agents.',
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Real commands, unfinished journey',
          body: 'The commands work. What is still being tightened is the first-run story that carries a new user cleanly from install to a configured project and working fleet. Treat the onboarding as functional but not yet polished.',
        },
      ],
      sources: [
        {
          path: 'docs/adr/0019-declarative-fleet-yaml.md',
          rationale:
            'ADR documents limits.budget_usd_per_day and the fleet engine budget enforcement at spawn time.',
        },
        {
          path: 'docs/adr/0026-fleet-ast-and-diagnostics.md',
          rationale:
            'ADR proposes FLEET004/FLEET008 coded diagnostics; current engine emits equivalent plain-text topology warnings via validateTopology().',
        },
        {
          path: 'docs/V4-UNIFIED-ROADMAP.md',
          rationale:
            'Roadmap confirms budget enforcement at spawn time is shipped (cost-tracker commit 0169b17).',
        },
        {
          path: 'docs/recovery/CURRENT-WORK.md',
          rationale:
            'Recovery queue shows the first-run onboarding story is still being productized.',
        },
      ],
    },
  ],
}
