import { useEffect, useState } from 'react'

/**
 * Type-theme switcher — a feel-out tool for the site's type system.
 *
 * The default (no attribute on <html>) is Recursive, self-hosted in
 * tokens.source.css — one variable file covering display, body, and mono.
 * Each alternate swaps the three font-role variables via the matching
 * html[data-type-theme="..."] block in tokens.source.css; this component
 * sets the attribute, lazily injects the alternate's webfont stylesheet the
 * first time it is picked, and persists the choice in localStorage.
 *
 * The roster is curated, not a grab-bag, and it skips the AI-design defaults
 * (Inter, Geist, Fraunces, the Fontshare/ITF starter pack). Every alternate
 * is SIL OFL: Recursive and Radnika are self-hosted; the rest load from
 * Google Fonts on demand. Once a winner is chosen, drop this component, its
 * theme blocks, and subset/self-host the winner.
 */

interface TypeTheme {
  id: string | null
  label: string
  detail: string
  links: string[]
}

const GF = 'https://fonts.googleapis.com/css2'

const THEMES: TypeTheme[] = [
  {
    id: null,
    label: 'Recursive',
    detail: 'self-hosted default — one variable file, sans through mono',
    links: [],
  },
  {
    id: 'plex',
    label: 'IBM Plex',
    detail: 'libre superfamily: serif body, sans display, Plex mono',
    links: [
      `${GF}?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,500;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap`,
    ],
  },
  {
    id: 'hanken',
    label: 'Hanken Grotesk',
    detail: 'warm humanist UI sans — what to use instead of Inter',
    links: [
      `${GF}?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Spline+Sans+Mono:wght@400;500&display=swap`,
    ],
  },
  {
    id: 'schibsted',
    label: 'Schibsted Grotesk',
    detail: 'Scandinavian grotesque with grit, in place of General Sans',
    links: [
      `${GF}?family=Schibsted+Grotesk:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap`,
    ],
  },
  {
    id: 'newsreader',
    label: 'Newsreader',
    detail: 'editorial serif over Source Sans 3 — the un-Fraunces',
    links: [
      `${GF}?family=Newsreader:opsz,ital,wght@6..72,0,400..700;6..72,1,400&family=Source+Sans+3:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap`,
    ],
  },
  {
    id: 'bricolage',
    label: 'Bricolage Grotesque',
    detail: 'expressive display with a real opsz axis, over Hanken',
    links: [
      `${GF}?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Hanken+Grotesk:wght@400;500;600;700&family=Martian+Mono:wght@400;500&display=swap`,
    ],
  },
  {
    id: 'archivo',
    label: 'Archivo',
    detail: 'poster grotesque over a Source Serif 4 body',
    links: [
      `${GF}?family=Archivo:wght@500;600;700;800&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=IBM+Plex+Mono:wght@400;500&display=swap`,
    ],
  },
  {
    id: 'radnika',
    label: 'Radnika',
    detail: 'the previous house sans, kept for comparison',
    links: [
      `${GF}?family=IBM+Plex+Mono:wght@400;500&display=swap`,
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
