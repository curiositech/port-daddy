import { ExternalLink } from 'lucide-react';
import type { BackendSetupLink } from '../types';

interface BackendSetupActionsProps {
  backend: { id?: string | null; setupLinks?: BackendSetupLink[] } | null | undefined;
  compact?: boolean;
}

export default function BackendSetupActions({ backend, compact = false }: BackendSetupActionsProps) {
  const links = backend?.setupLinks ?? [];
  if (links.length === 0) return null;

  return (
    <div className={compact ? 'mt-2 flex flex-wrap gap-1.5' : 'mt-3 grid gap-2'}>
      {links.map((link) => (
        <a
          key={`${backend?.id ?? 'backend'}-${link.url}`}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className={compact
            ? 'inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold'
            : 'inline-flex items-start gap-2 rounded-md border px-3 py-2 text-xs'}
          style={{
            backgroundColor: link.kind === 'token_template' ? 'var(--pd-accent-surface)' : 'var(--pd-bg)',
            color: link.kind === 'token_template' ? 'var(--pd-accent)' : 'var(--pd-muted)',
            border: `1px solid ${link.kind === 'token_template' ? 'var(--pd-accent-border)' : 'var(--pd-border)'}`,
          }}
        >
          <ExternalLink size={compact ? 11 : 13} className="mt-0.5 flex-shrink-0" />
          <span>
            <span className="font-semibold">{link.label}</span>
            {!compact && link.description ? (
              <span className="mt-0.5 block leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                {link.description}
              </span>
            ) : null}
          </span>
        </a>
      ))}
    </div>
  );
}
