import { useState, type MouseEvent } from 'react';
import { openFileInEditor, revealFileInFinder } from '../api';

interface Props {
  filePath: string;
  projectDir?: string;
  compact?: boolean;
}

export default function FileActionLinks({ filePath, projectDir, compact = false }: Props) {
  const [pending, setPending] = useState<'editor' | 'finder' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(mode: 'editor' | 'finder', event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setPending(mode);
    setError(null);
    try {
      if (mode === 'editor') {
        await openFileInEditor(filePath, projectDir);
      } else {
        await revealFileInFinder(filePath, projectDir);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      className={`rounded-md border ${compact ? 'px-2 py-1.5' : 'px-2.5 py-2'} min-w-0`}
      style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)' }}
      title={error ?? filePath}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="text-[10px] font-mono truncate" style={{ color: 'var(--pd-accent)' }}>
        {filePath}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={(event) => run('editor', event)}
          disabled={pending !== null}
          className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]"
          style={{
            backgroundColor: 'var(--pd-surface)',
            color: 'var(--pd-text)',
            border: '1px solid var(--pd-border)',
            opacity: pending && pending !== 'editor' ? 0.6 : 1,
          }}
        >
          {pending === 'editor' ? 'Opening…' : 'Editor'}
        </button>
        <button
          type="button"
          onClick={(event) => run('finder', event)}
          disabled={pending !== null}
          className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]"
          style={{
            backgroundColor: 'var(--pd-surface)',
            color: 'var(--pd-text)',
            border: '1px solid var(--pd-border)',
            opacity: pending && pending !== 'finder' ? 0.6 : 1,
          }}
        >
          {pending === 'finder' ? 'Opening…' : 'Finder'}
        </button>
      </div>
      {error ? (
        <div className="mt-1 text-[9px]" style={{ color: 'var(--pd-accent)' }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
