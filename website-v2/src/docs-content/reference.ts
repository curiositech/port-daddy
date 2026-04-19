import type { DocsContentSection } from './types'

export const referenceSection: DocsContentSection = {
  slug: 'reference',
  title: 'Reference',
  summary:
    'Fast lookup material for the commands, routes, and capability boundaries that matter most in the current runtime.',
  pages: [
    {
      slug: 'core-cli-commands',
      title: 'Core CLI Commands',
      summary:
        'The shortest useful command set for operating the daemon honestly: runtime checks, session lifecycle, coordination, and recovery.',
      truth: 'source-backed',
      goals: [
        'Know the default operator entry points.',
        'Separate baseline commands from specialist surfaces.',
        'Keep a reference page that favors lookup speed over storytelling.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Start with the commands that change operator truth',
          paragraphs: [
            'The core CLI is not every command in the binary. It is the small set that establishes runtime truth, starts coordinated work, leaves visible evidence, and recovers when something dies mid-task.',
            'That is why this reference begins with status, briefing, salvage, begin, note, whoami, done, and the locking surfaces. Those are the commands that turn a daemon install into a usable operating loop.',
          ],
        },
        {
          type: 'command',
          title: 'Baseline operator set',
          command:
            'pd status\npd briefing\npd salvage\npd begin --identity myapp:api --purpose "Fix auth bug"\npd note "JWT validation passing"\npd whoami\npd done',
          notes: [
            'Treat this as the smallest serious operator loop.',
            'Use lock or harbor surfaces only when the work actually needs stronger coordination or scope.',
          ],
        },
        {
          type: 'checklist',
          items: [
            '`pd status` and `pd briefing` tell you what runtime and project state you are actually about to touch.',
            '`pd begin`, `pd note`, `pd whoami`, and `pd done` carry the identity and evidence trail.',
            '`pd salvage` and `pd salvage claim` keep interrupted work recoverable instead of invisible.',
          ],
        },
      ],
      sources: [
        {
          path: 'website-v2/src/data/docs.ts',
          rationale: 'CLI command registry defines the operator-facing command set and examples.',
        },
        {
          path: 'README.md',
          rationale: 'README highlights the baseline coordination commands in the public operator story.',
        },
        {
          path: 'AGENTS.md',
          rationale: 'Repo instructions prioritize `pd status`, `pd briefing`, `pd salvage`, and `pd begin` as the startup loop.',
        },
      ],
    },
    {
      slug: 'daemon-http-surface',
      title: 'Daemon HTTP Surface',
      summary:
        'The high-value route groups on the live daemon: sessions, salvage, harbors, tuples, sorties, and fleet.',
      truth: 'source-backed',
      goals: [
        'Know which route groups exist right now.',
        'Use the route groups as lookup anchors instead of memorizing every leaf path.',
        'Keep API reference tied to the real daemon surface.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Think in route groups before leaf endpoints',
          paragraphs: [
            'The daemon surface is easiest to navigate when you think in groups first: sessions and sugar, agents and salvage, tuples and messaging, harbors, sorties, fleet, and general status. That grouping matches how operators actually approach the runtime.',
            'A good reference page should get you to the right neighborhood immediately, then let you drill into the exhaustive endpoint list. It should not force you to read a wall of raw paths just to answer “where do I inspect sorties?” or “which routes own harbor membership?”',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Use `/status` and related info routes for daemon health and overview.',
            'Use `/sugar/*`, `/sessions`, `/agents`, and `/salvage` for identity, lifecycle, and recovery.',
            'Use `/harbors`, `/tuples`, `/sorties`, and `/fleet` when you need the scoped coordination and delegation surfaces.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Where to go for exhaustive detail',
          paragraphs: [
            'The live reference source in this repo is the OpenAPI file plus the route handlers themselves. That is the layer to trust when you need exact payloads, current parameters, or a route-level truth check.',
            'The public docs should summarize that surface clearly, but the exhaustive shape still belongs to generated or source-backed API reference rather than hand-maintained prose alone.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/openapi.yaml',
          rationale: 'OpenAPI file is the exhaustive route-level reference source for the daemon.',
        },
        {
          path: 'routes/index.ts',
          rationale: 'Route registry shows which major surfaces are actually registered in the daemon.',
        },
        {
          path: 'website-v2/src/data/docs.ts',
          rationale: 'Current public docs data already groups HTTP endpoints by domain area.',
        },
      ],
    },
    {
      slug: 'harbor-capabilities-and-scopes',
      title: 'Harbor Capabilities And Scopes',
      summary:
        'The current capability vocabulary for harbor-scoped work and the boundary it is meant to enforce.',
      truth: 'source-backed',
      goals: [
        'Know what a harbor card is expressing today.',
        'See the capability model as operational scope rather than abstract security language.',
        'Understand where present scope ends and future delegation begins.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Capabilities describe what the harbor may do',
          paragraphs: [
            'A harbor card carries a capability array because the daemon needs a concrete scope boundary, not just a harbor name. That scope is what lets the control plane distinguish “belongs to this working set” from “may perform these specific classes of action within it.”',
            'The vocabulary is intentionally practical: read code, write notes, acquire locks, create tunnels, publish or subscribe to messages, claim files, and spawn child agents. This is operational scope, not abstract theory.',
          ],
        },
        {
          type: 'checklist',
          items: [
            '`code:read` and `notes:write` cover the basic inspection and evidence trail.',
            '`lock:acquire`, `msg:publish`, and `msg:subscribe` govern coordination primitives.',
            '`file:claim`, `tunnel:create`, and `spawn:agents` expand the harbor boundary into broader workflow control.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What this page should not imply',
          paragraphs: [
            'This page should not imply that the repo has already shipped the full future delegation economy. The truthful current state is scoped admission plus capability-bearing cards on the present harbor path.',
            'That is enough to make harbor scope meaningful now. It is also a clean boundary from which the later delegation and attenuation layers can grow without rewriting the basic model.',
          ],
        },
      ],
      sources: [
        {
          path: 'website-v2/src/data/docs.ts',
          rationale: 'Current public docs data enumerates the active capability scopes.',
        },
        {
          path: 'lib/harbor-tokens.ts',
          rationale: 'Harbor token payload shape and verification logic define the capability-bearing card boundary.',
        },
        {
          path: 'routes/harbors.ts',
          rationale: 'Harbor routes expose create, enter, leave, membership, and detail surfaces for the current runtime.',
        },
      ],
    },
  ],
}
