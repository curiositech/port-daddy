import { useEffect, useMemo, useRef } from 'react'
import { useTheme } from '@/lib/theme-context'

const liveGloryVideos = {
  light: {
    src: '/media/landing-live-glory/port-daddy-live-glory-light.mp4',
    poster: '/media/landing-live-glory/port-daddy-live-glory-light-poster.jpg',
  },
  dark: {
    src: '/media/landing-live-glory/port-daddy-live-glory-dark.mp4',
    poster: '/media/landing-live-glory/port-daddy-live-glory-dark-poster.jpg',
  },
} as const

type ThemeKey = keyof typeof liveGloryVideos

function syncVideoPair(active: HTMLVideoElement | null, inactive: HTMLVideoElement | null) {
  if (!active || !inactive) {
    return
  }

  const play = (video: HTMLVideoElement) => {
    if (video.paused) {
      void video.play().catch(() => undefined)
    }
  }

  play(active)
  play(inactive)

  if (Number.isFinite(active.currentTime) && Math.abs(active.currentTime - inactive.currentTime) > 0.08) {
    inactive.currentTime = active.currentTime
  }
}

export function LiveGloryVideo() {
  const { theme } = useTheme()
  const lightRef = useRef<HTMLVideoElement>(null)
  const darkRef = useRef<HTMLVideoElement>(null)
  const themeKey: ThemeKey = theme === 'dark' ? 'dark' : 'light'

  const videos = useMemo(
    () => [
      { key: 'light' as const, ref: lightRef, label: 'Light mode live Port Daddy run' },
      { key: 'dark' as const, ref: darkRef, label: 'Dark mode live Port Daddy run' },
    ],
    [],
  )

  useEffect(() => {
    const active = themeKey === 'dark' ? darkRef.current : lightRef.current
    const inactive = themeKey === 'dark' ? lightRef.current : darkRef.current
    syncVideoPair(active, inactive)

    const interval = window.setInterval(() => syncVideoPair(active, inactive), 900)
    return () => window.clearInterval(interval)
  }, [themeKey])

  return (
    <figure className="grid gap-[var(--space-3)]" aria-labelledby="live-glory-video-title">
      <div
        className="relative overflow-hidden rounded-[var(--radius-md)] border"
        style={{
          background: 'var(--surface-raised)',
          borderColor: 'var(--border-strong)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="relative aspect-[4/3] w-full bg-[var(--surface-base)]">
          {videos.map(({ key, ref, label }) => {
            const isActive = key === themeKey
            return (
              <video
                aria-hidden={!isActive}
                autoPlay
                className={[
                  'absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
                  isActive ? 'opacity-100' : 'opacity-0',
                ].join(' ')}
                key={key}
                loop
                muted
                playsInline
                poster={liveGloryVideos[key].poster}
                preload="auto"
                ref={ref}
                title={label}
              >
                <source src={liveGloryVideos[key].src} type="video/mp4" />
              </video>
            )
          })}
        </div>
      </div>

      <figcaption id="live-glory-video-title" className="sr-only">
        Terminal output opens FleetBar, then the Fleet Control Center.
      </figcaption>
    </figure>
  )
}
