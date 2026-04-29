import { motion, useScroll, useSpring } from "framer-motion";
import { Link, Navigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { COOKBOOK_RECIPES } from "@/data/cookbook";
import { Footer } from "@/components/layout/Footer";

const CATEGORY_LABELS = {
  coordination: "Coordination",
  scaling: "Scaling",
  resilience: "Resilience",
  security: "Security",
} as const;

export function RecipePage() {
  const { id } = useParams<{ id: string }>();
  const recipe = COOKBOOK_RECIPES.find((r) => r.id === id);
  const { scrollYProgress } = useScroll();

  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  if (!recipe) return <Navigate to="/cookbook" replace />;

  return (
    <motion.div
      className="flex min-h-screen flex-col bg-[var(--surface-base)] font-sans text-[var(--text-primary)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div
        className="fixed left-0 right-0 top-0 z-[100] h-1 origin-left bg-[var(--brand-primary)]"
        style={{ scaleX, top: "var(--nav-height)" }}
      />

      <header className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-4)] py-[var(--section-space-y)] sm:px-[var(--space-6)] lg:px-[var(--space-8)]">
        <div className="mx-auto grid max-w-4xl gap-[var(--space-6)]">
          <Link
            to="/cookbook"
            className="w-fit font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)] no-underline transition-colors hover:text-[var(--brand-primary)]"
          >
            Back to cookbook
          </Link>

          <div className="grid gap-[var(--space-4)]">
            <div className="flex flex-wrap items-center gap-[var(--space-3)]">
              <span className="border border-[var(--border-default)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                {CATEGORY_LABELS[recipe.category]}
              </span>
              <span className="border border-[var(--border-default)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                Cookbook recipe
              </span>
            </div>

            <motion.h1
              className="m-[var(--space-0)] font-display text-[length:var(--type-hero-size)] font-black leading-[var(--leading-display-tight)] tracking-[var(--tracking-display-tight)]"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            >
              {recipe.title}
            </motion.h1>

            <motion.p
              className="m-[var(--space-0)] max-w-3xl text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.08 }}
            >
              {recipe.description}
            </motion.p>
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-4xl flex-1 px-[var(--space-4)] py-[var(--section-space-y)] font-sans sm:px-[var(--space-6)] lg:px-[var(--space-8)]"
      >
        <motion.article
          className="grid gap-[var(--space-7)]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.12 }}
        >
          <ReactMarkdown
            components={{
              h2({ children }) {
                return (
                  <h2 className="m-[var(--space-0)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)] font-display text-[length:var(--type-section-title-size)] font-black leading-[var(--leading-display)] tracking-[var(--tracking-display-tight)] text-[var(--text-primary)]">
                    {children}
                  </h2>
                );
              },
              h3({ children }) {
                return (
                  <h3 className="m-[var(--space-0)] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] tracking-[var(--tracking-display-card)] text-[var(--text-primary)]">
                    {children}
                  </h3>
                );
              },
              p({ children }) {
                return (
                  <p className="m-[var(--space-0)] text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
                    {children}
                  </p>
                );
              },
              ul({ children }) {
                return (
                  <ul className="m-[var(--space-0)] grid gap-[var(--space-3)] border-l-4 border-[var(--brand-primary)] pl-[var(--space-5)] text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
                    {children}
                  </ul>
                );
              },
              li({ children }) {
                return <li className="pl-[var(--space-1)]">{children}</li>;
              },
              strong({ children }) {
                return (
                  <strong className="font-black text-[var(--text-primary)]">
                    {children}
                  </strong>
                );
              },
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || "");
                const code = String(children).replace(/\n$/, "");

                if (!className) {
                  return (
                    <code
                      className="bg-[var(--interactive-active)] px-[var(--space-1)] py-[var(--space-1)] font-mono font-bold text-[var(--brand-primary)]"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }

                return (
                  <CodeBlock language={match?.[1] ?? "bash"} copyable={false}>
                    {code}
                  </CodeBlock>
                );
              },
            }}
          >
            {recipe.body}
          </ReactMarkdown>
        </motion.article>

        <section className="mt-[var(--section-space-y)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-6)]">
          <h2 className="m-[var(--space-0)] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
            Recovery invariant
          </h2>
          <p className="mt-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
            A cookbook recipe is only useful if another agent can inspect the
            same state afterward. Prefer commands that leave notes, claims,
            locks, inbox messages, or salvage evidence in Port Daddy.
          </p>
        </section>
      </main>

      <Footer />
    </motion.div>
  );
}
