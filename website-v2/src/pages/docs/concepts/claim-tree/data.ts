/**
 * Shared demo dataset for the claim-tree visualizations.
 * Every viz on the page renders this same state so the reader can compare
 * how each mode reveals different things about the same situation.
 *
 * Three sessions are active. The tree mixes filesystem + AST granularity.
 */

export const SESSIONS = [
  {
    id: 'session-12abc',
    short: '12abc',
    agent: 'gardener',
    identity: 'port-daddy:cartographer',
    intent: 'Refactor token signing to RS256',
    color: 'oklch(0.62 0.18 282)',       // indigo / violet
    colorMuted: 'oklch(0.62 0.18 282 / 0.30)',
    startedAt: -28 * 60_000,             // 28 min ago, relative to "now"
  },
  {
    id: 'session-56def',
    short: '56def',
    agent: 'you',
    identity: 'port-daddy:auth-refresh',
    intent: 'Add refreshToken method + tests',
    color: 'oklch(0.66 0.20 35)',        // warm orange
    colorMuted: 'oklch(0.66 0.20 35 / 0.30)',
    startedAt: -18 * 60_000,
  },
  {
    id: 'session-78ghi',
    short: '78ghi',
    agent: 'qa',
    identity: 'port-daddy:auth-tests',
    intent: 'Add tests for token expiry + refresh',
    color: 'oklch(0.62 0.13 160)',       // teal-green
    colorMuted: 'oklch(0.62 0.13 160 / 0.30)',
    startedAt: -12 * 60_000,
  },
] as const

export type Session = (typeof SESSIONS)[number]
export type SessionId = Session['id']

/**
 * Hierarchical claim-tree state. Each node has:
 *  - name: display name in the parent's namespace
 *  - kind: NodeKind from ADR-0038
 *  - loc:  size proxy for treemap area / sunburst angle
 *  - claim: optional active claim record
 *  - children: descendants (for the tree layout)
 */
export type NodeKind = 'repo' | 'dir' | 'file' | 'symbol' | 'block' | 'fenced' | 'region'

export interface ClaimRecord {
  session: SessionId
  mode: 'S' | 'X' | 'IS' | 'IX' | 'SIX'
  intent: string
  startedAt: number              // ms relative to now (negative = past)
  endedAt?: number               // active claims have no endedAt
}

export interface ClaimNode {
  id: string
  name: string
  kind: NodeKind
  loc: number                    // size proxy (≥1 for leaves; sum of children otherwise)
  symbol?: string                // for symbol kind
  claim?: ClaimRecord
  /** Push-down implied claims at this node — derived from descendants. */
  implied?: ClaimRecord[]
  children?: ClaimNode[]
}

const c = (session: SessionId, mode: ClaimRecord['mode'], intent: string, age_min: number): ClaimRecord => ({
  session,
  mode,
  intent,
  startedAt: -age_min * 60_000,
})

export const TREE: ClaimNode = {
  id: 'repo:port-daddy',
  name: 'port-daddy',
  kind: 'repo',
  loc: 0,
  children: [
    {
      id: 'dir:lib',
      name: 'lib',
      kind: 'dir',
      loc: 0,
      children: [
        {
          id: 'file:lib/auth.ts',
          name: 'auth.ts',
          kind: 'file',
          loc: 380,
          children: [
            {
              id: 'symbol:lib/auth.ts:AuthService.signToken',
              name: 'signToken',
              kind: 'symbol',
              symbol: 'AuthService.signToken',
              loc: 80,
              claim: c('session-12abc', 'X', 'Refactor signing to RS256', 28),
            },
            {
              id: 'symbol:lib/auth.ts:AuthService.refreshToken',
              name: 'refreshToken',
              kind: 'symbol',
              symbol: 'AuthService.refreshToken',
              loc: 60,
              claim: c('session-56def', 'X', 'New refresh implementation', 18),
            },
            {
              id: 'symbol:lib/auth.ts:AuthService.validateToken',
              name: 'validateToken',
              kind: 'symbol',
              symbol: 'AuthService.validateToken',
              loc: 50,
            },
            {
              id: 'symbol:lib/auth.ts:hashPepper',
              name: 'hashPepper',
              kind: 'symbol',
              symbol: 'hashPepper',
              loc: 24,
            },
            {
              id: 'symbol:lib/auth.ts:MAX_AGE',
              name: 'MAX_AGE',
              kind: 'symbol',
              symbol: 'MAX_AGE',
              loc: 4,
            },
          ],
        },
        {
          id: 'file:lib/tuples.ts',
          name: 'tuples.ts',
          kind: 'file',
          loc: 220,
          claim: c('session-12abc', 'S', 'Reading tuple write paths', 22),
        },
        { id: 'file:lib/pheromone.ts', name: 'pheromone.ts', kind: 'file', loc: 180 },
        { id: 'file:lib/helpers.ts', name: 'helpers.ts', kind: 'file', loc: 90 },
      ],
    },
    {
      id: 'dir:routes',
      name: 'routes',
      kind: 'dir',
      loc: 0,
      children: [
        { id: 'file:routes/api.ts', name: 'api.ts', kind: 'file', loc: 140 },
        { id: 'file:routes/whois.ts', name: 'whois.ts', kind: 'file', loc: 90 },
        { id: 'file:routes/home.ts', name: 'home.ts', kind: 'file', loc: 60 },
      ],
    },
    {
      id: 'dir:tests',
      name: 'tests',
      kind: 'dir',
      loc: 0,
      children: [
        {
          id: 'dir:tests/unit',
          name: 'unit',
          kind: 'dir',
          loc: 0,
          children: [
            {
              id: 'dir:tests/unit/auth',
              name: 'auth',
              kind: 'dir',
              loc: 0,
              children: [
                {
                  id: 'file:tests/unit/auth/signToken.test.ts',
                  name: 'signToken.test.ts',
                  kind: 'file',
                  loc: 120,
                  claim: c('session-78ghi', 'X', 'Sign test coverage', 12),
                },
                {
                  id: 'file:tests/unit/auth/refreshToken.test.ts',
                  name: 'refreshToken.test.ts',
                  kind: 'file',
                  loc: 110,
                  claim: c('session-78ghi', 'X', 'Refresh test coverage', 9),
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

/** Roll up `loc` so parent nodes have non-zero size for layout. */
function rollupLoc(node: ClaimNode): number {
  if (!node.children || node.children.length === 0) return node.loc
  const total = node.children.reduce((acc, c) => acc + rollupLoc(c), 0)
  node.loc = total
  return total
}
rollupLoc(TREE)

/** Import graph for the force-directed view. */
export const IMPORTS: Array<{ from: string; to: string }> = [
  { from: 'symbol:lib/auth.ts:AuthService.signToken',        to: 'symbol:lib/auth.ts:hashPepper' },
  { from: 'symbol:lib/auth.ts:AuthService.refreshToken',     to: 'symbol:lib/auth.ts:hashPepper' },
  { from: 'symbol:lib/auth.ts:AuthService.signToken',        to: 'symbol:lib/auth.ts:MAX_AGE' },
  { from: 'file:tests/unit/auth/signToken.test.ts',          to: 'symbol:lib/auth.ts:AuthService.signToken' },
  { from: 'file:tests/unit/auth/refreshToken.test.ts',       to: 'symbol:lib/auth.ts:AuthService.refreshToken' },
  { from: 'file:routes/api.ts',                              to: 'file:lib/auth.ts' },
  { from: 'file:lib/auth.ts',                                to: 'file:lib/helpers.ts' },
]

/** Gantt: time spans for each session's claims, in ms relative to NOW (0). */
export const GANTT_SPANS: Array<{ session: SessionId; nodeId: string; label: string; start: number; end: number }> = [
  // gardener
  { session: 'session-12abc', nodeId: 'symbol:lib/auth.ts:AuthService.signToken', label: 'signToken (X)', start: -28 * 60_000, end: 0 },
  { session: 'session-12abc', nodeId: 'file:lib/tuples.ts', label: 'tuples.ts (S)', start: -22 * 60_000, end: 0 },
  // you
  { session: 'session-56def', nodeId: 'symbol:lib/auth.ts:AuthService.refreshToken', label: 'refreshToken (X)', start: -18 * 60_000, end: 0 },
  // qa
  { session: 'session-78ghi', nodeId: 'file:tests/unit/auth/signToken.test.ts', label: 'signToken.test (X)', start: -12 * 60_000, end: 0 },
  { session: 'session-78ghi', nodeId: 'file:tests/unit/auth/refreshToken.test.ts', label: 'refreshToken.test (X)', start: -9 * 60_000, end: 0 },
]

/** Calendar: 28 days of synthetic activity counts. */
export function generateCalendar() {
  const days: Array<{ date: Date; count: number }> = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const dow = d.getDay()
    const weekend = dow === 0 || dow === 6
    const base = weekend ? 0 : 4 + Math.round(Math.sin(i / 3) * 4 + ((i * 13) % 5))
    days.push({ date: d, count: Math.max(0, base) })
  }
  // spike today
  days[days.length - 1].count = 18
  return days
}

/** Streamgraph: claims-by-granularity over the last 8 hours, in ms-from-now buckets. */
export const STREAM_LAYERS = [
  { key: 'repo',         label: 'repo',         color: 'oklch(0.78 0.04 250 / 0.7)' },
  { key: 'dir',          label: 'dir',          color: 'oklch(0.75 0.07 280 / 0.85)' },
  { key: 'file',         label: 'file',         color: 'oklch(0.66 0.18 282 / 0.85)' },
  { key: 'symbol',       label: 'symbol',       color: 'oklch(0.66 0.20 35 / 0.85)' },
  { key: 'block_region', label: 'block/region', color: 'oklch(0.62 0.13 160 / 0.85)' },
] as const

export const STREAM_TIME_BUCKETS = (() => {
  // 8 buckets of one hour each, indexed -7h .. NOW
  const buckets = []
  for (let i = 7; i >= 0; i--) {
    const t = -i * 60 * 60_000
    const phase = (7 - i) / 7
    buckets.push({
      t,
      repo: 1,
      dir: 2 + Math.round(phase * 2),
      file: Math.round(3 + Math.sin(phase * Math.PI) * 4 + phase * 2),
      symbol: Math.round(phase * 9),
      block_region: Math.round(phase * 4),
    })
  }
  return buckets
})()

/** Sankey: lifecycle flow values. */
export const SANKEY_FLOWS = [
  { source: 'pd add',           target: 'pd done',             value: 48 },
  { source: 'pd add',           target: 'reverted',            value: 8 },
  { source: 'pd add',           target: 'pruned under contest', value: 6 },
  { source: 'pd feature',       target: 'pd done',             value: 20 },
  { source: 'pd feature',       target: 'reverted',            value: 3 },
  { source: 'pd feature',       target: 'pruned under contest', value: 1 },
  { source: 'auto-escalation',  target: 'pd done',             value: 10 },
  { source: 'auto-escalation',  target: 'pruned under contest', value: 4 },
]

/** Chord (replaces the topo contour): which files co-occur in the same session. */
export const CO_CLAIM_PAIRS: Array<{ a: string; b: string; weight: number }> = [
  { a: 'auth.ts',         b: 'tuples.ts',     weight: 5 },
  { a: 'auth.ts',         b: 'helpers.ts',    weight: 4 },
  { a: 'auth.ts',         b: 'api.ts',        weight: 3 },
  { a: 'signToken.test',  b: 'refreshToken.test', weight: 6 },
  { a: 'signToken.test',  b: 'auth.ts',       weight: 4 },
  { a: 'refreshToken.test', b: 'auth.ts',     weight: 4 },
  { a: 'tuples.ts',       b: 'pheromone.ts',  weight: 2 },
  { a: 'whois.ts',        b: 'auth.ts',       weight: 2 },
]
