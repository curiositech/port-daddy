import * as React from 'react'
import { useTheme } from '@/lib/theme-context'
import { toDarkSrc } from './ThemedImageSrc'

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
