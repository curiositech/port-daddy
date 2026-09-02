import React, { useEffect, useRef, useCallback, useId, useState } from 'react'
import type { Mermaid as MermaidApi } from 'mermaid'
import { cn } from '@/lib/utils'

// mermaid.initialize()/render() mutate module-global state, so two renders in
// flight at once (two diagrams on a page, or a theme-flip re-render racing an
// interactive chart swap) corrupt each other's layout constants — the diagram
// comes back with a blown-up viewBox and misplaced nodes. Every render on the
// page therefore queues through this one chain, and each component drops any
// result that a newer render of the same instance has superseded.
let mermaidRenderChain: Promise<void> = Promise.resolve()

interface MermaidProps {
  chart: string
  className?: string
  /**
   * Flowchart label mode. HTML labels (the default) support `<br/>`/`<i>`
   * markup but re-measure through a foreignObject sandbox that can collapse
   * on rapid re-renders (chart-swapping interactive diagrams blow up to a
   * giant viewBox with unreadable labels). Interactive charts that re-render
   * with new chart strings should pass `false` to use SVG-text labels, which
   * measure via getBBox and stay stable across re-renders.
   */
  flowchartHtmlLabels?: boolean
}

export const Mermaid: React.FC<MermaidProps> = ({ chart, className, flowchartHtmlLabels = true }) => {
  const ref = useRef<HTMLDivElement>(null)
  const idPrefix = useId().replace(/:/g, '')
  const renderCount = useRef(0)
  // Dynamic import so the `mermaid` module never evaluates during
  // prerender — it touches `document` / `window` at module scope,
  // which throws under vite-react-ssg.
  const [mermaid, setMermaid] = useState<MermaidApi | null>(null)
  useEffect(() => {
    let active = true
    import('mermaid').then((mod) => {
      if (active) setMermaid(mod.default)
    })
    return () => { active = false }
  }, [])

  const generation = useRef(0)

  const renderChart = useCallback(() => {
    if (!mermaid) return
    const gen = ++generation.current
    // Render diagrams as a theme-INDEPENDENT light "paper" card so they stay
    // legible in dark mode (the old version inherited dark tokens -> dark text
    // on a dark inset gradient, and the SVG rendered at tiny natural size).
    // Colours come from the --diagram-* tokens (defined once, not overridden in
    // the dark theme), so the literals live in the token file, not here.
    const style = getComputedStyle(document.documentElement)
    const tok = (name: string) => style.getPropertyValue(name).trim()
    const ink = tok('--diagram-ink')
    const paper = tok('--diagram-paper')
    const paperBase = tok('--diagram-paper-2')
    const cobalt = tok('--diagram-signal')
    const lifeline = tok('--diagram-lifeline')
    const seqNum = tok('--diagram-seq-num')
    const note = tok('--diagram-note')

    const initializeMermaid = () => mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      themeVariables: {
        primaryColor: paper,
        primaryTextColor: ink,
        primaryBorderColor: ink,
        lineColor: cobalt,
        secondaryColor: paperBase,
        tertiaryColor: paperBase,
        mainBkg: paper,
        nodeBorder: ink,
        clusterBkg: paperBase,
        clusterBorder: ink,
        defaultLinkColor: cobalt,
        titleColor: ink,
        textColor: ink,
        edgeLabelBackground: paper,
        nodeTextColor: ink,
        // Sequence diagram specific
        signalColor: cobalt,
        signalTextColor: ink,
        actorBkg: paper,
        actorBorder: ink,
        actorTextColor: ink,
        actorLineColor: lifeline,
        activationBorderColor: cobalt,
        activationBkgColor: paperBase,
        sequenceNumberColor: seqNum,
        labelBoxBkgColor: paperBase,
        labelBoxBorderColor: ink,
        labelTextColor: ink,
        loopTextColor: ink,
        noteBkgColor: note,
        noteTextColor: ink,
        noteBorderColor: ink,
        fontFamily: '"Source Sans 3", "Helvetica Neue", Helvetica, Arial, sans-serif',
        fontSize: '15px',
      },
      flowchart: {
        curve: 'basis',
        htmlLabels: flowchartHtmlLabels,
        nodeSpacing: 72,
        rankSpacing: 82,
        padding: 22,
        useMaxWidth: true,
      },
      sequence: {
        useMaxWidth: true,
        diagramMarginX: 8,
        diagramMarginY: 8,
        actorMargin: 60,
        boxMargin: 10,
        messageFontSize: 15,
        actorFontSize: 15,
        noteFontSize: 14,
        mirrorActors: true,
      },
    })

    if (ref.current && chart) {
      const id = `mermaid-${idPrefix}-${renderCount.current}`
      renderCount.current += 1
      mermaidRenderChain = mermaidRenderChain.then(async () => {
        // A newer render of this instance has superseded us; let it win.
        if (gen !== generation.current || !ref.current) return
        try {
          initializeMermaid()
          // mermaid.render produces trusted SVG from our own chart definitions
          const result = await mermaid.render(id, chart)
          if (gen !== generation.current || !ref.current) return
          const parsed = new DOMParser().parseFromString(result.svg, 'image/svg+xml')
          const svg = parsed.documentElement
          if (svg.tagName.toLowerCase() === 'svg') {
            // Fill the container width so the diagram is legible, not tiny.
            svg.setAttribute('width', '100%')
            svg.style.width = '100%'
            svg.style.height = 'auto'
            svg.style.maxWidth = '100%'
            svg.style.display = 'block'
            ref.current.textContent = ''
            ref.current.appendChild(document.importNode(svg, true))
          }
        } catch (error: unknown) {
          // A diagram must never fail into a silent blank panel — that ships
          // "evidence" that shows nothing. Surface the parse/render error in
          // the card so previews and captures make the failure obvious.
          if (gen !== generation.current || !ref.current) return
          ref.current.textContent = ''
          const fallback = document.createElement('pre')
          fallback.setAttribute('data-mermaid-error', 'true')
          fallback.style.whiteSpace = 'pre-wrap'
          fallback.style.fontSize = '0.875rem'
          fallback.style.lineHeight = '1.5'
          fallback.style.color = '#bf2f2f'
          fallback.style.margin = '0'
          fallback.textContent = `Diagram failed to render:\n${String(error)}`
          ref.current.appendChild(fallback)
        }
      })
    }
  }, [chart, idPrefix, mermaid, flowchartHtmlLabels])

  useEffect(() => {
    if (!mermaid) return
    renderChart()

    // Re-render when theme changes
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme') {
          renderChart()
          break
        }
      }
    })
    observer.observe(document.documentElement, { attributes: true })
    return () => observer.disconnect()
  }, [renderChart, mermaid])

  // Light "paper" card, theme-independent — the diagram is always dark-on-cream
  // so it reads the same in light and dark mode (no dark-on-dark gradient).
  return (
    <div
      className={cn(
        'pd-docs-mermaid my-12 flex w-full justify-center overflow-x-auto border-2 border-[var(--border-strong)] bg-[var(--diagram-paper)] p-[var(--space-6)]',
        className,
      )}
      ref={ref}
    />
  )
}
