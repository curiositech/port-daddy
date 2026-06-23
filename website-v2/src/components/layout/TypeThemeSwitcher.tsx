import { useEffect, useState } from 'react'

/**
 * Type-theme switcher — a small toggle for the site's type system.
 *
 * Normalized to two systems, both self-hosted (no external font requests):
 *   - Fraunces (default, no attribute) — editorial serif display + Source Sans 3
 *     body + JetBrains Mono, loaded globally in index.html.
 *   - Recursive (opt-in) — one variable font, sans-to-mono on a single axis,
 *     self-hosted in tokens.source.css.
 *
 * The earlier grab-bag (Radnika, General Sans, Geist+Inter, IBM Plex, Archivo)
 * was removed: those either had no CSS block or pulled external webfonts, which
 * is exactly the font sprawl this toggle should not create.
 */

interface TypeTheme {
  id: string | null
  label: string
  detail: string
  links: string[]
}

const THEMES: TypeTheme[] = [
  {
    id: null,
    label: 'Fraunces',
    detail: 'the default — editorial serif over Source Sans 3',
    links: [],
  },
  {
    id: 'recursive',
    label: 'Recursive',
    detail: 'one variable font, sans-to-mono on a single axis',
    links: [],
  },
]

const STORAGE_KEY = 'pd-type-theme'
const injected = new Set<string>()

function injectFonts(theme: TypeTheme) {
  for (const href of theme.links) {
    if (injected.has(href)) continue
    injected.add(href)
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
  }
}

function applyTheme(theme: TypeTheme) {
  injectFonts(theme)
  if (theme.id) {
    document.documentElement.setAttribute('data-type-theme', theme.id)
  } else {
    document.documentElement.removeAttribute('data-type-theme')
  }
}

export function TypeThemeSwitcher() {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    const theme = THEMES.find((t) => t.id === stored)
    if (theme && theme.id) {
      setActive(theme.id)
      applyTheme(theme)
    }
  }, [])

  const select = (theme: TypeTheme) => {
    setActive(theme.id)
    applyTheme(theme)
    if (theme.id) {
      localStorage.setItem(STORAGE_KEY, theme.id)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-lg">
          <div className="border-b border-[var(--border-subtle)] px-4 py-2 font-mono text-[0.8125rem] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary,inherit)]">
            Type system
          </div>
          <ul className="m-0 list-none p-0">
            {THEMES.map((theme) => (
              <li key={theme.label}>
                <button
                  type="button"
                  aria-pressed={active === theme.id}
                  onClick={() => select(theme)}
                  className="flex w-full items-baseline gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5 text-left last:border-b-0 hover:bg-[var(--surface-strong)]"
                >
                  <span className="min-w-[9rem] text-[0.9375rem] font-semibold">
                    {active === theme.id ? '● ' : ''}
                    {theme.label}
                  </span>
                  <span className="text-[0.875rem] opacity-70">
                    {theme.detail}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-label="Switch type system"
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[1.125rem] font-bold shadow-md hover:bg-[var(--surface-strong)]"
      >
        Aa
      </button>
    </div>
  )
}
