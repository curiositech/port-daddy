/**
 * OperatorStatePanel — full Control Center surface driven by a single
 * GET /operator/state fetch. Renders:
 *   - NeedsYouHero (priority 0 first)
 *   - Dispatch queue (awaiting_review + open)
 *   - Budget ledger (recent spend line items + cap + today total)
 *   - Actionable signals
 *   - Actors grid
 *   - Cockpit missions
 *   - Roadmap "now" items (scrollable)
 *
 * Click-to-detail: every agent/dispatch/signal row expands inline.
 * Actions appear once (in NeedsYouHero), not duplicated across nav.
 */

import { useState } from 'react';
import {
  RefreshCw, ChevronDown, ChevronUp, ShieldCheck, ShieldAlert,
  Clock, DollarSign, Users, Map, Inbox, AlertCircle, CheckCircle2,
} from 'lucide-react';
import NeedsYouHero from './NeedsYouHero';
import type {
  OperatorState, DispatchItem, CostEvent, OperatorActorRecord,
  RoadmapItem, BudgetSection,
} from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `$${value.toFixed(4)}`;
}

function formatUsdShort(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function formatTs(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatRelative(ts: number | null | undefined): string {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span style={{ color: 'var(--pd-accent)' }}>{icon}</span>
      <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--pd-dim)' }}>
        {label}
      </span>
      {typeof count === 'number' && (
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-bold"
          style={{ backgroundColor: 'var(--pd-surface-2)', color: 'var(--pd-muted)' }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

function DispatchRow({ item }: { item: DispatchItem }) {
  const [open, setOpen] = useState(false);
  const isReview = item.state === 'awaiting_review';

  return (
    <div
      className="rounded-lg"
      style={{
        backgroundColor: isReview ? 'var(--pd-accent-surface)' : 'var(--pd-surface)',
        border: `1px solid ${isReview ? 'var(--pd-accent-border)' : 'var(--pd-border)'}`,
      }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
          style={{
            backgroundColor: isReview ? 'var(--pd-accent)' : 'var(--pd-surface-2)',
            color: isReview ? 'var(--pd-bg)' : 'var(--pd-muted)',
          }}
        >
          {isReview ? 'review' : 'open'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
            {item.title}
          </div>
          {item.agentId && (
            <div className="truncate text-[12px]" style={{ color: 'var(--pd-muted)', fontFamily: 'var(--pd-font-mono)' }}>
              {item.agentId}
            </div>
          )}
        </div>
        {item.createdAt && (
          <time className="shrink-0 text-[11px]" style={{ color: 'var(--pd-dim)' }}>
            {formatTs(item.createdAt)}
          </time>
        )}
        <span className="shrink-0 opacity-50">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {open && (
        <div
          className="border-t px-4 pb-3 pt-2 text-[13px] space-y-1.5"
          style={{ borderColor: isReview ? 'var(--pd-accent-border)' : 'var(--pd-border)', color: 'var(--pd-muted)' }}
        >
          <div><span className="font-semibold" style={{ color: 'var(--pd-dim)' }}>ID:</span> {String(item.id)}</div>
          {item.project && <div><span className="font-semibold" style={{ color: 'var(--pd-dim)' }}>Project:</span> {item.project}</div>}
          {item.createdAt && <div><span className="font-semibold" style={{ color: 'var(--pd-dim)' }}>Created:</span> {new Date(item.createdAt).toLocaleString()}</div>}
          {item.meta && Object.keys(item.meta).length > 0 && (
            <pre
              className="mt-1 overflow-x-auto rounded p-2 text-[11px]"
              style={{ backgroundColor: 'var(--pd-code)', border: '1px solid var(--pd-border)', fontFamily: 'var(--pd-font-mono)' }}
            >
              {JSON.stringify(item.meta, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function EmptySection({ icon, label, message }: { icon: React.ReactNode; label: string; message: string }) {
  return (
    <section>
      <SectionHeader icon={icon} label={label} />
      <div
        className="rounded-lg px-4 py-3 text-[13px]"
        style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)', color: 'var(--pd-dim)' }}
      >
        {message}
      </div>
    </section>
  );
}

function DispatchQueuePanel({ dispatch }: { dispatch: OperatorState['dispatch'] }) {
  const reviewItems = dispatch?.reviewPending ?? [];
  const openItems = dispatch?.open ?? [];
  const total = reviewItems.length + openItems.length;
  if (total === 0) {
    return <EmptySection icon={<AlertCircle size={14} />} label="Dispatch queue" message="No dispatches in the queue." />;
  }

  return (
    <section>
      <SectionHeader icon={<AlertCircle size={14} />} label="Dispatch queue" count={total} />
      <div className="space-y-1.5">
        {reviewItems.map((item) => (
          <DispatchRow key={String(item.id)} item={item} />
        ))}
        {openItems.map((item) => (
          <DispatchRow key={String(item.id)} item={item} />
        ))}
      </div>
    </section>
  );
}

// ─── Budget ledger ────────────────────────────────────────────────────────────

function CostEventRow({ event }: { event: CostEvent }) {
  return (
    <tr>
      <td className="py-1 pr-3 text-[12px]" style={{ color: 'var(--pd-muted)', fontFamily: 'var(--pd-font-mono)' }}>
        {formatTs(event.createdAt)}
      </td>
      <td className="py-1 pr-3 max-w-[140px] truncate text-[12px]" style={{ color: 'var(--pd-text)' }}>
        {event.agentId ?? event.workScope ?? '—'}
      </td>
      <td className="py-1 pr-3 text-[12px]" style={{ color: 'var(--pd-muted)' }}>
        {event.model ?? '—'}
      </td>
      <td className="py-1 text-right text-[12px] font-semibold font-mono" style={{ color: 'var(--pd-text)' }}>
        {formatUsd(event.costUsd)}
      </td>
    </tr>
  );
}

function BudgetLedgerPanel({ budget }: { budget: BudgetSection | null | undefined }) {
  if (!budget) {
    return <EmptySection icon={<DollarSign size={14} />} label="Budget ledger" message="No spend recorded yet." />;
  }
  const { recentEvents, status, total } = budget;
  const nearCeiling = status && status.percentUsed >= 90;

  return (
    <section>
      <SectionHeader icon={<DollarSign size={14} />} label="Budget ledger" />

      {/* Totals strip */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <div
          className="rounded-lg px-3 py-2"
          style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}
        >
          <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: 'var(--pd-dim)' }}>Today</div>
          <div className="mt-1 text-base font-bold font-mono" style={{ color: nearCeiling ? 'var(--pd-accent)' : 'var(--pd-text)' }}>
            {formatUsdShort(total.spentTodayUsd)}
          </div>
        </div>

        <div
          className="rounded-lg px-3 py-2"
          style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}
        >
          <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: 'var(--pd-dim)' }}>Cap</div>
          <div className="mt-1 text-base font-bold font-mono" style={{ color: 'var(--pd-text)' }}>
            {status ? `${formatUsdShort(status.budgetUsdPerDay)}/day` : 'no cap'}
          </div>
        </div>

        <div
          className="rounded-lg px-3 py-2"
          style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}
        >
          <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: 'var(--pd-dim)' }}>Events</div>
          <div className="mt-1 text-base font-bold font-mono" style={{ color: 'var(--pd-text)' }}>
            {total.eventCount}
          </div>
        </div>
      </div>

      {/* Budget bar */}
      {status && (
        <div className="mb-3 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--pd-surface)', border: `1px solid ${nearCeiling ? 'var(--pd-accent-border)' : 'var(--pd-border)'}` }}>
          <div className="flex items-center justify-between text-[12px] mb-1.5">
            <span style={{ color: 'var(--pd-muted)' }}>
              Spent <strong style={{ color: 'var(--pd-text)' }}>{formatUsdShort(status.spentUsd)}</strong> of <strong style={{ color: 'var(--pd-text)' }}>{formatUsdShort(status.budgetUsdPerDay)}</strong>
            </span>
            <span style={{ color: nearCeiling ? 'var(--pd-accent)' : 'var(--pd-muted)' }}>
              {status.percentUsed.toFixed(1)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--pd-surface-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, status.percentUsed)}%`,
                backgroundColor: nearCeiling ? 'var(--pd-accent)' : 'var(--pd-success)',
              }}
            />
          </div>
        </div>
      )}

      {/* Line items table */}
      {recentEvents.length > 0 && (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--pd-border)' }}>
          <div
            className="px-3 py-2 text-[11px] font-bold tracking-wider uppercase"
            style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-dim)', borderBottom: '1px solid var(--pd-border)' }}
          >
            Recent spend (last {recentEvents.length})
          </div>
          <div className="overflow-x-auto px-3 py-1" style={{ backgroundColor: 'var(--pd-surface)' }}>
            <table className="w-full min-w-[360px]">
              <thead>
                <tr>
                  {['Time', 'Agent / scope', 'Model', 'Cost'].map((h) => (
                    <th key={h} className="pb-1 text-left text-[10px] font-bold tracking-wider uppercase" style={{ color: 'var(--pd-dim)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((ev) => (
                  <CostEventRow key={ev.id} event={ev} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Actors grid ──────────────────────────────────────────────────────────────

function ActorRow({ actor }: { actor: OperatorActorRecord }) {
  const [open, setOpen] = useState(false);

  const stateColor = () => {
    switch (actor.state) {
      case 'running': return 'var(--pd-success)';
      case 'idle':    return 'var(--pd-muted)';
      case 'salvaged':
      case 'historical': return 'var(--pd-dim)';
      default:        return 'var(--pd-warning)';
    }
  };

  return (
    <div
      className="rounded-lg"
      style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: stateColor() }}
          aria-label={actor.state}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
            {actor.label}
          </div>
          {actor.summary && (
            <div className="mt-0.5 truncate text-[12px]" style={{ color: 'var(--pd-muted)' }}>
              {actor.summary}
            </div>
          )}
        </div>
        <span
          className="shrink-0 text-[11px] font-semibold"
          style={{ color: stateColor() }}
        >
          {actor.state}
        </span>
        <span className="shrink-0 opacity-40">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {open && (
        <div
          className="border-t px-3 pb-3 pt-2 text-[13px] space-y-1"
          style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-muted)' }}
        >
          <div><span className="font-semibold" style={{ color: 'var(--pd-dim)' }}>ID:</span> {actor.id}</div>
          {actor.lastActivityAt && (
            <div><span className="font-semibold" style={{ color: 'var(--pd-dim)' }}>Last active:</span> {formatRelative(actor.lastActivityAt)}</div>
          )}
          {actor.summary && (
            <div><span className="font-semibold" style={{ color: 'var(--pd-dim)' }}>Summary:</span> {actor.summary}</div>
          )}
        </div>
      )}
    </div>
  );
}

function ActorsPanel({ actors, summary }: { actors: OperatorActorRecord[]; summary: Record<string, number> }) {
  const running = summary['running'] ?? 0;
  const total = actors.length;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span style={{ color: 'var(--pd-accent)' }}><Users size={14} /></span>
        <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--pd-dim)' }}>Actors</span>
        <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: 'var(--pd-surface-2)', color: 'var(--pd-muted)' }}>
          {running} running · {total} total
        </span>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {actors.map((actor) => (
          <ActorRow key={actor.id} actor={actor} />
        ))}
      </div>
    </section>
  );
}

// ─── Cockpit missions ─────────────────────────────────────────────────────────

function CockpitMissionsSection({ missions }: { missions: OperatorState['cockpitMissions'] }) {
  if (!missions?.missions?.length) {
    return <EmptySection icon={<Map size={14} />} label="Cockpit missions" message="No active missions." />;
  }

  return (
    <section>
      <SectionHeader icon={<Map size={14} />} label="Cockpit missions" count={missions.missions.length} />
      <div className="space-y-1.5">
        {missions.missions.map((mission, idx) => (
          <div
            key={String(mission.id ?? idx)}
            className="rounded-lg px-4 py-3"
            style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}
          >
            <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
              {mission.title}
            </div>
            {mission.summary && (
              <div className="mt-1 text-[13px]" style={{ color: 'var(--pd-muted)' }}>
                {mission.summary}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Roadmap ──────────────────────────────────────────────────────────────────

function RoadmapSection({ items }: { items: RoadmapItem[] }) {
  if (items.length === 0) {
    return <EmptySection icon={<Map size={14} />} label="Roadmap — now" message="Nothing at 'now' status." />;
  }

  return (
    <section>
      <SectionHeader icon={<Map size={14} />} label="Roadmap — now" count={items.length} />
      {/* Scrollable list, keyboard accessible */}
      <div
        role="list"
        className="max-h-64 overflow-y-auto space-y-1.5 pr-1"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--pd-border) transparent' }}
      >
        {items.map((item, idx) => (
          <RoadmapItemRow key={String(item.id ?? idx)} item={item} />
        ))}
      </div>
    </section>
  );
}

function RoadmapItemRow({ item }: { item: RoadmapItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      role="listitem"
      className="rounded-lg"
      style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <CheckCircle2 size={14} style={{ color: 'var(--pd-success)', flexShrink: 0 }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
            {item.title}
          </div>
          {item.phase && (
            <div className="text-[12px]" style={{ color: 'var(--pd-muted)' }}>Phase: {item.phase}</div>
          )}
        </div>
        {typeof item.priority === 'number' && (
          <span className="shrink-0 text-[11px] font-semibold" style={{ color: 'var(--pd-dim)' }}>
            #{item.priority}
          </span>
        )}
        <span className="shrink-0 opacity-40">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {open && item.description && (
        <div
          className="border-t px-4 pb-3 pt-2 text-[13px]"
          style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-muted)' }}
        >
          {item.description}
        </div>
      )}
    </div>
  );
}

// ─── Guard badge ──────────────────────────────────────────────────────────────

function GuardBadge({ guard }: { guard: OperatorState['guard'] }) {
  const available = guard.available;
  const enforcing = guard.mode === 'enforce' && guard.enabled;

  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-2"
      style={{
        backgroundColor: enforcing ? 'var(--pd-success-surface)' : 'var(--pd-warning-surface)',
        border: `1px solid ${enforcing ? 'var(--pd-success-border)' : 'var(--pd-warning-border)'}`,
      }}
    >
      {enforcing
        ? <ShieldCheck size={14} style={{ color: 'var(--pd-success)', flexShrink: 0 }} />
        : <ShieldAlert size={14} style={{ color: 'var(--pd-warning)', flexShrink: 0 }} />
      }
      <span className="text-sm font-semibold" style={{ color: enforcing ? 'var(--pd-success)' : 'var(--pd-warning)' }}>
        Guard: {!available ? 'unavailable' : enforcing ? 'enforcing' : guard.mode ?? 'off'}
      </span>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface OperatorStatePanelProps {
  operatorState: OperatorState;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  onRefresh: () => void;
}

export default function OperatorStatePanel({
  operatorState,
  loading,
  error,
  lastFetchedAt,
  onRefresh,
}: OperatorStatePanelProps) {
  const { needsYou, fleetSignal, actors, dispatch, budget, cockpitMissions, roadmap, guard } = operatorState;

  return (
    <div className="flex min-h-0 flex-col gap-5 px-4 pb-6 pt-4 lg:px-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <GuardBadge guard={guard} />
        </div>
        <div className="flex items-center gap-3">
          {lastFetchedAt && (
            <span className="text-[12px]" style={{ color: 'var(--pd-dim)' }}>
              <Clock size={11} className="inline mr-1 opacity-60" />
              {formatRelative(lastFetchedAt)}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold"
            style={{
              color: 'var(--pd-text)',
              backgroundColor: 'var(--pd-surface)',
              border: '1px solid var(--pd-border)',
              opacity: loading ? 0.6 : 1,
            }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{ backgroundColor: 'var(--pd-accent-surface)', border: '1px solid var(--pd-accent-border)', color: 'var(--pd-accent)' }}
        >
          <strong>Error loading operator state:</strong> {error}
        </div>
      )}

      {/* Needs You — hero, always first */}
      <NeedsYouHero items={needsYou} signal={fleetSignal} />

      {/* Dispatch queue — always visible (labeled empty-state when idle) */}
      <DispatchQueuePanel dispatch={dispatch} />

      {/* Budget ledger — always visible (labeled empty-state when idle) */}
      <BudgetLedgerPanel budget={budget} />

      {/* Actors */}
      {actors.actors.length > 0 && (
        <ActorsPanel actors={actors.actors} summary={actors.summary} />
      )}

      {/* Cockpit missions — always visible (labeled empty-state when idle) */}
      <CockpitMissionsSection missions={cockpitMissions} />

      {/* Roadmap now items (scrollable) — always visible (labeled empty-state when idle) */}
      <RoadmapSection items={roadmap ?? []} />

      {/* Inbox placeholder — shown when needsYou contains inbox item */}
      {needsYou.some((item) => item.code === 'inbox') && (
        <section>
          <SectionHeader icon={<Inbox size={14} />} label="Inbox" />
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)', color: 'var(--pd-muted)' }}
          >
            Run <code style={{ fontFamily: 'var(--pd-font-mono)' }}>pd inbox list</code> to review messages.
          </div>
        </section>
      )}
    </div>
  );
}
