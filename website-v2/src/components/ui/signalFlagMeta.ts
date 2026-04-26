export type FlagName = 'charlie' | 'november' | 'kilo' | 'uniform' | 'victor' | 'lima'

export interface SignalFlagMeta {
  name: string
  letter: string
  meaning: string
  usedFor: string
}

export const SIGNAL_FLAG_META: Record<FlagName, SignalFlagMeta> = {
  charlie: {
    name: 'Charlie',
    letter: 'C',
    meaning: 'Affirmative',
    usedFor: 'Success, acquired, completed',
  },
  november: {
    name: 'November',
    letter: 'N',
    meaning: 'Negative',
    usedFor: 'Errors, failures',
  },
  kilo: {
    name: 'Kilo',
    letter: 'K',
    meaning: 'Ready to communicate',
    usedFor: 'Listening, standby, ready',
  },
  uniform: {
    name: 'Uniform',
    letter: 'U',
    meaning: 'Danger ahead',
    usedFor: 'Warnings, conflicts',
  },
  victor: {
    name: 'Victor',
    letter: 'V',
    meaning: 'Require assistance',
    usedFor: 'Mayday, help needed',
  },
  lima: {
    name: 'Lima',
    letter: 'L',
    meaning: 'Stop immediately',
    usedFor: 'Stop, halt, blocked',
  },
}
