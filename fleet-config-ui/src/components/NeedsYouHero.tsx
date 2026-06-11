/**
 * NeedsYouHero — renders the prioritized `needsYou` list from /operator/state.
 * Priority 0 items appear first (most urgent). Each item shows its action as
 * either a clickable route button or a copyable `pd` command.
 *
 * ── Force-zoom (legibility F3) ────────────────────────────────────────────────
 * An operator must not be able to acknowledge/dismiss an IRREVERSIBLE or P0
 * attention item without first EXPANDING it to read the action/command + meta.
 * Stakes-proportional friction: there is no approve-without-seeing at scale.
 *
 * The gate does NOT hide the item — it only disables the Dismiss affordance
 * until the row has been expanded at least once (the operator has SEEN the
 * action and meta). Lower-priority rows keep quick/batch dismissal: their
 * Dismiss is live without any expansion.
 */
import { useState } from 'react';
import {
  AlertTriangle, ShieldAlert, TrendingDown, Anchor, BotOff, Map, Inbox,
  ChevronDown, ChevronUp, Copy, Check, X, Lock,
} from 'lucide-react';
import type { NeedsYouItem, FleetSignal, NeedsYouCode } from '../types';
import { isForceZoomGated } from '../lib/needsYouGate';

// ─── Icon mapping ─────────────────────────────────────────────────────────────

function itemIcon(code: NeedsYouItem['code']) {
  const size = 16;
  switch (code) {
    case 'dispatch_review': return <AlertTriangle size={size} />;
    case 'guard_violation': return <ShieldAlert size={size} />;
    case 'budget_ceiling':  return <TrendingDown size={size} />;
    case 'salvage':         return <Anchor size={size} />;
    case 'stuck_agent':     return <BotOff size={size} />;
    case 'roadmap_now':     return <Map size={size} />;
    case 'inbox':           return <Inbox size={size} />;
    default:                return <AlertTriangle size={size} />;
  }
}

function urgencyStyle(priority: number): { bg: string; border: string; color: string } {
  if (priority === 0) return { bg: 'var(--pd-accent-surface)', border: 'var(--pd-accent-border)', color: 'var(--pd-accent)' };
  if (priority === 1) return { bg: 'var(--pd-warning-surface)', border: 'var(--pd-warning-border)', color: 'var(--pd-warning)' };
  if (priority === 2) return { bg: 'var(--pd-warning-surface)', border: 'var(--pd-warning-border)', color: 'var(--pd-warning)' };
  return { bg: 'var(--pd-surface)', border: 'var(--pd-border)', color: 'var(--pd-muted)' };
}

// ─── Signal badge ─────────────────────────────────────────────────────────────

function FleetSignalBadge({ signal }: { signal: FleetSignal }) {
  const healthy = signal.code === 'P';
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold"
      style={{
        backgroundColor: healthy ? 'var(--pd-success-surface)' : 'var(--pd-warning-surface)',
        border: `1px solid ${healthy ? 'var(--pd-success-border)' : 'var(--pd-warning-border)'}`,
        color: healthy ? 'var(--pd-success)' : 'var(--pd-warning)',
      }}
    >
      <span className="font-mono font-bold text-base leading-none">{signal.code}</span>
      <span className="opacity-80">{signal.meaning}</span>
    </div>
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard not available */ }
  };

  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className="flex items-center gap-1 rounded px-1.5 py-1 text-[13px] font-semibold transition-opacity hover:opacity-80"
      style={{ color: 'var(--pd-dim)', backgroundColor: 'var(--pd-surface-2)', border: '1px solid var(--pd-border)' }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

// ─── Dismiss / acknowledge affordance ─────────────────────────────────────────

/**
 * The Dismiss button. For force-zoom-gated rows it is DISABLED until the row
 * has been expanded at least once (`seen`). Honest UX: the disabled state names
 * exactly why ("Expand to review first") and points at the unlock action — it
 * never silently no-ops, and never hides the item.
 */
function DismissButton({
  gated,
  seen,
  onDismiss,
}: {
  gated: boolean;
  seen: boolean;
  onDismiss: () => void;
}) {
  const locked = gated && !seen;

  const handleClick = (e: React.MouseEvent) => {
    // Stop the row toggle from also firing.
    e.stopPropagation();
    if (locked) return;
    onDismiss();
  };

  if (locked) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled
        aria-disabled="true"
        data-dismiss-locked="true"
        title="Expand to review the action and meta before dismissing"
        className="flex shrink-0 cursor-not-allowed items-center gap-1 rounded px-2 py-1 text-[13px] font-semibold"
        style={{
          color: 'var(--pd-dim)',
          backgroundColor: 'var(--pd-surface-3)',
          border: '1px dashed var(--pd-border)',
          opacity: 0.85,
        }}
      >
        <Lock size={13} />
        <span>Expand to dismiss</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-dismiss-locked="false"
      title="Acknowledge and dismiss this item"
      className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[13px] font-semibold transition-opacity hover:opacity-80"
      style={{
        color: 'var(--pd-muted)',
        backgroundColor: 'var(--pd-surface-2)',
        border: '1px solid var(--pd-border)',
      }}
    >
      <X size={13} />
      <span>Dismiss</span>
    </button>
  );
}

// ─── Action renderer ──────────────────────────────────────────────────────────

function ActionArea({ action }: { action: string }) {
  const isPdCommand = action.startsWith('pd ') || action === 'pd';

  if (isPdCommand) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <code
          className="min-w-0 flex-1 truncate rounded px-2.5 py-1.5 text-[13px] font-semibold"
          style={{
            backgroundColor: 'var(--pd-code)',
            color: 'var(--pd-text)',
            border: '1px solid var(--pd-border)',
            fontFamily: 'var(--pd-font-mono)',
          }}
        >
          {action}
        </code>
        <CopyButton text={action} />
      </div>
    );
  }

  // It's a URL route or non-pd command; render as a link
  return (
    <div className="mt-2">
      <code
        className="block truncate rounded px-2.5 py-1.5 text-[13px] font-semibold"
        style={{
          backgroundColor: 'var(--pd-code)',
          color: 'var(--pd-text)',
          border: '1px solid var(--pd-border)',
          fontFamily: 'var(--pd-font-mono)',
        }}
      >
        {action}
      </code>
    </div>
  );
}

// ─── Single item row ──────────────────────────────────────────────────────────

function NeedsYouRow({
  item,
  expanded,
  seen,
  onToggle,
  onDismiss,
}: {
  item: NeedsYouItem;
  expanded: boolean;
  /** True once this row has been expanded at least once this session. */
  seen: boolean;
  onToggle: () => void;
  onDismiss: () => void;
}) {
  const style = urgencyStyle(item.priority);
  const icon = itemIcon(item.code);
  const gated = isForceZoomGated(item);
  const locked = gated && !seen;

  return (
    <div
      className="rounded-lg"
      data-needsyou-code={item.code}
      data-gated={gated ? 'true' : 'false'}
      style={{ backgroundColor: style.bg, border: `1px solid ${style.border}` }}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left"
          style={{ color: style.color }}
        >
          <span className="mt-0.5 shrink-0">{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-snug" style={{ color: 'var(--pd-text)' }}>
              {item.label}
            </div>
            {!expanded && (
              <div
                className="mt-0.5 truncate text-[13px]"
                style={{ color: 'var(--pd-muted)', fontFamily: 'var(--pd-font-mono)' }}
              >
                {item.action}
              </div>
            )}
          </div>
          <span
            className="ml-1 shrink-0 self-start rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wider uppercase"
            style={{ backgroundColor: style.bg, color: style.color, border: `1px solid ${style.border}` }}
          >
            P{item.priority}
          </span>
          <span className="shrink-0 self-start pt-0.5 opacity-60">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>

        {/* Dismiss lives outside the toggle button so its disabled state is
            independent of expand/collapse. */}
        <div className="flex shrink-0 items-center pr-3 pl-1">
          <DismissButton gated={gated} seen={seen} onDismiss={onDismiss} />
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 pb-3" style={{ borderColor: style.border }}>
          <ActionArea action={item.action} />
          {item.meta && Object.keys(item.meta).length > 0 && (
            <pre
              className="mt-2 overflow-x-auto rounded p-2 text-[13px] leading-relaxed"
              style={{
                backgroundColor: 'var(--pd-code)',
                color: 'var(--pd-muted)',
                border: '1px solid var(--pd-border)',
                fontFamily: 'var(--pd-font-mono)',
              }}
            >
              {JSON.stringify(item.meta, null, 2)}
            </pre>
          )}
        </div>
      )}

      {locked && (
        <div
          className="flex items-center gap-1.5 border-t px-4 py-2 text-[13px] font-semibold"
          style={{ borderColor: style.border, color: 'var(--pd-accent)' }}
        >
          <Lock size={13} className="shrink-0" />
          <span>Expand to review the command and details before dismissing.</span>
        </div>
      )}
    </div>
  );
}

// ─── Main hero ────────────────────────────────────────────────────────────────

export default function NeedsYouHero({
  items,
  signal,
}: {
  items: NeedsYouItem[];
  signal: FleetSignal | null;
}) {
  const [expandedCode, setExpandedCode] = useState<NeedsYouItem['code'] | null>(null);
  /** Codes the operator has expanded at least once — unlocks gated dismissal. */
  const [seenCodes, setSeenCodes] = useState<ReadonlySet<NeedsYouCode>>(new Set());
  /** Codes the operator has dismissed this session — removed from view. */
  const [dismissedCodes, setDismissedCodes] = useState<ReadonlySet<NeedsYouCode>>(new Set());

  const toggle = (code: NeedsYouItem['code']) => {
    // Expanding a row marks it seen (force-zoom satisfied).
    setSeenCodes((prev) => {
      if (prev.has(code)) return prev;
      const next = new Set(prev);
      next.add(code);
      return next;
    });
    setExpandedCode((prev) => (prev === code ? null : code));
  };

  const dismiss = (code: NeedsYouItem['code']) => {
    setDismissedCodes((prev) => {
      const next = new Set(prev);
      next.add(code);
      return next;
    });
    setExpandedCode((prev) => (prev === code ? null : prev));
  };

  const visible = items.filter((item) => !dismissedCodes.has(item.code));

  if (visible.length === 0) {
    return (
      <section
        aria-label="Needs your attention"
        className="rounded-xl px-5 py-4"
        style={{ backgroundColor: 'var(--pd-success-surface)', border: '1px solid var(--pd-success-border)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--pd-success)' }}>
              NEEDS YOU
            </div>
            <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
              No action required. Fleet is clear.
            </div>
          </div>
          {signal && <FleetSignalBadge signal={signal} />}
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Needs your attention" className="space-y-1">
      <div className="flex items-center justify-between gap-3 px-1 py-1">
        <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--pd-accent)' }}>
          NEEDS YOU — {visible.length} item{visible.length === 1 ? '' : 's'}
        </div>
        {signal && <FleetSignalBadge signal={signal} />}
      </div>

      <div className="space-y-1.5">
        {visible.map((item, index) => (
          <NeedsYouRow
            key={`${item.code}-${index}`}
            item={item}
            expanded={expandedCode === item.code}
            seen={seenCodes.has(item.code)}
            onToggle={() => toggle(item.code)}
            onDismiss={() => dismiss(item.code)}
          />
        ))}
      </div>
    </section>
  );
}
