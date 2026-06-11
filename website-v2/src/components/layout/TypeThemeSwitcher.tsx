import { useEffect, useState } from 'react'

/**
 * Type-theme switcher — a feel-out tool for the site's type system.
 *
 * Default (no attribute on <html>) is Recursive, self-hosted in
 * tokens.source.css. Every alternate swaps the three font-role variables
 * via html[data-type-theme="..."] blocks in tokens.source.css; this
 * component only sets the attribute, lazily injects the alternate's
 * webfont stylesheet the first time it is selected, and persists the
 * choice in localStorage. Delete this component (and the theme blocks)
 * once a winner is chosen.
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
    label: 'Recursive',
    detail: 'one variable font, sans-to-mono on a single axis',
    links: [],
  },
  {
    id: 'radnika',
    label: 'Radnika',
    detail: 'the previous system',
    links: [],
  },
  {
    id: 'general-sans',
    label: 'General Sans',
    detail: 'console-aligned, same faces as pd-console',
    links: [
      'https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap',
    ],
  },
  {
    id: 'geist-inter',
    label: 'Geist + Inter',
    detail: 'technical Swiss',
    links: [
      'https://fonts.googleapis.com/css2?family=Geist:wght@400..800&family=Inter:opsz,wght@14..32,400..700&family=Geist+Mono:wght@400;500&display=swap',
    ],
  },
  {
    id: 'plex',
    label: 'IBM Plex',
    detail: 'superfamily: sans display, serif body',
    links: [
      'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,500;1,400&display=swap',
    ],
  },
  {
    id: 'fraunces',
    label: 'Fraunces',
    detail: 'serif display over Source Sans',
    links: [
      'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,400..700,0,0&family=Source+Sans+3:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
    ],
  },
  {
    id: 'archivo',
    label: 'Archivo',
    detail: 'poster grotesque over Source Serif',
    links: [
      'https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap',
    ],
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
