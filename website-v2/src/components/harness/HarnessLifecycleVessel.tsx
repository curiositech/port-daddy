import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Anchor, BookOpenCheck, GitPullRequestArrow, RadioTower } from 'lucide-react'
import './harness-lifecycle-vessel.css'

export type HarnessLifecycleStage = {
  id: string
  station: string
  hook: string
  moment: string
  gift: string
  receipt: string
  boundary: string
  x: number
  y: number
}

export const HARNESS_LIFECYCLE_STAGES: readonly HarnessLifecycleStage[] = [
  {
    id: 'wake',
    station: 'Forward observatory',
    hook: 'SessionStart',
    moment: 'The agent wakes without trusting its own memory.',
    gift: 'Last plan, unfinished claims, salvage candidates, and one cited resume point.',
    receipt: 'Briefing cursor + plan revision',
    boundary: 'Reads durable truth. It does not invent a summary from an old transcript.',
    x: 13,
    y: 43,
  },
  {
    id: 'attention',
    station: 'Signal room',
    hook: 'UserPromptSubmit',
    moment: 'A new turn begins while the repo keeps moving around the agent.',
    gift: 'Bounded inbox and Parley counts, fresh steering, and only the coordination facts worth spending context on.',
    receipt: 'Attention cursor',
    boundary: 'Counts and next actions only. Message bodies stay out of the automatic envelope.',
    x: 25,
    y: 39,
  },
  {
    id: 'guard',
    station: 'Claim lock',
    hook: 'PreToolUse',
    moment: 'The agent reaches for a file, command, or capability with real blast radius.',
    gift: 'Ownership, lock, budget, and safer-action evidence before side effects.',
    receipt: 'Allow / warn / refuse decision',
    boundary: 'The hook enforces a narrow gate; it does not become an autonomous planner.',
    x: 37,
    y: 45,
  },
  {
    id: 'trace',
    station: 'Engine telegraph',
    hook: 'PostToolUse',
    moment: 'A tool changed the world and the rest of the fleet needs the useful residue.',
    gift: 'A compact trace plus relevant roadmap, document, and AST suggestions with provenance.',
    receipt: 'Tool trace + suggestion packet',
    boundary: 'Publishes facts and candidates, never private transcript content by default.',
    x: 49,
    y: 39,
  },
  {
    id: 'news',
    station: 'Wireless office',
    hook: 'Notification',
    moment: 'A nearby PR opened, merged, or crossed into the agent’s Parley radius.',
    gift: 'A repo digest explaining what changed, why it matters here, and whether a comment is invited.',
    receipt: 'Repository event cursor',
    boundary: 'Batches routine news. Only materially relevant events interrupt the turn.',
    x: 61,
    y: 45,
  },
  {
    id: 'children',
    station: 'Launch bay',
    hook: 'SubagentStop',
    moment: 'A child agent returns with findings, failures, and possibly a different map.',
    gift: 'Result, evidence, rejected assumptions, touched artifacts, and parent-facing next action.',
    receipt: 'Child work receipt',
    boundary: 'Harvests the child; it does not paste the child’s entire context into the parent.',
    x: 73,
    y: 39,
  },
  {
    id: 'pressure',
    station: 'Ballast control',
    hook: 'PreCompact',
    moment: 'Context pressure rises high enough that continuing as one mind becomes reckless.',
    gift: 'A compelled plan checkpoint, cited context envelope, and context-clustered successor proposal.',
    receipt: 'Compaction packet + successor edges',
    boundary: 'Preserves decisions and uncertainty. It does not pretend a lossy summary is full replay.',
    x: 85,
    y: 45,
  },
  {
    id: 'harvest',
    station: 'Aft recovery deck',
    hook: 'Stop / SessionEnd',
    moment: 'The body stops, but the work must remain legible and resumable.',
    gift: 'Plan, transcript, diff, tests, costs, Parley settlement, unresolved work, and salvage eligibility.',
    receipt: 'Signed run and handoff receipt',
    boundary: 'A terminal harvest is durable evidence, not a green “done” badge inferred from silence.',
    x: 94,
    y: 53,
  },
] as const

function activateWithKeyboard(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  activate: (index: number) => void,
) {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    activate((index + 1) % HARNESS_LIFECYCLE_STAGES.length)
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    activate((index - 1 + HARNESS_LIFECYCLE_STAGES.length) % HARNESS_LIFECYCLE_STAGES.length)
  }
}

export function HarnessLifecycleVessel() {
  const [activeIndex, setActiveIndex] = useState(0)
  const titleId = useId()
  const detailId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const active = HARNESS_LIFECYCLE_STAGES[activeIndex]

  const activateTab = (index: number) => {
    setActiveIndex(index)
    tabRefs.current[index]?.focus()
  }

  return (
    <section className="hlv" aria-labelledby={titleId}>
      <header className="hlv__masthead">
        <div>
          <p className="hlv__eyebrow">Giant Squid · lifecycle cutaway</p>
          <h2 id={titleId}>The agent is the vessel. The harness keeps it from sailing blind.</h2>
        </div>
        <p className="hlv__lede">
          Move through the ship from first wake to final receipt. Every lit station is a real hook moment,
          a bounded gift of context, and an inspectable piece of evidence.
        </p>
      </header>

      <div className="hlv__chart" aria-describedby={detailId}>
        <svg className="hlv__ocean" viewBox="0 0 1200 620" role="img" aria-label="Cutaway research vessel held by a giant squid, with eight lifecycle stations from SessionStart through SessionEnd">
          <defs>
            <linearGradient id="hlv-hull" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="hlv__hull-stop--top" />
              <stop offset="1" className="hlv__hull-stop--bottom" />
            </linearGradient>
            <filter id="hlv-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <g className="hlv__depth-lines" aria-hidden="true">
            <path d="M0 92 H1200" />
            <path d="M0 174 H1200" />
            <path d="M0 256 H1200" />
            <path d="M0 338 H1200" />
            <path d="M0 420 H1200" />
            <path d="M0 502 H1200" />
            <path d="M120 0 V620" />
            <path d="M360 0 V620" />
            <path d="M600 0 V620" />
            <path d="M840 0 V620" />
            <path d="M1080 0 V620" />
          </g>

          <g className="hlv__squid" aria-hidden="true">
            <ellipse cx="625" cy="540" rx="132" ry="64" />
            <path d="M555 517 C430 520 390 470 315 438 C245 408 190 445 124 510" />
            <path d="M570 528 C455 575 374 564 280 520 C202 484 128 516 55 584" />
            <path d="M598 532 C520 445 462 423 390 415 C305 404 250 348 220 285" />
            <path d="M644 530 C724 451 790 428 860 438 C950 451 1010 406 1055 330" />
            <path d="M670 540 C780 585 860 562 934 515 C1010 467 1080 491 1166 566" />
            <path d="M688 520 C792 519 876 487 934 432 C1002 366 1065 360 1160 392" />
            <circle cx="584" cy="532" r="11" />
            <circle cx="666" cy="532" r="11" />
          </g>

          <g className="hlv__vessel" aria-hidden="true">
            <path className="hlv__keel-shadow" d="M78 300 C176 420 320 458 610 467 C873 475 1031 426 1129 321 C1038 506 861 548 603 540 C329 532 163 477 78 300 Z" />
            <path className="hlv__hull" fill="url(#hlv-hull)" d="M70 276 C122 251 180 239 244 236 H1038 L1148 288 C1090 402 917 459 620 459 C328 459 151 402 70 276 Z" />
            <path className="hlv__deck" d="M176 234 H997 L956 180 H730 L691 126 H522 L483 180 H248 Z" />
            <path className="hlv__bridge" d="M520 178 V128 H688 V178" />
            <path className="hlv__mast" d="M608 126 V58 M573 83 H642 M608 58 L630 78" />
            <path className="hlv__waterline" d="M84 300 C331 322 854 323 1134 300" />
            {HARNESS_LIFECYCLE_STAGES.map((stage, index) => (
              <g key={stage.id} className={`hlv__station-shape ${activeIndex === index ? 'is-active' : ''}`}>
                <rect x={122 + index * 124} y={278 + (index % 2) * 20} width="104" height="96" />
                <path d={`M${174 + index * 124} ${278 + (index % 2) * 20} V${374 + (index % 2) * 20}`} />
                <circle cx={174 + index * 124} cy={326 + (index % 2) * 20} r="22" />
              </g>
            ))}
          </g>

          <g className="hlv__active-tentacle" aria-hidden="true" filter="url(#hlv-glow)">
            <path d={`M625 525 C${active.x * 12} 505 ${active.x * 12} 430 ${active.x * 12} ${active.y * 6.2}`} />
          </g>
        </svg>

        <div className="hlv__hotspots" role="tablist" aria-label="Agent lifecycle stations">
          {HARNESS_LIFECYCLE_STAGES.map((stage, index) => (
            <button
              key={stage.id}
              ref={(node) => {
                tabRefs.current[index] = node
              }}
              type="button"
              role="tab"
              aria-selected={activeIndex === index}
              aria-controls={detailId}
              tabIndex={activeIndex === index ? 0 : -1}
              className={`hlv__hotspot ${activeIndex === index ? 'is-active' : ''}`}
              style={{ left: `${stage.x}%`, top: `${stage.y}%` }}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => setActiveIndex(index)}
              onKeyDown={(event) => activateWithKeyboard(event, index, activateTab)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{stage.hook}</strong>
            </button>
          ))}
        </div>

        <div id={detailId} role="tabpanel" className="hlv__detail" aria-live="polite">
          <div className="hlv__detail-index">{String(activeIndex + 1).padStart(2, '0')} / 08</div>
          <div className="hlv__detail-main">
            <p className="hlv__station">{active.station} · {active.hook}</p>
            <h3>{active.moment}</h3>
            <p>{active.gift}</p>
          </div>
          <dl className="hlv__evidence">
            <div>
              <dt><BookOpenCheck size={15} /> Durable proof</dt>
              <dd>{active.receipt}</dd>
            </div>
            <div>
              <dt><Anchor size={15} /> Honest boundary</dt>
              <dd>{active.boundary}</dd>
            </div>
          </dl>
        </div>
      </div>

      <footer className="hlv__legend">
        <span><RadioTower size={15} /> Hook senses and delivers</span>
        <span><GitPullRequestArrow size={15} /> Daemon records and routes</span>
        <span><Anchor size={15} /> Receipt survives the body</span>
      </footer>
    </section>
  )
}
