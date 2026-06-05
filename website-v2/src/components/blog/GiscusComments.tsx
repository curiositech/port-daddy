import { useEffect, useRef } from 'react'
import { MessageCircle } from 'lucide-react'
import { useTheme } from '@/lib/theme-context'

/**
 * Giscus comment section — GitHub Discussions backed, no database, no server.
 *
 * ─── OPERATOR SETUP (one-time, on the GitHub repo) ──────────────────────────
 * Giscus renders nothing useful until the repo is enabled. Until then this
 * component shows an honest "comments not configured yet" placeholder rather
 * than a fake thread. To turn it on:
 *
 *   1. On github.com/curiositech/port-daddy → Settings → General →
 *      Features → tick "Discussions".
 *   2. Install the giscus GitHub App and grant it that repo:
 *      https://github.com/apps/giscus  →  Configure  →  pick the repo.
 *   3. Visit https://giscus.app, enter `curiositech/port-daddy`, choose the
 *      "Announcements" Discussion category (mapping = "pathname"), and copy the
 *      generated `data-repo-id` and `data-category-id`.
 *   4. Set these build-time env vars (e.g. in website-v2/.env or the CI/CD
 *      environment) — Vite only exposes vars prefixed with VITE_:
 *
 *        VITE_GISCUS_REPO=curiositech/port-daddy
 *        VITE_GISCUS_REPO_ID=<data-repo-id from giscus.app>
 *        VITE_GISCUS_CATEGORY=Announcements
 *        VITE_GISCUS_CATEGORY_ID=<data-category-id from giscus.app>
 *
 * No secrets are involved — repo-id and category-id are public identifiers and
 * safe to commit or ship in the client bundle.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const GISCUS_REPO = import.meta.env.VITE_GISCUS_REPO as string | undefined
const GISCUS_REPO_ID = import.meta.env.VITE_GISCUS_REPO_ID as string | undefined
const GISCUS_CATEGORY = (import.meta.env.VITE_GISCUS_CATEGORY as string | undefined) ?? 'Announcements'
const GISCUS_CATEGORY_ID = import.meta.env.VITE_GISCUS_CATEGORY_ID as string | undefined

const IS_CONFIGURED = Boolean(GISCUS_REPO && GISCUS_REPO_ID && GISCUS_CATEGORY_ID)

interface GiscusCommentsProps {
  /** Stable term used to map this page to one GitHub Discussion thread. */
  term: string
}

export function GiscusComments({ term }: GiscusCommentsProps) {
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)

  // Mount the giscus <script>. Re-mounting on theme/term change keeps the
  // embedded iframe in sync with the site's light/dark toggle.
  useEffect(() => {
    if (!IS_CONFIGURED) return
    const container = containerRef.current
    if (!container) return

    container.innerHTML = ''

    const script = document.createElement('script')
    script.src = 'https://giscus.app/client.js'
    script.async = true
    script.crossOrigin = 'anonymous'
    script.setAttribute('data-repo', GISCUS_REPO!)
    script.setAttribute('data-repo-id', GISCUS_REPO_ID!)
    script.setAttribute('data-category', GISCUS_CATEGORY)
    script.setAttribute('data-category-id', GISCUS_CATEGORY_ID!)
    script.setAttribute('data-mapping', 'specific')
    script.setAttribute('data-term', term)
    script.setAttribute('data-strict', '1')
    script.setAttribute('data-reactions-enabled', '1')
    script.setAttribute('data-emit-metadata', '0')
    script.setAttribute('data-input-position', 'top')
    script.setAttribute('data-theme', theme === 'dark' ? 'transparent_dark' : 'light')
    script.setAttribute('data-lang', 'en')
    script.setAttribute('data-loading', 'lazy')

    container.appendChild(script)

    return () => {
      container.innerHTML = ''
    }
  }, [term, theme])

  return (
    <section id="comments" aria-labelledby="comments-heading" className="mt-[var(--blog-section-break)]">
      <div className="flex items-center gap-[var(--space-2)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
        <MessageCircle size={20} className="text-[var(--brand-secondary)]" aria-hidden="true" />
        <h2
          id="comments-heading"
          className="font-display text-[length:var(--text-2xl)] font-black uppercase tracking-[var(--tracking-display-nav)] text-[var(--text-primary)]"
        >
          Discussion
        </h2>
      </div>

      {IS_CONFIGURED ? (
        <div ref={containerRef} className="mt-[var(--space-6)]" />
      ) : (
        <div className="mt-[var(--space-6)] border-2 border-[var(--border-default)] bg-[var(--surface-sunken)] p-[var(--space-6)]">
          <p className="text-[length:var(--text-base)] font-semibold text-[var(--text-primary)]">
            Comments are powered by GitHub Discussions (giscus).
          </p>
          <p className="mt-[var(--space-2)] text-[length:var(--text-base)] leading-relaxed text-[var(--text-secondary)]">
            The thread is not live yet — it needs a one-time setup on the{' '}
            <a
              href="https://github.com/curiositech/port-daddy"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--brand-primary)] underline underline-offset-4 hover:text-[var(--brand-secondary)]"
            >
              curiositech/port-daddy
            </a>{' '}
            repository. Enable Discussions, install the{' '}
            <a
              href="https://github.com/apps/giscus"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--brand-primary)] underline underline-offset-4 hover:text-[var(--brand-secondary)]"
            >
              giscus app
            </a>
            , then set the <code className="font-mono text-[length:var(--text-base)]">VITE_GISCUS_*</code> build
            variables documented in <code className="font-mono text-[length:var(--text-base)]">GiscusComments.tsx</code>.
          </p>
        </div>
      )}
    </section>
  )
}
