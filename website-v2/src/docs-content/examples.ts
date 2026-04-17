import type { DocsContentSection } from './types'

export const examplesSection: DocsContentSection = {
  slug: 'examples',
  title: 'Examples',
  summary:
    'Small, bounded patterns that prove the daemon on real repo work: locking a critical step, sharing tuple state, and passing a harbor card.',
  pages: [
    {
      slug: 'protect-a-critical-command',
      title: 'Protect A Critical Command',
      summary:
        'Wrap one dangerous command in a lock so only one operator or agent can run it at a time.',
      truth: 'source-backed',
      goals: [
        'Serialize one critical section cleanly.',
        'See the lock as operator infrastructure rather than ceremony.',
        'Leave the repo safer than a naked shell command would.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Use a lock when collision is the real risk',
          paragraphs: [
            'Some commands stop being harmless as soon as more than one actor can run them. Database migrations, code generation, and release steps all fall into that category because the second invocation is not “just another shell command.” It is state corruption waiting to happen.',
            'This example keeps the pattern narrow on purpose. The value is not that Port Daddy can wrap a process. The value is that the control plane can turn a contested step into an explicit, auditable critical section instead of leaving collision prevention to etiquette.',
          ],
        },
        {
          type: 'command',
          title: 'Run the command inside a lock',
          command: 'pd with-lock db-migration -- npm run migrate',
          notes: [
            'The daemon acquires the lock, runs the command, and releases the lock even if the command fails.',
            'Use a durable lock name tied to the shared resource, not to one developer machine.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Use `pd lock acquire <name>` and `pd lock release <name>` when you need manual control over a contested section.',
            'Use `pd with-lock` when the right answer is one serialized command, not a long-lived manual claim.',
            'Choose lock names that describe the resource under contention, such as `db-migration` or `release-tag`.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What to look for after the run',
          paragraphs: [
            'A good lock example leaves no ambiguity about who owned the contested step and when it finished. That is the operator win. You can see why a second actor was blocked instead of learning about the race later through broken state.',
            'If the command does not deserve serialization, do not use a lock. The goal is not to wrap everything in more process. The goal is to protect the few operations where unsynchronized execution is obviously reckless.',
          ],
        },
      ],
      sources: [
        {
          path: 'website-v2/src/data/docs.ts',
          rationale: 'CLI reference already documents `pd lock acquire`, `pd lock release`, and `pd with-lock`.',
        },
        {
          path: 'README.md',
          rationale: 'README uses `pd with-lock db-migrations -- npm run migrate` as the concrete locking pattern.',
        },
        {
          path: 'AGENTS.md',
          rationale: 'Repo instructions require shared coordination primitives for overlapping edits and critical sections.',
        },
      ],
    },
    {
      slug: 'exchange-state-through-tuples',
      title: 'Exchange State Through Tuples',
      summary:
        'Publish a typed fact into shared swarm memory, read it back by pattern, and keep that memory scoped to the right harbor.',
      truth: 'source-backed',
      goals: [
        'Understand tuples as shared typed memory instead of ad hoc chat.',
        'See harbor scoping as part of the coordination model.',
        'Use one example that matches the real tuple implementation.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Treat tuples as machine-readable working memory',
          paragraphs: [
            'Tuples are for facts and tasks that another actor should be able to query without reverse-engineering prose. They matter when one agent discovers something, another needs to react, and you do not want the handoff to disappear into a terminal scrollback or a Slack-like message stream.',
            'The important property is not that tuple space is academically elegant. The important property is that it gives the daemon a typed coordination substrate with pattern matching, harbor scoping, and expiry behavior instead of forcing every workflow through bespoke event payloads.',
          ],
        },
        {
          type: 'command',
          title: 'Write and read one tuple',
          command:
            'pd tuple out \'["connection", "trie+pubsub=routing", "spider", 0.9]\' --harbor myapp:fleet\npd tuple rd \'["connection", "*", "*", ">0.7"]\' --harbor myapp:fleet\npd tuple scan --harbor myapp:fleet',
          notes: [
            'The first command writes a typed fact into shared memory.',
            'The second reads matching facts without destroying them.',
            'The third scans the current harbor view so an operator can inspect the active tuple set.',
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Keep tuple traffic scoped',
          body:
            'Tuple space is most useful when the working set belongs to a real team or workflow boundary. Harbor scope keeps one fleet or mission from reading another group’s ambient state by accident.',
        },
        {
          type: 'paragraph',
          title: 'Why the pattern is worth keeping',
          paragraphs: [
            'This is the kind of pattern that gets more valuable as the repo gets busier. A tuple can say “this connection was discovered,” “this task is pending,” or “this risk scored above threshold” without forcing every reader to subscribe to prose and infer structure later.',
            'If the workflow is human-only and ephemeral, a note may be enough. If another agent or watcher must react deterministically, use tuples so the daemon can do real coordination work.',
          ],
        },
      ],
      sources: [
        {
          path: 'README.md',
          rationale: 'README documents tuple out/rd/in/scan as the shared swarm-memory surface.',
        },
        {
          path: 'lib/tuples.ts',
          rationale: 'Tuple-space implementation defines out, rd, take, scan, and count semantics.',
        },
        {
          path: 'routes/tuples.ts',
          rationale: 'Daemon routes expose tuple write, read, take, scan, and count over HTTP.',
        },
      ],
    },
    {
      slug: 'enter-a-harbor-and-pass-a-card',
      title: 'Enter A Harbor And Pass A Card',
      summary:
        'Create a harbor, enter it, receive the active harbor card, and use the harbor boundary as a scoped coordination namespace.',
      truth: 'source-backed',
      goals: [
        'Create and enter a harbor using the current runtime surface.',
        'Understand that harbor entry produces the active capability token.',
        'Keep the example focused on present runtime truth instead of future delegation layers.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'A harbor is a boundary, not just a label',
          paragraphs: [
            'Harbors exist so coordinated work can carry an explicit capability and namespace boundary. They group agents, bound messaging and tuple traffic, and give the daemon a concrete answer to “who belongs to this working set?”',
            'That is why this example stays grounded in entry and use. It does not try to smuggle in the whole future delegation story. The truthful current value is scoped admission plus a real harbor card returned by the live enter path.',
          ],
        },
        {
          type: 'command',
          title: 'Create and enter the harbor',
          command:
            'pd harbor create myapp:security-review --cap "code:read,notes:write,tunnel:create" --ttl 2h\npd harbor enter myapp:security-review\npd harbors',
          notes: [
            'Create the namespace with the capabilities and lifetime you want.',
            'Entering the harbor returns the active harbor card for the current runtime path.',
            'Listing harbors gives the operator a compact view of active boundaries and memberships.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Use harbors when work should share a capability boundary instead of floating in the global namespace.',
            'Treat the returned harbor card as capability-bearing state, not as decorative metadata.',
            'Leave the harbor when the scoped work is done so revocation and membership stay honest.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What is true in the current runtime',
          paragraphs: [
            'The active harbor-card path now issues Phase 2 Ed25519 cards and returns that card from the harbor-enter flow. Legacy verification still exists, but it is explicit compatibility behavior rather than the default path.',
            'That distinction matters for documentation. This example should teach present runtime admission and scope, not accidentally collapse current issuance, legacy verification, and future delegation into one blurry “security” story.',
          ],
        },
      ],
      sources: [
        {
          path: 'lib/harbor-tokens.ts',
          rationale: 'Harbor token issuance and verification code defines the active Phase 2 Ed25519 path and explicit legacy verifier.',
        },
        {
          path: 'routes/harbors.ts',
          rationale: 'Harbor enter route returns `harborCard` from the live runtime surface.',
        },
        {
          path: 'tests/unit/harbor-tokens.test.js',
          rationale: 'Unit tests cover Phase 2 issuance, verification, and the explicit legacy compatibility boundary.',
        },
      ],
    },
  ],
}
