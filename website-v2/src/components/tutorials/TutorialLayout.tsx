import * as React from "react";
import { motion, useScroll, useSpring } from "framer-motion";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BracketLabel, PageContainer, PanelBody, PanelEyebrow, PanelTitle } from "@/components/site/primitives";
import { TutorialProgress } from "./TutorialProgress";
import { ReorientationPanel } from "./ReorientationPanel";
import { Footer } from "@/components/layout/Footer";
import { useTutorialState } from "@/hooks/useTutorialState";
import { useTutorialProgress } from "@/hooks/useTutorialProgress";
import { TerminalGif } from "@/components/site/TerminalGif";
import { findTerminalRecording } from "@/data/terminalRecordings";

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
  const normalizedReadTime = readTime.replace(/\\s*read\\s*$/i, "").trim();
  return normalizedReadTime + " reading time";
}

export function TutorialLayout({ title, description, number, readTime, children, prev, next }: TutorialLayoutProps) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 });
  const { markComplete } = useTutorialProgress();
  const [showProgress, setShowProgress] = React.useState(false);
  const location = useLocation();
  const recording = findTerminalRecording(location.pathname);
  const numericNumber = typeof number === "string" ? parseInt(number, 10) : number;
  const { hasReturned, dismissReturn } = useTutorialState(numericNumber);

  React.useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  React.useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY + window.innerHeight;
      const height = document.documentElement.scrollHeight;
      if (scrolled >= height - 200) { markComplete(numericNumber); }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [numericNumber, markComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex min-h-screen flex-col bg-[var(--surface-base)] font-sans text-[var(--text-primary)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
      style={{ paddingTop: NAV_HEIGHT }}
    >
      <motion.div
        className="fixed left-0 right-0 z-[100] h-1 origin-left bg-[var(--brand-primary)]"
        style={{ scaleX, top: NAV_HEIGHT }}
      />

      <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-6)] lg:py-[var(--space-7)]">
        <PageContainer width="wide">
          <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.62fr)_minmax(18rem,0.38fr)] lg:items-start">
            <div className="space-y-[var(--space-5)]">
              <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                <Link to="/" className="transition-colors hover:text-[var(--text-primary)]">Home</Link>
                <span aria-hidden="true">/</span>
                <Link to="/tutorials" className="transition-colors hover:text-[var(--text-primary)]">Academy</Link>
                <span aria-hidden="true">/</span>
                <span className="text-[var(--brand-primary)]">Lesson {number}</span>
              </nav>

              {hasReturned && (
                <ReorientationPanel
                  tutorialNumber={typeof number === "string" ? parseInt(number, 10) : number}
                  tutorialTitle={title}
                  onDismiss={dismissReturn}
                />
              )}

              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <BracketLabel>Lesson {number}</BracketLabel>
                <BracketLabel>{tutorialHeaderMeta(readTime)}</BracketLabel>
              </div>

              <PanelTitle as="h1" size="hero" className="max-w-[18ch]">{title}</PanelTitle>

              <PanelBody size="default" className="max-w-[60ch] text-[length:var(--text-lg)]">{description}</PanelBody>
            </div>

            <aside className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
              <TutorialProgress
                currentNumber={typeof number === "string" ? parseInt(number, 10) : number}
                isOpen={showProgress}
                onToggle={() => setShowProgress(!showProgress)}
              />
            </aside>
          </div>

          {recording ? (
            <TerminalGif src={recording.gifSrc} title={recording.title} caption={recording.caption} className="mt-[var(--space-6)] w-full" />
          ) : null}
        </PageContainer>
      </section>

      <main id="main-content" className="flex-1 py-[var(--space-6)] lg:py-[var(--space-7)]">
        <PageContainer width="wide">
          <div className="grid gap-[var(--space-5)] lg:grid-cols-12">
            <article className="lg:col-span-8 lg:col-start-3">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="tutorial-article prose prose-lg max-w-none prose-headings:font-display prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-[var(--text-primary)] prose-h2:mt-[var(--space-7)] prose-h2:mb-[var(--space-5)] prose-h2:border-b-2 prose-h2:border-[var(--border-strong)] prose-h2:pb-[var(--space-3)] prose-h2:text-[length:var(--type-section-title-size)] prose-h3:mt-[var(--space-6)] prose-h3:mb-[var(--space-4)] prose-h3:text-[length:var(--type-panel-title-card-size)] prose-p:mb-[var(--space-4)] prose-p:text-[length:var(--type-panel-body-size)] prose-p:leading-[var(--leading-body)] prose-p:text-[var(--text-secondary)] prose-code:bg-[var(--interactive-active)] prose-code:px-[var(--space-1)] prose-code:py-[2px] prose-code:font-mono prose-code:font-bold prose-code:text-[var(--brand-primary)] prose-code:before:content-none prose-code:after:content-none prose-strong:text-[var(--text-primary)] prose-strong:font-black prose-ul:mb-[var(--space-5)] prose-ul:list-disc prose-ul:space-y-[var(--space-2)] prose-ul:pl-[var(--space-6)] prose-li:text-[length:var(--type-panel-body-size)] prose-li:text-[var(--text-secondary)] prose-table:my-[var(--space-5)] prose-table:w-full prose-table:border-collapse prose-table:font-sans prose-table:text-[length:var(--type-panel-body-compact-size)] prose-thead:border-b-2 prose-thead:border-[var(--border-strong)] prose-th:pb-[var(--space-3)] prose-th:pr-[var(--space-4)] prose-th:text-left prose-th:font-sans prose-th:text-[length:var(--type-meta-size)] prose-th:font-black prose-th:uppercase prose-th:tracking-[var(--tracking-meta)] prose-th:text-[var(--text-muted)] prose-td:border-t prose-td:border-[var(--border-default)] prose-td:py-[var(--space-3)] prose-td:pr-[var(--space-4)] prose-td:align-top prose-td:text-[length:var(--type-panel-body-compact-size)] prose-td:leading-[var(--leading-body-compact)] prose-td:text-[var(--text-secondary)] prose-blockquote:border-l-2 prose-blockquote:border-[var(--brand-primary)] prose-blockquote:bg-[var(--surface-raised)] prose-blockquote:px-[var(--space-5)] prose-blockquote:py-[var(--space-3)] prose-blockquote:not-italic prose-blockquote:text-[var(--text-primary)]"
              >
                {children}
              </motion.div>
            </article>
          </div>
        </PageContainer>
      </main>

      <section className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-6)] lg:py-[var(--space-7)]">
        <PageContainer width="wide">
          <nav aria-label="Lesson pager" className="grid gap-[var(--space-4)] sm:grid-cols-2">
            {prev ? (
              <Link to={prev.href} className="group flex h-full flex-col items-start gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] sm:p-[var(--space-6)]">
                <PanelEyebrow className="inline-flex items-center gap-[var(--space-2)] transition-colors group-hover:text-[var(--brand-primary)]">
                  <ArrowLeft size={12} aria-hidden="true" /> Previous lesson
                </PanelEyebrow>
                <PanelTitle as="h4" size="card" className="max-w-none">{prev.title}</PanelTitle>
              </Link>
            ) : (
              <span aria-hidden="true" />
            )}

            {next ? (
              <Link to={next.href} className="group flex h-full flex-col items-end gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] p-[var(--space-5)] text-right text-[var(--brand-primary-foreground)] transition-colors hover:bg-[var(--text-primary)] hover:text-[var(--text-inverse)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] sm:p-[var(--space-6)]">
                <BracketLabel tone="primary" className="self-end inline-flex items-center gap-[var(--space-2)]">
                  Next up <ArrowRight size={12} aria-hidden="true" />
                </BracketLabel>
                <PanelTitle as="h4" size="card" tone="primary" className="max-w-none">{next.title}</PanelTitle>
              </Link>
            ) : (
              <div className="grid gap-[var(--space-4)] border-2 border-dashed border-[var(--brand-primary)] bg-[var(--surface-base)] p-[var(--space-5)] sm:col-span-2 sm:p-[var(--space-6)]">
                <BracketLabel className="self-start">End of the syllabus</BracketLabel>
                <PanelTitle as="h3" size="section" className="max-w-[18ch]">Through the curriculum, top to bottom.</PanelTitle>
                <PanelBody className="max-w-[60ch]">Every lesson — from claiming the first port to running a fleet of background agents against your repo — is now in your back pocket. The SDK reference is where the loose ends get tied off.</PanelBody>
                <Button type="button" variant="primary" size="lg" onClick={() => (window.location.href = "/docs")} className="self-start">
                  Open the SDK reference
                </Button>
              </div>
            )}
          </nav>
        </PageContainer>
      </section>

      <Footer />
    </motion.div>
  );
}
