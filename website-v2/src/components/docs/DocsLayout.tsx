import { Outlet } from 'react-router-dom'
import { SiteFooter } from '@/components/site/SiteFooter'
import { DocsSidebar } from '@/components/site/DocsSidebar'
import { SiteHeader } from '@/components/site/SiteHeader'

export function DocsLayout() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)] selection:bg-[var(--brand-primary)] selection:text-[var(--text-inverse)]">
      <SiteHeader />

      <main id="main-content" className="relative overflow-hidden border-b-2 border-[var(--border-strong)]">
        <div className="pointer-events-none absolute left-0 top-0 h-[calc(var(--space-10)+var(--space-8))] w-[calc(var(--space-10)+var(--space-8))] bg-[var(--brand-primary)]" />
        <div className="pointer-events-none absolute right-0 top-[var(--space-8)] hidden h-[calc(var(--space-10)+var(--space-7))] w-[var(--space-10)] bg-[var(--brand-accent)] lg:block" />

        <div className="pointer-events-none absolute inset-0 hidden lg:block">
          <div className="absolute inset-y-0 left-1/4 border-l border-[var(--border-strong)]/16" />
          <div className="absolute inset-y-0 left-1/2 border-l border-[var(--border-strong)]/16" />
          <div className="absolute inset-y-0 left-3/4 border-l border-[var(--border-strong)]/16" />
        </div>

        <div className="relative mx-auto grid max-w-[1440px] grid-cols-1 gap-[var(--space-6)] px-[var(--space-5)] py-[var(--space-6)] lg:grid-cols-12 lg:px-[var(--space-6)] lg:py-[var(--space-7)]">
          <div className="lg:col-span-4 lg:self-start xl:col-span-3">
            <DocsSidebar />
          </div>
          <div className="lg:col-span-8 xl:col-span-9">
            <Outlet />
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
