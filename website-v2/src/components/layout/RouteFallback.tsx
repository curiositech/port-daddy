export function RouteFallback() {
  return (
    <div
      className="min-h-[40vh] bg-[var(--surface-base)] px-[var(--layout-gutter)] py-[var(--section-space-y)] text-[var(--text-secondary)]"
      role="status"
      aria-live="polite"
    >
      Loading route...
    </div>
  )
}
