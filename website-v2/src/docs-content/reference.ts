import type { DocsContentSection } from './types'

export const referenceSection: DocsContentSection = {
  slug: 'reference',
  title: 'Reference',
  summary:
    'Fast lookup for the commands, routes, SDK calls, MCP tools, and harbor scopes in Port Daddy today.',
  pages: [
    {
      slug: 'core-cli-commands',
      title: 'Complete CLI Command Surface',
      summary:
        'Every routed `pd` command family in the current CLI, including specialist and recently added surfaces.',
      truth: 'source-backed',
      goals: [
        'Keep the public CLI reference aligned with `bin/port-daddy-cli.ts` and `cli/commands/*.ts`.',
        'Expose newer surfaces like `pd tube`, `pd guard`, `pd actor`, `pd wallet`, `pd roadmap`, `pd ideas`, and `pd feedback`.',
        'Ensure every command row resolves to a real detail page with syntax, options, examples, aliases, source provenance, and API contract metadata.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Start with the full index',
          paragraphs: [
            'The `/docs/cli` page is the lookup surface for the whole CLI in this checkout. Every command row links to either a hand-authored page or a generated API-spec page backed by the same catalog.',
            'Treat the index as source-backed navigation, not the documentation itself. If a command is routed in `bin/port-daddy-cli.ts`, it gets a resolvable detail route.',
          ],
        },
        {
          type: 'command',
          title: 'Daily loop plus newer specialist surfaces',
          command:
            'pd status\npd briefing\npd begin "Fix auth bug" --identity myapp:api --lifecycle durable\npd note "JWT validation passing"\npd tube ui:clicks\npd guard check --staged\npd actor lookout --message "release-surface drift fixed"\npd done "Docs updated"',
          notes: [
            'The everyday loop remains first-class.',
            '`pd tube`, actor mailboxes, guard, roadmap, ideas, wallet, bond, and feedback commands now appear in the CLI reference instead of being source-only knowledge.',
          ],
        },
        {
          type: 'checklist',
          items: [
            '`/docs/cli` is backed by `website-v2/src/data/referenceCatalog.ts`.',
            'The catalog records aliases, high-value flags, source files, and generated detail-page routes.',
            'Search uses the same catalog, so `pd tube` and other newer commands are discoverable from the docs search box.',
          ],
        },
      ],
      sources: [
        {
          path: 'bin/port-daddy-cli.ts',
          rationale: 'CLI router defines the commands that are actually accepted.',
        },
        {
          path: 'cli/commands/',
          rationale: 'Command handlers define subcommands, flags, and behavior.',
        },
        {
          path: 'website-v2/src/data/referenceCatalog.ts',
          rationale: 'Website catalog mirrors the current CLI surface for `/docs/cli` and docs search.',
        },
      ],
    },
    {
      slug: 'typescript-sdk-surface',
      title: 'Complete TypeScript SDK Surface',
      summary:
        'Every public method on the `PortDaddy` client class, grouped by daemon capability.',
      truth: 'source-backed',
      goals: [
        'Show the direct SDK method surface, not a made-up nested module API.',
        'Expose newer SDK coverage for actors, wallets, bonds, panic, pheromones, Arbiter, tuples, spawn, and semantic work.',
        'Keep `/docs/sdk` useful even before every method has a dedicated page.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'The SDK is a direct client class',
          paragraphs: [
            '`PortDaddy` exposes methods directly on the client instance: `pd.claim`, `pd.begin`, `pd.spawn`, `pd.tupleOut`, and so on.',
            'The overview page now lists the whole public method catalog from `lib/client.ts`, while dedicated pages continue to explain the most common modules in depth.',
          ],
        },
        {
          type: 'command',
          title: 'Canonical import and first calls',
          command:
            "import { PortDaddy } from 'port-daddy/client'\n\nconst pd = new PortDaddy()\nawait pd.claim('myapp:api:main')\nawait pd.begin('Build API preview', { lifecycle: 'durable', identity: 'myapp:api:main' })\nawait pd.note('Preview server claimed')\nawait pd.done('Preview ready')",
        },
        {
          type: 'checklist',
          items: [
            '`/docs/sdk` lists constructor options, public methods, and exports from the current checkout.',
            'Search indexes every SDK method and links back to the overview anchors.',
            'Dedicated pages remain useful for core modules, but they are no longer the only discoverability path.',
          ],
        },
      ],
      sources: [
        {
          path: 'lib/client.ts',
          rationale: 'The `PortDaddy` class defines the public SDK method surface.',
        },
        {
          path: 'shared/types.ts',
          rationale: 'Client options and exported types back the constructor and type-safety examples.',
        },
        {
          path: 'website-v2/src/data/referenceCatalog.ts',
          rationale: 'Website SDK catalog groups the complete method list.',
        },
      ],
    },
    {
      slug: 'mcp-tool-surface',
      title: 'Complete MCP Tool Surface',
      summary:
        'The tiered MCP catalog, default-mode tools, `pd_discover`, and all full-mode tool categories.',
      truth: 'source-backed',
      goals: [
        'Document default mode and full mode honestly.',
        'Keep tool counts and category lists tied to `mcp/server.ts`.',
        'Show that MCP covers the same coordination plane as the CLI and SDK.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Tiered by default, complete through discovery',
          paragraphs: [
            'The MCP server starts small by exposing the essential tool set plus `pd_discover` unless full mode is enabled.',
            '`pd_discover` returns categories, counts, names, and schemas so model clients can reach the full tool surface without flooding the first tool list.',
          ],
        },
        {
          type: 'checklist',
          items: [
            '`/docs/mcp` lists every category from `TOOL_CATEGORIES`.',
            'Default mode currently exposes the essential set plus `pd_discover`.',
            'Full mode covers all registered functions, including fleet control, semantic memory, feedback, tuples, actors, inbox, and budget surfaces.',
          ],
        },
      ],
      sources: [
        {
          path: 'mcp/server.ts',
          rationale: 'MCP tool definitions, categories, default-mode filter, and discovery behavior.',
        },
        {
          path: 'website-v2/src/data/mcp.ts',
          rationale: 'Website MCP catalog mirrors categories and tool names.',
        },
        {
          path: 'cli/commands/mcp-install.ts',
          rationale: 'Installer defines supported MCP client config targets.',
        },
      ],
    },
    {
      slug: 'daemon-http-surface',
      title: 'Daemon HTTP Routes',
      summary:
        'The high-value route groups on the live daemon: sessions, salvage, harbors, tuples, spawn, and fleet.',
      truth: 'source-backed',
      goals: [
        'Know which route groups exist right now.',
        'Use the route groups as lookup anchors instead of memorizing every leaf path.',
        'Keep API reference tied to the real daemon routes.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Think in route groups before leaf endpoints',
          paragraphs: [
            'The daemon routes are easiest to navigate when you think in groups first: sessions and sugar, agents and salvage, tuples and messaging, harbors, spawn, fleet, and general status.',
            'A good reference page should get you to the right neighborhood immediately, then let you drill into the exhaustive endpoint list. It should not force you to read a wall of raw paths just to answer “where do I inspect spawned runs?” or “which routes own harbor membership?”',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Use `/status` and related info routes for daemon health and overview.',
            'Use `/sugar/*`, `/sessions`, `/agents`, and `/salvage` for identity, lifecycle, and recovery.',
            'Use `/harbors`, `/tuples`, `/spawn`, and `/fleet` when you need scoped coordination, tracked runs, or project automation.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Where to go for exhaustive detail',
          paragraphs: [
            'The live reference source in this repo is the OpenAPI file plus the route handlers themselves. Use those when you need exact payloads, current parameters, or route-level behavior.',
            'The public docs should summarize the route groups clearly, but exhaustive details belong in generated or source-backed API reference rather than hand-maintained prose alone.',
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
          rationale: 'Route registry shows which major groups are registered in the daemon.',
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
        'The current capability vocabulary for harbor-scoped work.',
      truth: 'source-backed',
      goals: [
        'Know what a harbor card is expressing today.',
        'See the capability model as practical scope rather than abstract security language.',
        'Understand where present scope ends and future delegation begins.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Capabilities describe what the harbor may do',
          paragraphs: [
            'A harbor card carries a capability array because Port Daddy needs more than a harbor name. The card should say which classes of action are allowed inside that protected work area.',
            'The vocabulary is intentionally practical: read code, write notes, acquire locks, create tunnels, publish or subscribe to messages, claim files, and spawn child agents. It describes what a workflow can do, not an abstract theory.',
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
            'This page should not imply that the repo has already shipped the full future delegation system. The current state is scoped admission plus capability-bearing cards on the present harbor path.',
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
          rationale: 'Harbor token payload shape and verification logic define the capability-bearing card.',
        },
        {
          path: 'routes/harbors.ts',
          rationale: 'Harbor routes expose create, enter, leave, membership, and detail behavior.',
        },
      ],
    },
  ],
}
