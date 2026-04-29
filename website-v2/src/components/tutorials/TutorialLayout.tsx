import * as React from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Clock, Trophy } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { TutorialProgress, useTutorialProgress } from './TutorialProgress'
import { ReorientationPanel } from './ReorientationPanel'
import { useTutorialState } from '@/hooks/useTutorialState'
import {
  BracketLabel,
  BracketLink,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'

const NAV_HEIGHT = '76px'

interface TutorialLayoutProps {
  title: string
  description: string
  number: number | string
  total?: number | string
  level: 'Beginner' | 'Intermediate' | 'Advanced'
  readTime: string
  children: React.ReactNode
  prev?: { title: string; href: string }
  next?: { title: string; href: string }
}

function levelTone(level: TutorialLayoutProps['level']) {
  if (level === 'Beginner') return 'accent'
  if (level === 'Intermediate') return 'default'
  return 'primary'
}

export function TutorialLayout({
  title,
  description,
  number,
  level,
  readTime,
  children,
  prev,
  next,
}: TutorialLayoutProps) {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  })

  const { markComplete } = useTutorialProgress()
  const [showProgress, setShowProgress] = React.useState(false)
  const location = useLocation()

  const numericNumber = typeof number === 'string' ? Number.parseInt(number, 10) : number
  const { hasReturned, dismissReturn } = useTutorialState(numericNumber)
  const tone = levelTone(level)

  React.useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  React.useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY + window.innerHeight
      const height = document.documentElement.scrollHeight
      if (scrolled >= height - 200) {
        markComplete(numericNumber)
      }
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [numericNumber, markComplete])

  return (
    <div
      className="flex min-h-screen flex-col selection:bg-[var(--brand-primary)] selection:text-white"
      style={{ background: 'var(--surface-base)', color: 'var(--text-primary)', paddingTop: NAV_HEIGHT }}
    >
      <motion.div
        className="fixed left-0 right-0 z-[95] h-[3px] origin-left bg-[var(--brand-primary)]"
        style={{ scaleX, top: NAV_HEIGHT }}
      />

      <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-5)] lg:py-[var(--space-6)]">
        <PageContainer width="wide" className="space-y-[var(--space-5)]">
          {hasReturned ? (
            <div className="max-w-[44rem]">
              <ReorientationPanel
                tutorialNumber={numericNumber}
                tutorialTitle={title}
                onDismiss={dismissReturn}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <BracketLink to="/" tone="blue">
              Home
            </BracketLink>
            <BracketLink to="/tutorials" tone="blue">
              Academy
            </BracketLink>
            <BracketLabel className="border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]">
              Lesson {number}
            </BracketLabel>
          </div>

          <div className="grid gap-[var(--space-6)] xl:grid-cols-[minmax(0,0.96fr)_minmax(20rem,0.64fr)] xl:items-start">
            <div className="space-y-[var(--space-4)]">
              <div className="flex flex-wrap items-center gap-[var(--space-3)]">
                <BracketLabel tone={tone}>{level}</BracketLabel>
                <PanelEyebrow>
                  <Clock size={12} className="mr-[var(--space-1)] inline-block" />
                  {readTime}
                </PanelEyebrow>
              </div>

              <div className="space-y-[var(--space-3)]">
                <PanelTitle as="h1" size="section" className="max-w-[12ch]">
                  {title}
                </PanelTitle>
                <PanelBody className="max-w-[38rem]">{description}</PanelBody>
              </div>
            </div>

            <TutorialProgress
              currentNumber={numericNumber}
              isOpen={showProgress}
              onToggle={() => setShowProgress((open) => !open)}
            />
          </div>
        </PageContainer>
      </section>

      <main id="main-content" className="flex-1 py-[var(--space-6)] lg:py-[var(--space-7)]">
        <PageContainer width="wide">
          <div className="mx-auto w-full max-w-[94rem]">
            <article
              className="prose max-w-none
              prose-headings:font-display prose-headings:font-black prose-headings:tracking-[var(--tracking-display-tight)] prose-headings:text-[var(--text-primary)]
              prose-h2:mt-[var(--space-7)] prose-h2:mb-[var(--space-3)] prose-h2:border-t-2 prose-h2:border-[var(--border-strong)] prose-h2:pt-[var(--space-4)] prose-h2:text-[length:var(--type-panel-title-card-size)] prose-h2:leading-[var(--leading-card)]
              prose-h3:mt-[var(--space-5)] prose-h3:mb-[var(--space-2)] prose-h3:text-[length:var(--type-panel-title-nav-size)]
              prose-p:my-[var(--space-4)] prose-p:max-w-[52rem] prose-p:text-[length:var(--type-panel-body-size)] prose-p:leading-[var(--leading-body)] prose-p:text-[var(--text-primary)]
              prose-strong:font-bold prose-strong:text-[var(--text-primary)]
              prose-ul:my-[var(--space-4)] prose-ul:max-w-[52rem] prose-ul:space-y-[var(--space-3)] prose-ul:pl-[var(--space-5)]
              prose-ol:my-[var(--space-4)] prose-ol:max-w-[52rem] prose-ol:pl-[var(--space-5)]
              prose-li:text-[length:var(--type-panel-body-size)] prose-li:leading-[var(--leading-body)] prose-li:text-[var(--text-primary)]
              prose-code:rounded-none prose-code:bg-[var(--surface-strong)] prose-code:px-[var(--space-1)] prose-code:py-[2px] prose-code:font-mono prose-code:text-[var(--brand-primary)] prose-code:before:content-none prose-code:after:content-none
              prose-a:text-[var(--brand-primary)] prose-a:no-underline hover:prose-a:text-[var(--text-primary)]
              prose-blockquote:my-[var(--space-5)] prose-blockquote:max-w-[52rem] prose-blockquote:border-l-2 prose-blockquote:border-[var(--brand-primary)] prose-blockquote:bg-transparent prose-blockquote:px-[var(--space-4)] prose-blockquote:py-0 prose-blockquote:italic prose-blockquote:text-[var(--text-primary)]
              [&_.code-block-wrapper]:my-[var(--space-5)] [&_.code-block-wrapper]:max-w-[52rem] [&_.code-block-wrapper]:shadow-[var(--shadow-flat)]
              [&_.not-prose_.code-block-wrapper]:max-w-none"
            >
              {children}
            </article>

            <nav className="mt-[var(--space-9)] grid gap-[var(--space-4)] border-t-2 border-[var(--border-strong)] pt-[var(--space-6)] md:grid-cols-2">
              {prev ? (
                <Link to={prev.href} className="block no-underline">
                  <SurfacePanel elevation="quiet" padding="compact" className="h-full space-y-[var(--space-3)] hover:bg-[var(--interactive-hover)]">
                    <PanelEyebrow>
                      <ArrowLeft size={12} className="mr-[var(--space-1)] inline-block" />
                      Previous
                    </PanelEyebrow>
                    <PanelTitle as="h4" size="nav" className="max-w-none">
                      {prev.title}
                    </PanelTitle>
                  </SurfacePanel>
                </Link>
              ) : (
                <div />
              )}

              {next ? (
                <Link to={next.href} className="block no-underline">
                  <SurfacePanel tone="blue" padding="compact" className="h-full space-y-[var(--space-3)]">
                    <PanelEyebrow tone="primary">
                      Next
                      <ArrowRight size={12} className="ml-[var(--space-1)] inline-block" />
                    </PanelEyebrow>
                    <PanelTitle as="h4" size="nav" tone="primary" className="max-w-none">
                      {next.title}
                    </PanelTitle>
                  </SurfacePanel>
                </Link>
              ) : (
                <SurfacePanel tone="lime" padding="compact" className="md:col-span-2 space-y-[var(--space-3)]">
                  <div className="flex items-center gap-[var(--space-2)]">
                    <Trophy size={18} className="text-[var(--brand-accent-foreground)]" />
                    <PanelEyebrow tone="accent">Series complete</PanelEyebrow>
                  </div>
                  <PanelTitle as="h4" size="nav" tone="accent" className="max-w-none">
                    Mastery achieved
                  </PanelTitle>
                  <PanelBody tone="accent" size="compact" className="max-w-[34rem]">
                    You completed the core lesson sequence and can move into the broader docs and operator surfaces.
                  </PanelBody>
                </SurfacePanel>
              )}
            </nav>
          </div>
        </PageContainer>
      </main>

      <Footer />
    </div>
  )
}
