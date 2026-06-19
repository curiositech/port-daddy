import { AnimatePresence, motion } from 'framer-motion';
import { FileCode2, FolderSearch, GitBranch, TriangleAlert } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { fetchFilePreview, fetchFilesExist, openFileInEditor, revealFileInFinder } from '../api';
import type { FilePreview, FilePreviewLine } from '../types';

interface Props {
  filePath: string;
  projectDir?: string;
  compact?: boolean;
}

const HOVER_OPEN_DELAY_MS = 120;
const HOVER_CLOSE_DELAY_MS = 180;
const PREVIEW_CARD_WIDTH = 420;
const PREVIEW_CARD_HEIGHT = 320;

// Mention chips come from heuristic path extraction, which occasionally
// surfaces non-paths (model ids like `ollama/qwen2.5-coder`). Each chip
// confirms its path exists on disk before rendering; misses vanish silently
// instead of producing "File not found" errors. Cached per (projectDir, path)
// for the life of the page so repeated mentions cost one daemon call.
const fileExistenceCache = new Map<string, Promise<boolean>>();

function checkFileExists(filePath: string, projectDir?: string): Promise<boolean> {
  const key = `${projectDir ?? ''}|${filePath}`;
  let pending = fileExistenceCache.get(key);
  if (!pending) {
    pending = fetchFilesExist([filePath], projectDir).then((results) => results[filePath] !== false);
    fileExistenceCache.set(key, pending);
  }
  return pending;
}

/**
 * Map preview line kinds onto the operator palette used in FleetBar.
 *
 * Example:
 * - input: `'add'`
 * - output: green-tinted background and text colors
 */
function previewLineStyle(kind: FilePreviewLine['kind']) {
  switch (kind) {
    case 'add':
      return {
        backgroundColor: 'color-mix(in srgb, var(--pd-success-surface) 86%, transparent)',
        color: 'var(--pd-success)',
      };
    case 'remove':
      return {
        backgroundColor: 'color-mix(in srgb, var(--pd-danger-surface) 82%, transparent)',
        color: 'var(--pd-danger)',
      };
    case 'hunk':
      return {
        backgroundColor: 'color-mix(in srgb, var(--pd-accent-surface) 82%, transparent)',
        color: 'var(--pd-accent)',
      };
    case 'meta':
      return {
        backgroundColor: 'color-mix(in srgb, var(--pd-surface) 72%, transparent)',
        color: 'var(--pd-dim)',
      };
    default:
      return {
        backgroundColor: 'transparent',
        color: 'var(--pd-text)',
      };
  }
}

/**
 * Convert preview provenance into short badge copy for dense operator UI.
 *
 * Example:
 * - input: `'working-tree'`
 * - output: `'working tree'`
 */
function previewSourceLabel(source: FilePreview['source'] | null | undefined): string {
  switch (source) {
    case 'working-tree':
      return 'working tree';
    case 'staged':
      return 'staged';
    case 'untracked':
      return 'new file';
    case 'snapshot':
      return 'snapshot';
    default:
      return 'preview';
  }
}

/**
 * Translate low-level fetch/runtime failures into operator-facing guidance.
 *
 * Example:
 * - input: `POST /operator/file-preview: 404 Not Found`
 * - output: `Preview unavailable on the live daemon. Restart or promote Port Daddy so /operator/file-preview exists.`
 */
function formatPreviewError(message: string): string {
  const normalized = message.trim();
  if (!normalized) {
    return 'Preview unavailable. The live daemon may need a rebuild or restart.';
  }
  if (normalized.includes('/operator/file-preview') || normalized.includes('404')) {
    return 'Preview unavailable on the live daemon. Restart or promote Port Daddy so /operator/file-preview exists.';
  }
  if (normalized === 'Failed to fetch' || normalized === 'Load failed') {
    return 'Preview unavailable. Check that the Fleet daemon is reachable and serving the current checkout.';
  }
  return normalized;
}

/**
 * Generic mutation chip used across FleetBar/control-plane surfaces. It shows a
 * compact file label in dense layouts and reveals a stable anchored preview card
 * with a lightweight diff/snippet when hovered or focused.
 */
export default function FileActionLinks({ filePath, projectDir, compact = false }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [pending, setPending] = useState<'editor' | 'finder' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [exists, setExists] = useState<boolean | null>(null);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    setPreviewOpen(false);
  }, [filePath, projectDir]);

  useEffect(() => {
    let cancelled = false;
    setExists(null);
    void checkFileExists(filePath, projectDir).then((value) => {
      if (!cancelled) setExists(value);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath, projectDir]);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gutter = 16;
    const gap = 10;

    let left = rect.right + gap;
    if (left + PREVIEW_CARD_WIDTH > viewportWidth - gutter) {
      left = Math.max(gutter, rect.left - PREVIEW_CARD_WIDTH - gap);
    }

    let top = rect.top - 8;
    if (top + PREVIEW_CARD_HEIGHT > viewportHeight - gutter) {
      top = Math.max(gutter, viewportHeight - PREVIEW_CARD_HEIGHT - gutter);
    }

    setPosition({ top, left });
  }, []);

  const loadPreview = useCallback(async () => {
    if (previewLoading || preview) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const nextPreview = await fetchFilePreview(filePath, projectDir, 24);
      setPreview(nextPreview);
    } catch (err) {
      setPreviewError(formatPreviewError((err as Error).message));
    } finally {
      setPreviewLoading(false);
    }
  }, [filePath, preview, previewLoading, projectDir]);

  const openPreview = useCallback(() => {
    clearCloseTimer();
    clearOpenTimer();
    updatePosition();
    setPreviewOpen(true);
    void loadPreview();
  }, [clearCloseTimer, clearOpenTimer, loadPreview, updatePosition]);

  const scheduleOpen = useCallback(() => {
    clearCloseTimer();
    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => {
      openPreview();
    }, HOVER_OPEN_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer, openPreview]);

  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setPreviewOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer]);

  useEffect(() => {
    return () => {
      clearOpenTimer();
      clearCloseTimer();
    };
  }, [clearCloseTimer, clearOpenTimer]);

  useEffect(() => {
    if (!previewOpen) return undefined;

    const reposition = () => updatePosition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [previewOpen, updatePosition]);

  async function run(mode: 'editor' | 'finder', event: SyntheticEvent<HTMLButtonElement>) {
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

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    event.stopPropagation();
    openPreview();
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    scheduleClose();
  }

  const previewFooter = useMemo(() => {
    if (!preview) return null;
    return `${previewSourceLabel(preview.source)} • +${preview.additions} / -${preview.deletions}`;
  }, [preview]);

  if (exists !== true) return null;

  return (
    <>
      <div
        ref={rootRef}
        className={`rounded-md border ${compact ? 'px-2 py-1.5' : 'px-2.5 py-2'} min-w-0`}
        style={{ backgroundColor: 'var(--pd-bg)', borderColor: error ? 'var(--pd-danger-border)' : 'var(--pd-border)' }}
        title={error ?? filePath}
        onClick={(event) => event.stopPropagation()}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={handleFocus}
        onBlur={handleBlur}
        tabIndex={0}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-mono truncate" style={{ color: 'var(--pd-accent)' }}>
              {filePath}
            </div>
            {previewFooter ? (
              <div className="mt-0.5 text-[8px] uppercase tracking-[0.14em]" style={{ color: 'var(--pd-dim)' }}>
                {previewFooter}
              </div>
            ) : null}
          </div>
          <GitBranch size={10} style={{ color: preview ? 'var(--pd-success)' : 'var(--pd-dim)', flexShrink: 0, marginTop: 2 }} />
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => void run('editor', event)}
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
            onClick={(event) => void run('finder', event)}
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
          <div className="mt-1 text-[9px]" style={{ color: 'var(--pd-danger)' }}>
            {error}
          </div>
        ) : null}
      </div>

      {typeof document !== 'undefined' ? createPortal(
        <AnimatePresence>
          {previewOpen ? (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="fixed z-[80] w-[420px] overflow-hidden rounded-2xl"
              style={{
                top: position.top,
                left: position.left,
                backgroundColor: 'color-mix(in srgb, var(--pd-surface) 92%, var(--pd-bg))',
                border: '1px solid color-mix(in srgb, var(--pd-border) 84%, transparent)',
                boxShadow: '0 20px 60px color-mix(in srgb, var(--pd-bg) 76%, transparent)',
                backdropFilter: 'blur(18px)',
              }}
              onMouseEnter={openPreview}
              onMouseLeave={scheduleClose}
            >
              <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--pd-dim)' }}>
                      Mutation Preview
                    </div>
                    <div className="mt-1 truncate text-[12px] font-mono" style={{ color: 'var(--pd-accent)' }}>
                      {preview?.displayPath ?? filePath}
                    </div>
                  </div>
                  <div className="rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
                    {previewSourceLabel(preview?.source)}
                  </div>
                </div>
                {preview ? (
                  <div className="mt-2 flex items-center gap-2 text-[10px]">
                    <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' }}>
                      +{preview.additions}
                    </span>
                    <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-danger-surface)', color: 'var(--pd-danger)', border: '1px solid var(--pd-danger-border)' }}>
                      -{preview.deletions}
                    </span>
                    {preview.truncated ? (
                      <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
                        truncated
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="max-h-[240px] overflow-y-auto px-3 py-3">
                {previewLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 8 }).map((_, index) => (
                      <div
                        key={index}
                        className="h-5 rounded-md"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--pd-surface) 80%, transparent)' }}
                      />
                    ))}
                  </div>
                ) : previewError ? (
                  <div className="rounded-xl p-3 text-[11px]" style={{ backgroundColor: 'var(--pd-danger-surface)', color: 'var(--pd-danger)', border: '1px solid var(--pd-danger-border)' }}>
                    <div className="flex items-start gap-2">
                      <TriangleAlert size={14} className="mt-0.5" />
                      <div>{previewError}</div>
                    </div>
                  </div>
                ) : preview ? (
                  <div className="space-y-1">
                    {preview.lines.map((line, index) => {
                      const tone = previewLineStyle(line.kind);
                      return (
                        <div
                          key={`${line.kind}-${index}-${line.text}`}
                          className="rounded-md px-2 py-1 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words"
                          style={tone}
                        >
                          {line.text}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[11px]" style={{ color: 'var(--pd-muted)' }}>
                    Hover to load a file preview.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--pd-border)' }}>
                <div className="text-[10px]" style={{ color: 'var(--pd-dim)' }}>
                  Static preview card inspired by a 21st hover-detail pattern, adapted for dense FleetBar mutation chips.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(event) => void run('editor', event)}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold"
                    style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}
                  >
                    <FileCode2 size={12} />
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={(event) => void run('finder', event)}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold"
                    style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}
                  >
                    <FolderSearch size={12} />
                    Finder
                  </button>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      ) : null}
    </>
  );
}
