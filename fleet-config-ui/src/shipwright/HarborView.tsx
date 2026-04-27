import { AgentCardThumbnail } from '../ships';
import type { ProjectSurvey, ShipwrightDataResult } from './types';
import { shipIdentityForSurvey } from './helpers';
import { HardCard, SourceBadge } from './primitives';

/**
 * HarborView - all-project Shipwright survey grid.
 *
 * WHY IT EXISTS: Shipwright's first route is the harbor, not a per-project
 * dashboard. Operators need a scannable map of project heat before deciding
 * where to focus. The cards follow the component brief: hard shadow, zero
 * radius, left ship glyph, uppercase meta, and a small status dot.
 *
 * @example
 *   <HarborView surveys={surveyResult} onFocusProject={() => undefined} />
 */
export function HarborView({
  surveys,
  onFocusProject,
}: {
  surveys: ShipwrightDataResult<ProjectSurvey[]>;
  onFocusProject: (survey: ProjectSurvey) => void;
}) {
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.16em] opacity-45">HARBOR</div>
          <h2 className="mt-1 text-xl font-semibold">Surveyed projects</h2>
        </div>
        <SourceBadge result={surveys} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {surveys.data.map((survey) => (
          <button
            className="block text-left"
            key={survey.root}
            onClick={() => onFocusProject(survey)}
            type="button"
          >
            <HardCard className="min-h-[168px] transition-transform hover:translate-x-[2px] hover:translate-y-[2px]">
              <div className="grid gap-4 md:grid-cols-[8rem_minmax(0,1fr)]">
                <div className="min-w-0">
                  <AgentCardThumbnail
                    ariaLabel={`${survey.project} ship glyph`}
                    identities={[shipIdentityForSurvey(survey)]}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 shrink-0"
                      style={{ backgroundColor: survey.status.hasFleet ? 'var(--pd-success)' : 'var(--pd-warning)' }}
                    />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--pd-muted)' }}>
                      {survey.classification.kind} / {survey.status.activity}
                    </span>
                  </div>
                </div>
                <div className="min-w-0">
                  <h3
                    className="truncate text-[22px] leading-tight"
                    style={{ fontFamily: "'Radnika', var(--pd-font-ui)", fontWeight: 900 }}
                  >
                    {survey.project}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed opacity-75">{survey.intent}</p>
                  <div
                    className="mt-4 grid grid-cols-3 border-t-2 pt-2 font-mono text-[11px]"
                    style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-muted)' }}
                  >
                    <span>{survey.status.commitsLast30d} commits</span>
                    <span>{survey.status.fleetSizeAgents} agents</span>
                    <span>{Math.round(survey.confidence * 100)}% conf</span>
                  </div>
                </div>
              </div>
            </HardCard>
          </button>
        ))}
      </div>
    </section>
  );
}
