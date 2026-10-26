import * as Popover from '@radix-ui/react-popover'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTheme, type ThemePreference } from '@/lib/theme-context'

const options = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const

export function AppearanceControl() {
  const { preference, setPreference } = useTheme()
  const current = options.find(option => option.value === preference) ?? options[0]
  const Icon = current.Icon
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Appearance: ${current.label}`}>
          <Icon size={16} aria-hidden="true" />
          <span className="hidden sm:inline">{current.label}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} collisionPadding={12} className="z-[80] w-52 max-w-[calc(100vw-1.5rem)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] text-[var(--text-primary)]">
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]">Appearance</legend>
            {options.map(({ value, label, Icon: OptionIcon }) => (
              <label key={value} className={`appearance-option flex min-h-11 cursor-pointer items-center gap-[var(--space-2)] border-2 px-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] ${preference === value ? 'border-[var(--border-strong)] bg-[var(--surface-strong)]' : 'border-transparent hover:bg-[var(--surface-strong)]'}`}>
                <input type="radio" name="site-appearance" value={value} checked={preference === value} onChange={() => setPreference(value as ThemePreference)} />
                <OptionIcon size={16} aria-hidden="true" />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
