import * as React from "react";
import { motion, useScroll, useSpring } from "framer-motion";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { TutorialProgress } from "./TutorialProgress";
import { ReorientationPanel } from "./ReorientationPanel";
import { Footer } from "@/components/layout/Footer";
import { useTutorialState } from "@/hooks/useTutorialState";
import { useTutorialProgress } from "@/hooks/useTutorialProgress";
import { TerminalGif } from "@/components/site/TerminalGif";
import { findTerminalRecording } from "@/data/terminalRecordings";

// Nav height matches the h-16 (4rem / 64px) used in Nav.tsx
const NAV_HEIGHT = "4rem";

interface TutorialLayoutProps {
  title: string;
  description: string;
  number: number | string;
  total?: number | string;
  level?: "Beginner" | "Intermediate" | "Advanced";
  readTime: string;
  children: React.ReactNode;
  prev?: { title: string; href: string };
  next?: { title: string; href: string };
}

function tutorialHeaderMeta(readTime: string) {
  return `${readTime} read`;
}

export function TutorialLayout({
  title,
  description,
  number,
  readTime,
  children,
  prev,
  next,
}: TutorialLayoutProps) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  const { markComplete } = useTutorialProgress();
  const [showProgress, setShowProgress] = React.useState(false);
  const location = useLocation();
  const recording = findTerminalRecording(location.pathname);

  const numericNumber =
    typeof number === "string" ? parseInt(number, 10) : number;
  const { hasReturned, dismissReturn } = useTutorialState(numericNumber);

  // Scroll to top when navigating between tutorials
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Mark as complete when reaching bottom
  React.useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY + window.innerHeight;
      const height = document.documentElement.scrollHeight;
      if (scrolled >= height - 200) {
        markComplete(numericNumber);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [numericNumber, markComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen font-sans flex flex-col selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
      style={{
        background: "var(--surface-base)",
        color: "var(--text-primary)",
        paddingTop: NAV_HEIGHT,
      }}
    >
      {/* Progress Bar */}
      <motion.div
        className="fixed left-0 right-0 top-0 z-[100] h-1 origin-left bg-[var(--brand-primary)]"
        style={{ scaleX, top: NAV_HEIGHT }}
      />

      {/* Hero Section */}
      <motion.section className="relative shrink-0 overflow-hidden border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-4)] py-[var(--section-space-y)] sm:px-[var(--space-6)] lg:px-[var(--space-8)]">
        <motion.div className="max-w-4xl mx-auto relative z-10 text-center flex flex-col items-center">
          {/* Reorientation Panel for returning users */}
          {hasReturned && (
            <ReorientationPanel
              tutorialNumber={
                typeof number === "string" ? parseInt(number, 10) : number
              }
              tutorialTitle={title}
              onDismiss={dismissReturn}
            />
          )}

          <motion.nav className="mb-[var(--space-5)] flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
            <Link
              to="/"
              className="font-sans no-underline transition-colors hover:text-[var(--text-primary)]"
            >
              Home
            </Link>
            <span aria-hidden="true">/</span>
            <Link
              to="/tutorials"
              className="font-sans no-underline transition-colors hover:text-[var(--text-primary)]"
            >
              Academy
            </Link>
            <span aria-hidden="true">/</span>
            <motion.span className="font-sans font-black text-[var(--brand-primary)]">
              Lesson {number}
            </motion.span>
          </motion.nav>

          {/* Tutorial Progress Tracker */}
          <div className="mb-[var(--space-6)] w-full">
            <TutorialProgress
              currentNumber={
                typeof number === "string" ? parseInt(number, 10) : number
              }
              isOpen={showProgress}
              onToggle={() => setShowProgress(!showProgress)}
            />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center"
          >
            <motion.div className="mb-[var(--space-6)] flex flex-wrap items-center justify-center gap-[var(--space-3)] font-sans">
              <motion.span className="border border-[var(--border-default)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                Lesson {number}
              </motion.span>
              <motion.span className="border border-[var(--border-default)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                {tutorialHeaderMeta(readTime)}
              </motion.span>
            </motion.div>

            <motion.h1 className="mb-[var(--space-6)] font-display text-[length:var(--type-hero-size)] font-black leading-[var(--leading-display-tight)] tracking-[var(--tracking-display-tight)] text-[var(--text-primary)]">
              {title}
            </motion.h1>
            <motion.p className="mx-auto max-w-3xl font-sans text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
              {description}
            </motion.p>
            {recording ? (
              <TerminalGif
                src={recording.gifSrc}
                title={recording.title}
                caption={recording.caption}
                className="mt-[var(--space-7)] w-full max-w-4xl text-left"
              />
            ) : null}
          </motion.div>
        </motion.div>
      </motion.section>

      {/* Main Content Area */}
      <motion.main
        id="main-content"
        className="relative mx-auto w-full max-w-4xl flex-1 px-[var(--space-4)] py-[var(--section-space-y)] font-sans sm:px-[var(--space-6)] lg:px-[var(--space-8)]"
      >
        <motion.article
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="tutorial-article prose prose-lg max-w-none
            prose-headings:font-display prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-[var(--text-primary)]
            prose-h2:mt-[var(--section-space-y)] prose-h2:mb-[var(--space-6)] prose-h2:border-b prose-h2:border-[var(--border-subtle)] prose-h2:pb-[var(--space-3)] prose-h2:text-[length:var(--type-section-title-size)]
            prose-h3:mt-[var(--space-8)] prose-h3:mb-[var(--space-4)] prose-h3:text-[length:var(--type-panel-title-card-size)]
            prose-p:mb-[var(--space-5)] prose-p:text-[length:var(--type-panel-body-size)] prose-p:leading-[var(--leading-body)] prose-p:text-[var(--text-secondary)]
            prose-code:bg-[var(--interactive-active)] prose-code:px-[var(--space-1)] prose-code:py-[var(--space-1)] prose-code:font-mono prose-code:font-bold prose-code:text-[var(--brand-primary)] prose-code:before:content-none prose-code:after:content-none
            prose-strong:text-[var(--text-primary)] prose-strong:font-black
            prose-ul:mb-[var(--space-6)] prose-ul:list-disc prose-ul:space-y-[var(--space-3)] prose-ul:pl-[var(--space-6)]
            prose-li:text-[length:var(--type-panel-body-size)] prose-li:text-[var(--text-secondary)]
            prose-blockquote:border-l-4 prose-blockquote:border-[var(--brand-primary)] prose-blockquote:bg-[var(--surface-raised)] prose-blockquote:px-[var(--space-6)] prose-blockquote:py-[var(--space-4)] prose-blockquote:italic"
        >
          {children}
        </motion.article>

        {/* Lessons Navigation */}
        <motion.nav className="mb-[var(--space-8)] mt-[var(--section-space-y)] grid gap-[var(--space-5)] border-t-2 border-[var(--border-strong)] pt-[var(--space-6)] font-sans sm:grid-cols-2">
          {prev ? (
            <Link to={prev.href} className="group no-underline block">
              <motion.div
                className="flex h-full flex-col items-start gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)] transition-colors duration-200 hover:bg-[var(--interactive-hover)] sm:p-[var(--space-6)] lg:p-[var(--space-7)]"
                whileHover={{ x: -8 }}
              >
                <motion.span className="flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)] transition-colors group-hover:text-[var(--brand-primary)]">
                  Previous
                </motion.span>
                <motion.h4 className="m-[var(--space-0)] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
                  {prev.title}
                </motion.h4>
              </motion.div>
            </Link>
          ) : (
            <motion.div />
          )}

          {next ? (
            <Link to={next.href} className="group no-underline block">
              <motion.div
                className="flex h-full flex-col items-end gap-[var(--space-4)] border-2 border-[var(--brand-primary)] bg-[var(--surface-raised)] p-[var(--space-5)] text-right transition-colors duration-200 hover:bg-[var(--interactive-hover)] sm:p-[var(--space-6)] lg:p-[var(--space-7)]"
                whileHover={{ x: 8 }}
              >
                <motion.span className="flex items-center justify-end gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                  Next Up
                </motion.span>
                <motion.h4 className="m-[var(--space-0)] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
                  {next.title}
                </motion.h4>
              </motion.div>
            </Link>
          ) : (
            <motion.div className="relative flex flex-col items-center gap-[var(--space-6)] overflow-hidden border-2 border-dashed border-[var(--brand-primary)] bg-[var(--surface-overlay)] p-[var(--space-5)] text-center sm:col-span-2 sm:p-[var(--space-7)] lg:p-[var(--space-8)]">
              <span className="border border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-6)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                Certification Ready
              </span>
              <motion.h3 className="m-[var(--space-0)] font-display text-[length:var(--type-section-title-size)] font-bold text-[var(--text-primary)]">
                Mastery Achieved.
              </motion.h3>
              <motion.p className="max-w-xl font-sans text-[length:var(--type-panel-body-size)] text-[var(--text-secondary)]">
                You've completed the core coordination series. Your harbor is
                ready for deployment.
              </motion.p>
              <Button
                size="lg"
                className="px-[var(--space-6)] py-[var(--space-4)] text-[length:var(--type-panel-body-size)] font-black tracking-[var(--tracking-meta)]"
                onClick={() => (window.location.href = "/docs")}
              >
                EXPLORE THE SDK REFERENCE
              </Button>
            </motion.div>
          )}
        </motion.nav>
      </motion.main>

      <Footer />
    </motion.div>
  );
}
