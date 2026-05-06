export interface BlogPostMeta {
  id: string;
  slug: string;
  title: string;
  date: string;
  author: string;
  excerpt: string;
  tags: string[];
  heroImage: string;
  heroAlt: string;
}

export interface DeprecatedBlogPost {
  slug: string;
  retiredLabel: string;
  reason: string;
  replacementSlug: string;
}

export const blogPostMetas: BlogPostMeta[] = [
  {
    id: 'coordination-guard',
    slug: 'coordination-guard-claims-into-policy',
    title: 'Why Coordination Guard Exists',
    date: '2026-05-06',
    author: 'Port Daddy Engineering',
    excerpt: "Coordination Guard was not born from a clean theory of Git as policy. It was born because agents kept staging, resetting, and cherry-picking through each other's claims.",
    tags: ['Coordination Guard', 'Runtime Primitives', 'Git Safety', 'Dogfooding'],
    heroImage: '/img/generated/blog-coordination-guard-policy.jpg',
    heroAlt: 'Swiss-modern commit gate with file claims, session identity, staged paths, and policy checks',
  },
  {
    id: 'bond-pricing-market',
    slug: 'bond-pricing-is-a-market',
    title: 'Bond Pricing Is a Market, Not a Constant',
    date: '2026-04-29',
    author: 'Port Daddy Engineering',
    excerpt: "Daily budgets are training wheels. The v2 of the Bonded Commons paper points at the destination: cleanup-cost lower bounds, scope multipliers, the Bonded Advisor pattern, and Thomas Youle's competitive-insurance market.",
    tags: ['Whitepaper', 'Pricing', 'Bonded Advisor', 'Mechanism Design'],
    heroImage: '/img/generated/blog-control-plane-product.jpg',
    heroAlt: 'Swiss-modern diagram of bond pricing with cleanup cost, scope multiplier, reputation discount, and insurer bidding lanes',
  },
  {
    id: 'evidence-cross-machine',
    slug: 'evidence-that-survives-machines',
    title: 'Evidence That Survives Multiple Machines',
    date: '2026-04-29',
    author: 'Port Daddy Engineering',
    excerpt: 'A note that only your laptop can verify is half a record. The v2 Merkle forest, the KMS witness, and the new mutable-signal ledger turn evidence into something a CI pipeline or a teammate can verify in 700 bytes.',
    tags: ['Whitepaper', 'Merkle Forest', 'KMS Witness', 'Evidence'],
    heroImage: '/img/generated/blog-map-truth.jpg',
    heroAlt: 'Swiss-modern diagram of cross-daemon Merkle forest with session roots, harbor roots, and a witnessed signed tree head',
  },
  {
    id: 'passkey-identity',
    slug: 'passkey-identity-across-machines',
    title: 'Passkey Identity Across Machines',
    date: '2026-04-29',
    author: 'Port Daddy Engineering',
    excerpt: 'Single-node scope was a true description that stopped being true. The Federated Sovereign replaces it with passkey-first identity, an abstract KMS, mobile-as-viewer, and an honest recovery story.',
    tags: ['Whitepaper', 'Identity', 'Passkeys', 'KMS'],
    heroImage: '/img/generated/blog-daemon-provenance.jpg',
    heroAlt: 'Swiss-modern diagram of federated identity with passkey-bound devices, KMS witness, mobile viewer channel, and recovery flow',
  },
  {
    id: 'control-plane-product',
    slug: 'control-plane-is-the-product',
    title: 'The Control Plane Is the Product',
    date: '2026-04-29',
    author: 'Port Daddy Engineering',
    excerpt: 'A local agent system is only trustworthy when project identity, file ownership, runtime provenance, backend readiness, cost, and recovery share one inspectable control plane.',
    tags: ['Control Plane', 'FleetBar', 'Operator UX', 'Product Truth'],
    heroImage: '/img/generated/blog-control-plane-product.jpg',
    heroAlt: 'Swiss-modern diagram of a local control plane with project lanes, readiness gates, and agent activity blocks',
  },
  {
    id: 'fleet-designer-cold-start',
    slug: 'fleet-designer-cold-start',
    title: 'Cold Start Without Surprise Launches',
    date: '2026-04-29',
    author: 'Port Daddy Engineering',
    excerpt: 'A good first-run flow should inspect the repo, expose missing credentials, simulate the fleet, and keep the human in control before any agent starts spending money.',
    tags: ['Onboarding', 'Fleet Design', 'Readiness', 'Mac App'],
    heroImage: '/img/generated/blog-fleet-designer-cold-start.jpg',
    heroAlt: 'Swiss-modern technical drawing of a repo survey becoming a validated fleet plan with readiness and budget gates',
  },
  {
    id: 'pd-tube-event-reply-loop',
    slug: 'pd-tube-event-reply-loop',
    title: 'PD Tube Turns UI Events Into Agent Work',
    date: '2026-04-28',
    author: 'Port Daddy Engineering',
    excerpt: 'PD Tube is the small event-reply loop underneath button-to-agent examples, test reporters, editor lightbulbs, and webhook adapters.',
    tags: ['PD Tube', 'Examples', 'Event Loop', 'Dev Tools'],
    heroImage: '/img/generated/blog-pd-tube-event-reply.jpg',
    heroAlt: 'Swiss-modern sequence diagram of a browser action, local event channel, agent terminal, and threaded reply',
  },
  {
    id: 'telemetry-launch-gate',
    slug: 'telemetry-is-a-launch-gate',
    title: 'Telemetry Is a Launch Gate',
    date: '2026-04-28',
    author: 'Port Daddy Engineering',
    excerpt: 'Operator-facing launches should not succeed unless the backend can prove exact tokens, exact rates, and persisted nonzero cost.',
    tags: ['Telemetry', 'Cost', 'Spawn Policy', 'Readiness'],
    heroImage: '/img/generated/blog-telemetry-launch-gate.jpg',
    heroAlt: 'Swiss-modern gate diagram showing token counts, model rates, and cost records before an agent launch',
  },
  {
    id: 'recovery-roadmap-map',
    slug: 'recovery-roadmap-map-truth',
    title: 'Keeping the Map Honest',
    date: '2026-04-27',
    author: 'Port Daddy Engineering',
    excerpt: 'Roadmaps, recovery docs, session notes, and live daemon state drift unless one surface reconciles them into an operator-readable map.',
    tags: ['Recovery', 'Roadmap', 'Status Map', 'Evidence'],
    heroImage: '/img/generated/blog-map-truth.jpg',
    heroAlt: 'Swiss-modern map of recovery notes, commit history, roadmap lanes, and operator status converging into one projection',
  },
  {
    id: 'daemon-provenance',
    slug: 'running-is-not-current',
    title: 'Running Is Not the Same as Current',
    date: '2026-04-27',
    author: 'Port Daddy Engineering',
    excerpt: 'A daemon can be alive, reachable, and still serving the wrong checkout. Runtime provenance has to be visible before you trust UI or CLI behavior.',
    tags: ['Daemon', 'Runtime Truth', 'Supervisor', 'Debugging'],
    heroImage: '/img/generated/blog-daemon-provenance.jpg',
    heroAlt: 'Swiss-modern provenance diagram comparing source checkout, installed runtime, socket path, TCP route, and supervisor state',
  },
  {
    id: 'backend-readiness',
    slug: 'backend-readiness-is-dependency-truth',
    title: 'Backend Readiness Is Dependency Truth',
    date: '2026-04-26',
    author: 'Port Daddy Engineering',
    excerpt: 'A model backend is ready only when credentials, packages, CLI auth, model catalog, and telemetry policy all agree.',
    tags: ['Backends', 'Models', 'Readiness', 'Control Plane'],
    heroImage: '/img/generated/blog-backend-readiness.jpg',
    heroAlt: 'Swiss-modern readiness matrix with model tiers, dependency checks, credentials, and blocked launch states',
  },
];

export const deprecatedBlogPosts: DeprecatedBlogPost[] = [
  {
    slug: 'zero-to-multi-agent-in-5-minutes',
    retiredLabel: 'Original two-command quickstart',
    reason: 'The public story is now broader than begin/done. It needs file claims, notes, guard checks, readiness, and operator surfaces.',
    replacementSlug: 'coordination-guard-claims-into-policy',
  },
  {
    slug: 'the-port-collision-that-ate-my-saturday',
    retiredLabel: 'Early port-collision anecdote',
    reason: 'Port assignment still matters, but the blog should lead with daemon provenance and current control-plane truth.',
    replacementSlug: 'running-is-not-current',
  },
  {
    slug: 'dead-agents-tell-tales',
    retiredLabel: 'Original crash-recovery article',
    reason: 'Recovery is now part of a larger roadmap and session-map discipline. The old article used outdated framing.',
    replacementSlug: 'recovery-roadmap-map-truth',
  },
  {
    slug: 'cartographer-navigator-map-truth',
    retiredLabel: 'Older map-actor route',
    reason: 'The article now uses recovery-roadmap language instead of old role labels on the public blog surface.',
    replacementSlug: 'recovery-roadmap-map-truth',
  },
  {
    slug: 'formal-verification-anchor-protocol',
    retiredLabel: 'Older identity-protocol proof article',
    reason: 'The trust-boundary story has moved into launch policy, backend readiness, and operator-visible evidence.',
    replacementSlug: 'telemetry-is-a-launch-gate',
  },
  {
    slug: 'distributed-locks-two-agents-one-migration',
    retiredLabel: 'Standalone distributed-locks tutorial',
    reason: 'Locks remain useful, but the current blog should fold them into commit policy and coordination guard behavior.',
    replacementSlug: 'coordination-guard-claims-into-policy',
  },
  {
    slug: 'four-agents-zero-clobber',
    retiredLabel: 'Future-dated file-claims article',
    reason: 'The date was in the future and the article described a planned story as if already published.',
    replacementSlug: 'coordination-guard-claims-into-policy',
  },
  {
    slug: 'pubsub-self-healing-test-pipeline',
    retiredLabel: 'Future-dated pub/sub pipeline article',
    reason: 'The practical current story is PD Tube: a smaller event-reply loop with visible handoffs.',
    replacementSlug: 'pd-tube-event-reply-loop',
  },
  {
    slug: 'fleet-agents-as-infrastructure',
    retiredLabel: 'Future-dated fleet infrastructure article',
    reason: 'Fleet launchability is now tied to readiness, telemetry, and budget policy rather than declaration alone.',
    replacementSlug: 'telemetry-is-a-launch-gate',
  },
  {
    slug: 'spark-and-spider-the-creative-engine',
    retiredLabel: 'Future-dated background-creativity article',
    reason: 'The blog should avoid speculative background-agent marketing until the operator surfaces and policy gates are stable.',
    replacementSlug: 'recovery-roadmap-map-truth',
  },
  {
    slug: 'port-daddy-for-teams',
    retiredLabel: 'Future-dated team rollout article',
    reason: 'Team rollout guidance should wait until the Mac app distribution and setup path are proven end to end.',
    replacementSlug: 'control-plane-is-the-product',
  },
  {
    slug: 'claude-code-port-daddy-integration',
    retiredLabel: 'Future-dated Claude Code integration article',
    reason: 'The integration story now spans Codex, Claude, Gemini, local backends, MCP, and readiness policy.',
    replacementSlug: 'backend-readiness-is-dependency-truth',
  },
  {
    slug: 'performance-at-scale',
    retiredLabel: 'Future-dated performance article',
    reason: 'Public performance claims should wait for current benchmark evidence from the runtime that is actually shipping.',
    replacementSlug: 'running-is-not-current',
  },
];
