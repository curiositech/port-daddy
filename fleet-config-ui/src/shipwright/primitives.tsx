import type { ReactNode } from 'react';
import { AgentCardThumbnail } from '../ships';
import type { ProposedAgent, ShipwrightDataResult } from './types';
import { shipIdentityForAgent, sourceLabel } from './helpers';

/**
 * Shipwright primitive components.
 *
 * WHY IT EXISTS: Harbor, Focus, Simulation, and FleetControl should feel like
 * one product surface, not four mockups. These primitives encode the component
 * brief's hard-card treatment, fixture badges, and ship strips without mixing
 * non-component helpers into a Fast Refresh component module.
 *
 * @example
 *   <HardCard>
 *     <SourceBadge result={{ fixture: true, source: 'fixture', data: [] }} />
 *   </HardCard>
 */

export function HardCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`p-4 ${className}`}
      style={{
        backgroundColor: 'var(--pd-surface)',
        border: '2px solid var(--pd-border)',
        borderRadius: 0,
        boxShadow: '5px 5px 0 #000',
      }}
    >
      {children}
    </div>
  );
}

export function SourceBadge<T>({ result }: { result: ShipwrightDataResult<T> }) {
  return (
    <span
      className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
      style={{
        backgroundColor: result.fixture ? 'var(--pd-warning-surface)' : 'var(--pd-success-surface)',
        border: `1px solid ${result.fixture ? 'var(--pd-warning-border)' : 'var(--pd-success-border)'}`,
        borderRadius: 0,
        color: result.fixture ? 'var(--pd-warning)' : 'var(--pd-success)',
      }}
    >
      {sourceLabel(result)}
    </span>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)', borderRadius: 0 }}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--pd-muted)' }}>{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

export function ListBlock({ title, items, tone }: { title: string; items: string[]; tone: 'success' | 'warning' }) {
  const color = tone === 'success' ? 'var(--pd-success)' : 'var(--pd-warning)';
  return (
    <div className="p-3" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)', borderRadius: 0 }}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color }}>{title}</div>
      <ul className="mt-2 space-y-2 text-[12px] leading-relaxed opacity-75">
        {items.slice(0, 3).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function AgentShipStrip({
  projectName,
  agents,
  className,
}: {
  projectName: string;
  agents: ProposedAgent[];
  className?: string;
}) {
  return (
    <AgentCardThumbnail
      ariaLabel={`${projectName} proposed agent ships`}
      className={className}
      identities={agents.map((agent) => shipIdentityForAgent(projectName, agent))}
    />
  );
}
