import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@/lib/theme'
import { PageContainer, PanelBody, PanelTitle, SurfacePanel } from './primitives'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

const meta = {
  title: 'Site/Header',
  component: SiteHeader,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <ThemeProvider>
        <div className="min-h-[var(--space-10)] bg-[var(--surface-base)] text-[var(--text-primary)]">
          <Story />
        </div>
      </ThemeProvider>
    ),
  ],
} satisfies Meta<typeof SiteHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <MemoryRouter initialEntries={['/mcp']}>
      <SiteHeader />
    </MemoryRouter>
  ),
}

export const ShellFrame: Story = {
  parameters: {
    layout: 'fullscreen',
    a11y: {
      test: 'error',
    },
  },
  render: () => (
    <MemoryRouter initialEntries={['/docs']}>
      <SiteHeader />
      <main id="main-content" className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)]">
        <PageContainer width="wide">
          <SurfacePanel className="space-y-[var(--space-3)]">
            <PanelTitle as="h1" size="display">
              Unified public shell
            </PanelTitle>
            <PanelBody className="max-w-[var(--measure-copy)]">
              Header, skip link, search, active navigation, theme action, and footer use the same public primitive
              system across marketing and docs routes.
            </PanelBody>
          </SurfacePanel>
        </PageContainer>
      </main>
      <SiteFooter />
    </MemoryRouter>
  ),
}

export const StateMatrix: Story = {
  parameters: {
    layout: 'fullscreen',
    a11y: {
      test: 'error',
    },
  },
  render: () => (
    <div className="grid gap-[var(--space-6)] bg-[var(--surface-base)] pb-[var(--space-6)] text-[var(--text-primary)]">
      <MemoryRouter initialEntries={['/']}>
        <SiteHeader />
      </MemoryRouter>
      <MemoryRouter initialEntries={['/docs']}>
        <SiteHeader />
      </MemoryRouter>
      <MemoryRouter initialEntries={['/mcp']}>
        <SiteHeader />
      </MemoryRouter>
      <MemoryRouter initialEntries={['/blog']}>
        <SiteHeader />
        <SiteFooter />
      </MemoryRouter>
    </div>
  ),
}
