import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@/lib/theme'
import { SiteHeader } from './SiteHeader'

const meta = {
  title: 'Site/Header',
  component: SiteHeader,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <MemoryRouter>
        <ThemeProvider>
          <div style={{ minHeight: '120px', background: 'var(--surface-base)' }}>
            <Story />
          </div>
        </ThemeProvider>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof SiteHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
