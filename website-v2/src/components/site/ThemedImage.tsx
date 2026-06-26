import * as React from 'react'
import { useTheme } from '@/lib/theme-context'

/**
 * Insert `-dark` before a file's extension to derive its dark-mode sibling:
 *   /img/manifesto/collision.webp → /img/manifesto/collision-dark.webp
 * Query strings and hashes (if any) are preserved after the extension.
 */
export function toDarkSrc(src: string): string {
  const [path, ...suffixParts] = src.split(/(?=[?#])/)
  const suffix = suffixParts.join('')
  const dot = path.lastIndexOf('.')
  if (dot <= path.lastIndexOf('/')) return src // no extension — leave untouched
  return `${path.slice(0, dot)}-dark${path.slice(dot)}${suffix}`
}

type ThemedImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  /** The LIGHT (default) image source. The dark sibling is derived from it. */
  src: string
}

/**
 * Renders the `-dark` sibling of `src` when the active theme is dark, otherwise
 * the light `src`. If a dark variant is missing (404 / decode error) it falls
 * back to the light source so a broken image never ships. All normal <img>
 * props (alt, className, width/height, loading, …) pass straight through.
 */
export function ThemedImage({ src, onError, ...rest }: ThemedImageProps) {
  const { theme } = useTheme()
  const darkSrc = React.useMemo(() => toDarkSrc(src), [src])
  const wantDark = theme === 'dark'
  const [failedDark, setFailedDark] = React.useState(false)

  // A fresh theme/src pair should re-attempt the dark variant.
  React.useEffect(() => {
    setFailedDark(false)
  }, [src, theme])

  const resolved = wantDark && !failedDark ? darkSrc : src

  const handleError = React.useCallback(
    (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
      if (wantDark && !failedDark) {
        // Dark sibling missing — fall back to the light source silently.
        setFailedDark(true)
        return
      }
      onError?.(event)
    },
    [wantDark, failedDark, onError],
  )

  return <img src={resolved} onError={handleError} {...rest} />
}
