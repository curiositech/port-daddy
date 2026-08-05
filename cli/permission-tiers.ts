/**
 * CLI Permission Tiers
 *
 * Authoritative classification of every `pd` command into one of four tiers,
 * by impact on shared state and other agents:
 *
 *   silent       Read-only. No observable side effects.
 *   notify       Mutates caller-scoped state. Reversible.
 *   approval     Mutates state that affects another agent. No data loss.
 *   destructive  Releases another agent's resources, OR removes/expires records.
 *
 * The audit that motivated this file caught `pd salvage` releasing another
 * agent's claims with no user-facing warning. Anything destructive must now
 * go through `requireConfirmation()` (see cli/utils/destructive-confirm.ts)
 * and surface its tier in --help.
 *
 * Commands here are keyed by what the operator types after `pd `. For
 * subcommands that change tier mid-command (e.g. `pd salvage` is silent in
 * its default list form but `pd salvage claim` is destructive), the registry
 * stores the WORST-CASE tier for the top-level entry and the per-subcommand
 * tiers under `SUBCOMMAND_TIERS`. Use `resolveTier()` to get the right answer
 * for an actual invocation.
 */

export type Tier = 'silent' | 'notify' | 'approval' | 'destructive';

export const ALL_TIERS: readonly Tier[] = ['silent', 'notify', 'approval', 'destructive'];

/**
 * Top-level command -> tier. For top-level verbs (e.g. `pd claim`), this is
 * the operative tier. For top-level groups whose subcommands span tiers
 * (e.g. `pd salvage`, `pd session`, `pd agent`), this is the WORST case the
 * group can produce; `SUBCOMMAND_TIERS` then refines per subcommand.
 */
export const TIER_REGISTRY: Record<string, Tier> = {
  // ── silent: read-only ────────────────────────────────────────────────────
  status: 'silent',
  attest: 'silent', // honest self-report (ADR-0045); read-only introspection
  version: 'silent',
  whoami: 'silent',
  account: 'notify', // login/pair/logout mint or drop a device token; status/token refined silent below
  w: 'silent',
  find: 'silent',
  f: 'silent',
  l: 'silent',
  list: 'silent',
  ps: 'silent',
  services: 'silent',
  url: 'silent',
  env: 'silent',
  ports: 'silent',          // refined below: `ports cleanup` is destructive
  locks: 'silent',
  sessions: 'silent',
  notes: 'silent',
  agents: 'silent',
  swarm: 'silent',
  actors: 'silent',
  roster: 'approval',
  actor: 'silent',
  changelog: 'silent',
  log: 'silent',
  activity: 'silent',
  briefing: 'silent',
  arrive: 'silent',      // read-only arrival briefing; ranks existing state, writes nothing
  history: 'silent',
  dashboard: 'silent',
  health: 'silent',
  metrics: 'silent',
  config: 'silent',
  hints: 'silent',
  bench: 'silent',
  demo: 'silent',
  doctor: 'silent',
  diagnose: 'silent',
  'ci-gate': 'silent',
  help: 'silent',
  learn: 'silent',
  tutorial: 'silent',
  sitrep: 'silent',
  plan: 'notify',

  whois: 'silent',          // semantic skill-router: read-only ranking of agents by capability
  look: 'silent',
  periscope: 'silent',     // operator-loop SIGHT stage: read-only state+next-cut rollup
  sight: 'silent',         // alias of periscope
  scope: 'silent',         // alias of periscope
  'coast-guard': 'silent', // Coast Guard read path: read-only local confinement status
  cg: 'silent',            // alias of coast-guard
  advise: 'silent',
  preflight: 'silent',
  compass: 'silent',
  roadmap: 'silent',
  ideas: 'silent',
  graph: 'silent',
  embed: 'notify', // worst case: `embed prefetch` downloads ~27 MB into the shared cache; reads/embeds are silent
  'skill-graft': 'notify', // worst case: `skill-graft warm` refreshes the local graft cache; reads are silent
  skillgraft: 'notify',    // alias of skill-graft
  memory: 'silent',
  booty: 'notify',          // worst case: `booty add` writes blobs + provenance rows; `booty list` is silent (refined below)
  seamanship: 'notify',     // worst case: `seamanship sync`/`index` write the local skill catalog
                            // under ~/.port-daddy/skills; list/search/show are silent (refined below)
  skills: 'notify',         // alias of seamanship
  'who-owns': 'silent',
  harbors: 'silent',
  'harbor-ledger': 'notify', // worst case: `harbor-ledger rebuild` truncates+replays DISPOSABLE projection tables (the event log is never touched); refined below
  spawned: 'silent',
  work: 'silent',           // `pd work probe`/`pd work matrix` are read-only conformance surfaces (ch18 C2); launch forms refuse until pd work start lands
  feedback: 'silent',       // default form is `feedback list/show/summary`; writes are `notify`
  quorum: 'silent',
  parley: 'approval',       // summons/resolves other agents; read-only forms refined below
  tuple: 'silent',
  pheromone: 'silent',
  ph: 'silent',
  safe: 'silent',           // bare form = `safe scan`, read-only. Refined below:
                            // `safe baseline accept` (notify), `safe fix` (approval).
  scan: 'silent',
  s: 'silent',
  projects: 'silent',       // refined: `projects rm` is destructive
  p: 'silent',
  channels: 'silent',       // refined: `channels clear` is destructive
  webhook: 'silent',
  webhooks: 'silent',
  dns: 'silent',            // refined: `dns cleanup`, `dns register` are mutations
  snapshots: 'silent',
  snapshot: 'silent',
  cockpit: 'silent',
  shipwright: 'silent',
  secret: 'silent',         // refined: `secret set` is notify, `secret rm` is destructive
  popper: 'silent',         // refined: `popper pop` is approval, enable/disable are notify
  inbox: 'silent',
  integration: 'silent',
  wallet: 'silent',
  bond: 'silent',
  fleet: 'silent',          // refined: `fleet down`, `fleet panic` are destructive
  squid: 'approval',        // starts a local Anthropic-compatible bridge and optional client process; refined: on/off/status/tap below
  hooks: 'notify',          // wires daemon-gated agent-CLI coordination hooks; refined: `hooks list` is silent
  tube: 'silent',
  tunnel: 'silent',
  relay: 'silent',           // refined: `relay url <url>` is notify
  init: 'notify',
  setup: 'notify',
  transcripts: 'silent',    // refined: `transcripts delete/rm` is destructive
  transcript: 'silent',     // singular alias for the same read-only views
  morning: 'silent',        // reads the overnight dispatch report; no mutation

  // ── notify: caller-scoped, reversible ────────────────────────────────────
  claim: 'notify',
  c: 'notify',
  release: 'notify',        // refined: `release --expired` is destructive (releases stale claims globally)
  r: 'notify',
  lock: 'notify',
  unlock: 'notify',         // refined: `unlock --force` is destructive
  session: 'notify',        // refined: `session abandon` is destructive
  takeover: 'notify',       // alias for session takeover; preserves predecessor notes
  note: 'notify',
  n: 'notify',
  begin: 'notify',
  b: 'notify',
  done: 'notify',
  'with-lock': 'notify',
  say: 'notify',
  add: 'notify',
  semantic: 'notify',
  watch: 'notify',
  attention: 'notify',      // default fetch marks inbox/channel items read for this agent
  nudge: 'silent',          // bare form lists this agent's pending suggestibility nudges (read-only)
  commit: 'notify',         // records a caller-scoped commitment/obligation; `commit close` finalizes one
  backend: 'notify',        // sets the active CLI/subscription backend (caller config); status form is read-only
  backup: 'notify',         // writes a durable snapshot of the registry DB; reversible, caller-scoped
  cut: 'notify',            // cuts a release: runs builds, writes dist/release/<v>, optional sign — local, caller-scoped
  batten: 'notify',         // worst case: `batten imprint` writes a caller-scoped receipt; verify is refined silent below
  benchmark: 'notify',      // `benchmark run` makes paid multi-backend LLM calls; refined: list-models/list-conditions/report are silent reads
  // ── approval: mutates another agent's state, no data loss ────────────────
  // Top-level entries; subcommand refinement may downgrade.
  pub: 'approval',
  publish: 'approval',
  broadcast: 'approval',
  sub: 'silent',            // subscribe is read-only stream
  subscribe: 'silent',
  listen: 'silent',
  wait: 'silent',
  up: 'approval',           // brings up multi-service stacks; effects on shared ports
  u: 'approval',
  spawn: 'approval',        // refined: `spawn kill` is destructive
  sortie: 'approval',       // one-shot multi-agent mission: spawns agents, spends budget; refined: read subcommands are silent
  agent: 'approval',        // refined: `agent unregister`, `agent inbox clear` are destructive
  mcp: 'approval',
  harbor: 'approval',       // refined: `harbor destroy` is destructive
  harbormaster: 'approval', // start/stop the shared merge-owning actor; affects every agent's merges
  hm: 'approval',           // alias for harbormaster
  dispatch: 'approval',     // queues/runs autonomous dev work and spawns agents on shared state
  suggest: 'approval',      // worst case: `suggest approve` fires a one-shot ship run (spends and
                            // spawns, same posture as dispatch); list/dismiss refined below
  nightshift: 'approval',   // kicks off autonomous overnight feature dev across the fleet
  review: 'approval',       // approves/rejects produced dispatch work — gates others' merges

  // ── destructive: releases another's resources OR removes records ─────────
  salvage: 'destructive',           // refined: bare `salvage` list is silent; subcommands vary
  resurrection: 'destructive',
  down: 'destructive',
  d: 'destructive',
  stop: 'destructive',
  start: 'notify',                  // starts the daemon, not destructive
  restart: 'destructive',           // kills the running daemon
  install: 'notify',                // installs launchd plist; not destructive on its own
  'self-update': 'notify',          // ADR-0062: opt-in hands-off brew-upgrade + restart; notify, not gated (must run unattended via the freshness LaunchAgent)
  upgrade: 'notify',                // ADR-0057 phase 7: bare form is a read-only feed check; `--apply` shells brew upgrade. notify (not gated) so the report path is frictionless.
  uninstall: 'destructive',
  guard: 'silent',                  // refined: `guard install`, `guard enable/disable` are destructive
  dev: 'approval',                  // refined: `dev down` stops a berth (destructive); see SUBCOMMAND_TIERS
  use: 'silent',                    // emits a shell snippet to eval; read-only, no daemon mutation (ADR-0084)
  daemon: 'silent',                 // refined: subcommands vary

  restore: 'destructive',           // overwrites the live registry DB from a snapshot

  // unmapped fallback handlers
  message: 'approval',
};

/**
 * Tier overrides keyed by `"<command> <subcommand>"`. Looked up FIRST by
 * resolveTier() before falling back to TIER_REGISTRY[command].
 *
 * Two-token keys only. If the second positional arg disambiguates the tier,
 * it goes here. Three-token keys (e.g. distinguishing `agent inbox clear`
 * from `agent inbox list`) use the special longer-key form and are matched
 * by best-effort prefix.
 */
export const SUBCOMMAND_TIERS: Record<string, Tier> = {
  // account: login/pair mint a device token, logout drops it (notify); the
  // read-only introspection subcommands are silent.
  'account status': 'silent',
  'account whoami': 'silent',
  'account token': 'silent',
  // embed: local reads/embeddings are silent; prefetch performs a one-time
  // ~27 MB network download into the shared cache
  'embed': 'silent',                // default subcommand = status
  'embed status': 'silent',
  'embed text': 'silent',
  'embed stdin': 'silent',
  'embed prefetch': 'notify',

  // skill-graft: query/reference are read-only; warm refreshes the shared local
  // skill index and may call the configured graft backend when enabled.
  'skill-graft': 'silent',         // default subcommand = query
  'skill-graft query': 'silent',
  'skill-graft reference': 'silent',
  'skill-graft warm': 'notify',
  'skillgraft': 'silent',
  'skillgraft query': 'silent',
  'skillgraft reference': 'silent',
  'skillgraft warm': 'notify',

  // booty: default/list/help are read-only; add writes artifact bytes into the
  // blob store plus a provenance row (slice S4a).
  'booty': 'silent',                // default subcommand = list
  'booty list': 'silent',
  'booty help': 'silent',
  'booty add': 'notify',

  // Tender's operator suggestion queue. Reading and clearing are cheap; only
  // `approve` actually fires a ship run, so only it keeps the group's tier.
  'suggest': 'silent',              // default subcommand = list
  'suggest list': 'silent',
  'suggest help': 'silent',
  'suggest dismiss': 'notify',
  'suggest approve': 'approval',

  // Skill registry. The read verbs mutate nothing (`outcomes` GETs
  // /fleet/skills/outcomes from the daemon; the rest read the local catalog),
  // while `sync` and `index` rewrite the on-disk catalog under
  // ~/.port-daddy/skills.
  'seamanship': 'silent',           // default subcommand = list
  'skills': 'silent',               // default subcommand = list
  'seamanship list': 'silent',
  'seamanship search': 'silent',
  'seamanship show': 'silent',
  'seamanship outcomes': 'silent',
  'seamanship help': 'silent',
  'seamanship sync': 'notify',
  'seamanship index': 'notify',
  'skills list': 'silent',
  'skills search': 'silent',
  'skills show': 'silent',
  'skills outcomes': 'silent',
  'skills help': 'silent',
  'skills sync': 'notify',
  'skills index': 'notify',

  // salvage: list is read-only, mutations are destructive
  'salvage': 'silent',              // default subcommand = listing
  'salvage triage': 'silent',
  'salvage next': 'silent',
  'salvage claim': 'destructive',   // claims another agent's session+files
  'salvage complete': 'destructive',// finalizes an inherited session
  'salvage abandon': 'destructive', // forces session back to queue
  'salvage dismiss': 'destructive', // permanently removes from queue

  // session: most are notify; abandon can release another agent's active claims
  'session start': 'notify',
  'session end': 'notify',
  'session done': 'notify',
  'session abandon': 'destructive', // marks session abandoned — affects others reading the trail
  'session takeover': 'notify',     // creates successor, preserves predecessor notes
  'session rm': 'notify',           // archives session; notes and claim history stay append-only
  'session files': 'notify',        // add/rm of caller's own claims

  // safe: scan is read-only; baseline accept writes the committed triage file;
  // fix --auto mutates host file modes (reversible, but a host write → approval).
  'safe': 'silent',                 // default subcommand = `safe scan`
  'safe scan': 'silent',
  'safe baseline': 'silent',        // bare form is a usage hint
  'safe baseline accept': 'notify', // writes .pd-secrets-baseline.json
  'safe fix': 'approval',           // chmod of crown-jewel perms (opt-in, reversible)
  // safe corral: dry-run (default) is read-only; --apply writes the vault AND
  // rewrites a source file (reversible — a .bak is kept) → a host write → approval.
  'safe corral': 'silent',          // dry-run plan only by default
  'safe corral --apply': 'approval',// packs secret into vault + rewrites source
  'safe guard': 'silent',           // read-only scan of the staged diff

  // env exec runs an arbitrary child command (with pd-secret:// refs resolved
  // into its env). Running an arbitrary command is a notify-tier action; the
  // plain `pd env` listing stays silent via TIER_REGISTRY.
  'env exec': 'notify',

  // release: bare release of caller's own port is notify; --expired is global
  'release --expired': 'destructive',

  // unlock --force breaks another agent's lock
  'unlock --force': 'destructive',

  // ports cleanup releases stale ports across projects
  'ports cleanup': 'destructive',

  // projects rm removes a registered project
  'projects rm': 'destructive',
  'p rm': 'destructive',

  // channels clear blows away message history on a channel
  'channels clear': 'destructive',
  'channels ensure': 'notify',
  'channels describe': 'silent',
  'channels discover': 'silent',

  // dns mutations
  'dns register': 'notify',
  'dns lookup': 'silent',
  'dns list': 'silent',
  'dns cleanup': 'destructive',
  'dns status': 'silent',

  // agent subcommands
  'agent register': 'notify',
  'agent heartbeat': 'notify',
  'agent unregister': 'destructive',
  'agent inbox': 'silent',
  'agent inbox list': 'silent',
  'agent inbox stats': 'silent',
  'agent inbox send': 'approval',
  'agent inbox clear': 'destructive',
  'agent inbox read-all': 'notify',

  // durable named-agent roster: reads are silent, profile facts are notify,
  // and continuation launches a governed child runtime.
  'roster': 'silent',
  'roster list': 'silent',
  'roster ls': 'silent',
  'roster show': 'silent',
  'roster search': 'silent',
  'roster create': 'notify',
  'roster promote': 'notify',
  'roster update': 'notify',
  'roster attach': 'notify',
  'roster retire': 'notify',
  'roster continue': 'approval',

  // parley: list/show/fit are reads; call/respond/resolve mutate shared reconciliation state
  'parley list': 'silent',
  'parley show': 'silent',
  'parley fit': 'silent',
  'parley call': 'approval',
  'parley respond': 'approval',
  'parley resolve': 'approval',
  // turn verbs are respond sugar — same tier
  'parley propose': 'approval',
  'parley critique': 'approval',
  'parley revise': 'approval',
  'parley agree': 'approval',
  'parley refuse': 'approval',
  'parley say': 'approval',

  // roadmap: default/list/show are reads; upsert/touch/promote mutate the roadmap DB-of-record
  'roadmap upsert': 'notify',
  'roadmap add': 'notify',
  'roadmap touch': 'notify',
  'roadmap promote': 'notify',
  'roadmap ack': 'notify',
  'roadmap harvest': 'notify',
  'roadmap render': 'notify',
  'roadmap import': 'notify',
  'roadmap import-markdown': 'notify',

  // harbor subcommands
  'harbor create': 'notify',
  'harbor enter': 'notify',
  'harbor leave': 'notify',
  'harbor show': 'silent',
  'harbor destroy': 'destructive',
  'harbor delete': 'destructive',

  // relay subcommands
  'relay url': 'notify',     // sets relay_url — daemon config write
  'relay status': 'silent',
  'relay exchange': 'silent',

  // spawn subcommands
  'spawn kill': 'destructive',

  // sortie subcommands — `sortie run` (and bare `sortie <goal>`) stays at the
  // top-level 'approval'; the read-only forms are silent
  'sortie list': 'silent',
  'sortie status': 'silent',
  'sortie logs': 'silent',

  // fleet subcommands
  'fleet up': 'approval',
  'fleet down': 'destructive',
  'fleet status': 'silent',
  'fleet validate': 'silent',
  'fleet models': 'silent',
  'fleet init': 'notify',
  'fleet prompt': 'silent',
  'fleet panic': 'destructive',
  'fleet unpanic': 'notify',

  // squid harness toggle + readouts (the bridge itself stays approval-tier)
  'squid status': 'silent',         // read-only non-diegetic readout
  'squid tap': 'silent',            // read-only envelope preview
  'squid voice': 'silent',          // read-only VoiceLog readout (spoke/silent/suppressed)
  'squid on': 'notify',             // writes project hook/statusline config
  'squid arm': 'notify',
  'squid off': 'notify',            // removes only pd-authored entries
  'squid disarm': 'notify',

  // agent-CLI hooks installer
  'hooks list': 'silent',

  // guard subcommands
  'guard status': 'silent',
  'guard check': 'silent',
  'guard enable': 'destructive',    // changes enforcement mode for everyone
  'guard on': 'destructive',
  'guard disable': 'destructive',
  'guard off': 'destructive',
  'guard install': 'destructive',   // writes git hooks
  'guard install-shim': 'destructive',
  'guard shim-install': 'destructive',
  'guard uninstall-shim': 'destructive',
  'guard shim-uninstall': 'destructive',
  'guard help': 'silent',

  // dev (berths) subcommands (ADR-0084). up = build+launch a berth (notify);
  // down = stop a berth (destructive); list = read-only.
  'dev up': 'notify',
  'dev down': 'destructive',
  'dev list': 'silent',
  // back-compat aliases for the legacy verbs
  'dev start': 'notify',
  'dev stop': 'destructive',
  'dev status': 'silent',

  // daemon subcommands
  'daemon list': 'silent',
  'daemon status': 'silent',
  'daemon install': 'notify',
  'daemon uninstall': 'destructive',
  'daemon stop': 'destructive',
  'daemon start': 'notify',
  'daemon restart': 'destructive',

  // feedback writes
  'feedback list': 'silent',
  'feedback show': 'silent',
  'feedback summary': 'silent',
  'feedback harvest': 'notify',

  // mcp
  'mcp install': 'notify',

  // batten: verify is pure read; imprint writes the caller-selected receipt.
  'batten verify': 'silent',
  'batten imprint': 'notify',

  // attention: default fetch marks items read; peek/list forms are read-only
  'attention --peek': 'silent',
  'attention --subscriptions': 'silent',
  'attention --subscribe': 'notify',
  'attention --unsubscribe': 'notify',

  // nudge: bare form lists (silent); scan delivers inbox messages, accept/decline mutate state
  'nudge scan': 'notify',
  'nudge accept': 'notify',
  'nudge decline': 'notify',

  // session files claim/rm are caller-scoped
  'session files add': 'notify',
  'session files claim': 'notify',
  'session files rm': 'notify',
  'session files release': 'notify',

  // secret: list/reveal are read-only, set writes a credential, rm deletes it
  'secret list': 'silent',
  'secret ls': 'silent',
  'secret reveal': 'silent',
  'secret show': 'silent',
  'secret set': 'notify',
  'secret rm': 'destructive',
  'secret remove': 'destructive',
  'secret delete': 'destructive',

  // popper: status/next are read-only/dry-run, pop fires a dispatch,
  // enable/disable toggle a roadmap item's nightshift eligibility
  'popper status': 'silent',
  'popper next': 'silent',
  'popper pop': 'approval',          // pops an item and spawns a dispatch
  'popper enable': 'notify',
  'popper disable': 'notify',

  // commit: bare form records a commitment, close finalizes one
  'commit close': 'notify',

  // transcripts: list/show/cost/watch are read-only; delete/rm removes a run record
  'transcripts list': 'silent',
  'transcripts show': 'silent',
  'transcripts cost': 'silent',
  'transcripts watch': 'silent',
  'transcripts delete': 'destructive',
  'transcripts rm': 'destructive',
  'transcript delete': 'destructive',
  'transcript rm': 'destructive',

  // harbor-ledger: status is read-only; project/rebuild rewrite disposable
  // projections from the append-only ledger (no event data can be lost)
  'harbor-ledger status': 'silent',
  'harbor-ledger project': 'notify',
  'harbor-ledger rebuild': 'notify',

  // harbormaster: status/queue are read-only; start/stop control the shared actor
  'harbormaster status': 'silent',
  'harbormaster queue': 'silent',
  'harbormaster start': 'approval',
  'harbormaster stop': 'destructive',  // stops the merge-owning actor for everyone
  'hm status': 'silent',
  'hm queue': 'silent',
  'hm start': 'approval',
  'hm stop': 'destructive',

  // backend: status/list are read-only; clear/off reset caller config
  'backend status': 'silent',
  'backend list': 'silent',
  'backend adapters': 'silent',
  'backend capabilities': 'silent',
  'backend clear': 'notify',
  'backend off': 'notify',

  // backup: run writes a snapshot; schedule install/uninstall toggle the timer
  'backup run': 'notify',
  'backup schedule': 'notify',

  // benchmark: `run` makes paid LLM calls (notify); the listing/report forms are read-only
  'benchmark list-models': 'silent',
  'benchmark list-conditions': 'silent',
  'benchmark models': 'silent',
  'benchmark conditions': 'silent',
  'benchmark report': 'silent',

  // dispatch: status/list are read-only; cancel/reject affect queued work
  'dispatch status': 'silent',
  'dispatch list': 'silent',
  'dispatch cancel': 'destructive',
  'dispatch reject': 'approval',
  'dispatch accept': 'approval',

  // review: list/show read-only; accept/reject gate others' produced work
  'review list': 'silent',
  'review show': 'silent',
  'review accept': 'approval',
  'review reject': 'approval',
};

/**
 * Resolve the tier for a concrete invocation.
 *
 * @param command   Top-level verb (e.g. "salvage", "release")
 * @param argv      Positional args AFTER the command (e.g. ["claim", "agent-99"])
 *                  Pass [] for bare verbs. Pass options-as-flags strings like
 *                  "--expired" if the flag changes the tier (rare).
 *
 * Resolution order:
 *   1. Three-token key:  "<command> <argv0> <argv1>"   (e.g. "agent inbox clear")
 *   2. Two-token key:    "<command> <argv0>"           (e.g. "salvage claim")
 *   3. Flag-suffix key:  "<command> --<flag>"          (e.g. "release --expired")
 *   4. Bare command:     TIER_REGISTRY[command]
 *   5. Fallback:         "silent" (so unmapped lookups don't accidentally
 *                        gate a read with a confirmation prompt)
 */
export function resolveTier(
  command: string,
  argv: readonly string[] = [],
  flags: readonly string[] = []
): Tier {
  // 1. Three-token key
  if (argv.length >= 2) {
    const k3 = `${command} ${argv[0]} ${argv[1]}`;
    if (SUBCOMMAND_TIERS[k3]) return SUBCOMMAND_TIERS[k3];
  }

  // 2. Two-token key
  if (argv.length >= 1) {
    const k2 = `${command} ${argv[0]}`;
    if (SUBCOMMAND_TIERS[k2]) return SUBCOMMAND_TIERS[k2];
  }

  // 3. Flag-suffix key (only for the small set of flags that change tier)
  for (const f of flags) {
    const norm = f.startsWith('--') ? f : `--${f}`;
    const kf = `${command} ${norm}`;
    if (SUBCOMMAND_TIERS[kf]) return SUBCOMMAND_TIERS[kf];
  }

  // 4. Bare-command override in SUBCOMMAND_TIERS — used when the top-level
  //    verb's "no subcommand" form is safer than the worst-case TIER_REGISTRY
  //    entry. Notably: `pd salvage` with no args is silent (list), but the
  //    `salvage <claim|dismiss|...>` family is destructive.
  if (argv.length === 0 && SUBCOMMAND_TIERS[command]) {
    return SUBCOMMAND_TIERS[command];
  }

  // 5. Bare command
  if (TIER_REGISTRY[command]) return TIER_REGISTRY[command];

  // 6. Fallback
  return 'silent';
}

/**
 * All commands grouped by tier. Useful for `pd help` rendering, README
 * generation, and tests that need to assert "every destructive command is
 * wired through requireConfirmation".
 */
export function commandsByTier(): Record<Tier, string[]> {
  const out: Record<Tier, string[]> = {
    silent: [],
    notify: [],
    approval: [],
    destructive: [],
  };

  for (const [cmd, tier] of Object.entries(TIER_REGISTRY)) {
    out[tier].push(cmd);
  }
  for (const [key, tier] of Object.entries(SUBCOMMAND_TIERS)) {
    out[tier].push(key);
  }

  for (const tier of ALL_TIERS) {
    out[tier].sort();
  }
  return out;
}

/**
 * Short single-word label rendered in --help next to a command's description.
 * Format: `[silent]`, `[notify]`, `[approval]`, `[destructive]`.
 */
export function tierBadge(tier: Tier): string {
  return `[${tier}]`;
}

/**
 * The canonical, user-facing list of commands that REQUIRE
 * requireConfirmation() to be invoked before any side effect. Tests use this
 * to verify the helper is actually wired into each command's handler.
 */
export const DESTRUCTIVE_COMMANDS: readonly string[] = Object.freeze([
  'salvage claim',
  'salvage complete',
  'salvage abandon',
  'salvage dismiss',
  'session abandon',
  'release --expired',
  'unlock --force',
  'ports cleanup',
  'projects rm',
  'channels clear',
  'dns cleanup',
  'agent unregister',
  'agent inbox clear',
  'harbor destroy',
  'spawn kill',
  'fleet down',
  'fleet panic',
  'guard install',
  'guard install-shim',
  'guard uninstall-shim',
  'guard enable',
  'guard disable',
  'dev stop',
  'daemon stop',
  'daemon restart',
  'daemon uninstall',
  'restart',
  'stop',
  'uninstall',
  'down',
]);

/**
 * Short, one-line legend for the four tiers. Embedded in `pd help` output.
 */
export const TIER_LEGEND = [
  '  [silent]      Read-only. Safe to run anywhere.',
  '  [notify]      Mutates your own state. Reversible.',
  '  [approval]    Affects other agents. No data loss.',
  '  [destructive] Releases someone else\'s resources or removes records. Prompts for confirmation; pass --yes to skip.',
].join('\n');
