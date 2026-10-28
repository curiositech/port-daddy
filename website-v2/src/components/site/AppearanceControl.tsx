import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTheme } from '@/lib/theme-context'

const options = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const

/** Show the current preference; each activation advances System → Light → Dark. */
export function AppearanceControl() {
  const { preference, setPreference } = useTheme()
  const index = Math.max(0, options.findIndex(option => option.value === preference))
  const current = options[index]
  const next = options[(index + 1) % options.length]
  const Icon = current.Icon
  const label = `Appearance: ${current.label}. Switch to ${next.label}`
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="min-h-11 min-w-11 shrink-0"
      aria-label={label}
      title={label}
      onClick={() => setPreference(next.value)}
    >
      <Icon size={16} aria-hidden="true" />
    </Button>
  )
}
