import * as React from 'react'
import { Link } from 'react-router-dom'
import { RESEARCH_PAPERS, type ResearchPaper, type ResearchTone } from '@/data/researchPapers'

/**
 * The research-library hero figure: seven wax-sealed proof plates on a
 * spine, bar length keyed to each paper's real page count (from
 * `RESEARCH_PAPERS`), terminating in a stamped seal for the sixteen R-numbers
 * the set discharges. Not decoration — every number on this figure is read
 * straight off `researchPapers.ts`, the same source the cards below render
 * from, so the picture cannot drift out of sync with the page's own claims.
 *
 * Themed entirely through `var(--token)` so it tracks light/dark with the
 * rest of the site, and reuses each paper's own `tone` so a row's seal color
 * matches that paper's card badge further down the page.
 */

const TONE_VARS: Record<ResearchTone, { fill: string; fg: string }> = {
  primary: { fill: 'var(--brand-primary)', fg: 'var(--brand-primary-foreground)' },
  health: { fill: 'var(--story-health)', fg: 'var(--story-health-foreground)' },
  rust: { fill: 'var(--story-rust)', fg: 'var(--story-rust-foreground)' },
  accent: { fill: 'var(--brand-accent)', fg: 'var(--brand-accent-foreground)' },
  violet: { fill: 'var(--story-violet)', fg: 'var(--story-violet-foreground)' },
  warm: { fill: 'var(--status-warning)', fg: 'var(--text-inverse)' },
  indigo: { fill: 'var(--story-indigo)', fg: 'var(--story-indigo-foreground)' },
}

const SPINE_X = 40
const ROW_START_Y = 66
const ROW_STEP = 54
const BAR_X = 72
const BAR_H = 18
const PAGE_UNIT = 13
const PAGE_BASE = 26
const SEAL_R = 18
const STAMP_Y = ROW_START_Y + (RESEARCH_PAPERS.length - 1) * ROW_STEP + 48
const VIEW_W = 340
const VIEW_H = STAMP_Y + 34

function ProofRow({ paper, index }: { paper: ResearchPaper; index: number }) {
  const y = ROW_START_Y + index * ROW_STEP
  const tone = TONE_VARS[paper.tone]
  const barWidth = PAGE_BASE + paper.pages * PAGE_UNIT

  return (
    <Link
      to={`#paper-${paper.number}`}
      aria-label={`Paper ${paper.number}: ${paper.title}, ${paper.pages} pages`}
      className="group focus-visible:outline-none"
    >
      <g>
        <circle
          cx={SPINE_X}
          cy={y}
          r={SEAL_R}
          fill={tone.fill}
          stroke="var(--border-strong)"
          strokeWidth={2}
          className="transition-transform duration-150 group-hover:scale-105 group-focus-visible:[stroke:var(--interactive-focus)]"
          style={{ transformOrigin: `${SPINE_X}px ${y}px` }}
        />
        <text
          x={SPINE_X}
          y={y + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={tone.fg}
          style={{ font: '900 14px var(--font-mono)' }}
        >
          {paper.number}
        </text>

        <rect
          x={BAR_X}
          y={y - BAR_H / 2}
          width={barWidth}
          height={BAR_H}
          rx={2}
          fill={tone.fill}
          fillOpacity={0.16}
          stroke={tone.fill}
          strokeWidth={1.5}
          className="transition-[fill-opacity] group-hover:[fill-opacity:0.32]"
        />
        <text
          x={BAR_X + barWidth + 10}
          y={y + 4}
          fill="var(--text-muted)"
          style={{ font: '700 12px var(--font-mono)' }}
        >
          {paper.pages}pp
        </text>
      </g>
    </Link>
  )
}

export function SevenProofsFigure() {
  const uid = React.useId()
  const titleId = `${uid}-proofs-title`
  const descId = `${uid}-proofs-desc`
  const gridId = `${uid}-proofs-grid`

  return (
    <figure className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[var(--shadow-brutal)]">
      <div className="p-[var(--space-5)]">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block w-full max-w-[22rem]"
        >
          <title id={titleId}>Seven sealed proof papers, bar length keyed to page count</title>
          <desc id={descId}>
            Seven numbered seals on a spine, one per research paper, in reading
            order. Each seal&rsquo;s bar length is proportional to that paper&rsquo;s
            page count — {RESEARCH_PAPERS.map((p) => `paper ${p.number} at ${p.pages} pages`).join(', ')}.
            The spine ends in a stamped seal marking the sixteen numbered
            results, R1 through R17, the set discharges.
          </desc>

          <defs>
            <pattern id={gridId} width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--border-default)" strokeWidth="1" opacity="0.4" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill={`url(#${gridId})`} />

          <text
            x="20"
            y="28"
            fill="var(--text-muted)"
            style={{ font: '800 11px var(--font-sans)', letterSpacing: '0.08em' }}
          >
            PAGES PER PAPER, READ IN ORDER
          </text>

          <line
            x1={SPINE_X}
            y1={ROW_START_Y - SEAL_R - 6}
            x2={SPINE_X}
            y2={STAMP_Y - SEAL_R - 4}
            stroke="var(--border-strong)"
            strokeWidth={2}
          />

          {RESEARCH_PAPERS.map((paper, index) => (
            <ProofRow key={paper.id} paper={paper} index={index} />
          ))}

          {/* The terminal seal: the spine's argument closes here — sixteen
              numbered results, stamped. */}
          <g transform={`translate(${SPINE_X}, ${STAMP_Y})`}>
            <circle r={SEAL_R + 4} fill="var(--brand-primary)" stroke="var(--border-strong)" strokeWidth={2} />
            <path
              d="M -9 0 L -2 7 L 11 -9"
              fill="none"
              stroke="var(--brand-primary-foreground)"
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          <text
            x={SPINE_X + SEAL_R + 20}
            y={STAMP_Y - 5}
            fill="var(--text-primary)"
            style={{ font: '900 14px var(--font-sans)' }}
          >
            16 results, sealed
          </text>
          <text
            x={SPINE_X + SEAL_R + 20}
            y={STAMP_Y + 13}
            fill="var(--text-muted)"
            style={{ font: '700 11px var(--font-mono)', letterSpacing: '0.04em' }}
          >
            R1–R17, one paper short
          </text>
        </svg>
      </div>

      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        Seven seals, one spine, read top to bottom — bar length is each
        paper&rsquo;s real page count. Click any seal to jump to that paper.
      </figcaption>
    </figure>
  )
}
