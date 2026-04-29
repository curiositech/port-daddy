import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { COOKBOOK_RECIPES } from "@/data/cookbook";
import { Footer } from "@/components/layout/Footer";

const CATEGORY_LABELS = {
  coordination: "Coordination",
  scaling: "Scaling",
  resilience: "Resilience",
  security: "Security",
} as const;

export function CookbookPage() {
  return (
    <motion.div
      className="flex min-h-screen flex-col bg-[var(--surface-base)] font-sans text-[var(--text-primary)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <header className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-4)] py-[var(--section-space-y)] sm:px-[var(--space-6)] lg:px-[var(--space-8)]">
        <div className="mx-auto grid max-w-7xl gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.9fr)_minmax(18rem,0.45fr)] lg:items-end">
          <div>
            <h1 className="m-[var(--space-0)] max-w-[12ch] font-display text-[length:var(--type-hero-size)] font-black leading-[var(--leading-display-tight)] tracking-[var(--tracking-display-tight)]">
              Port Daddy Cookbook
            </h1>
            <p className="mt-[var(--space-5)] max-w-[46rem] text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
              Concrete coordination recipes for agent work: locks, inboxes,
              ports, salvage, topology, and handoff state that survives beyond a
              terminal tab.
            </p>
          </div>
          <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)]">
            <p className="m-[var(--space-0)] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)]">
              Use a recipe when the team already knows the primitive and needs
              the failure mode nailed down.
            </p>
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-7xl flex-1 px-[var(--space-4)] py-[var(--section-space-y)] font-sans sm:px-[var(--space-6)] lg:px-[var(--space-8)]"
      >
        <div className="grid gap-[var(--space-5)] sm:grid-cols-2">
          {COOKBOOK_RECIPES.map((recipe, i) => (
            <motion.article
              key={recipe.id}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.03 }}
              className="group border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] transition-colors hover:bg-[var(--interactive-hover)]"
            >
              <Link
                to={`/cookbook/${recipe.id}`}
                className="grid h-full gap-[var(--space-5)] p-[var(--space-5)] no-underline sm:p-[var(--space-6)]"
              >
                <div className="flex items-center justify-between gap-[var(--space-4)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
                  <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                    {CATEGORY_LABELS[recipe.category]}
                  </span>
                  <span className="font-mono text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>

                <div className="grid gap-[var(--space-3)]">
                  <h2 className="m-[var(--space-0)] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] tracking-[var(--tracking-display-card)] text-[var(--text-primary)]">
                    {recipe.title}
                  </h2>
                  <p className="m-[var(--space-0)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    {recipe.description}
                  </p>
                </div>

                <span className="self-end font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                  Open recipe
                </span>
              </Link>
            </motion.article>
          ))}
        </div>

        <section className="mt-[var(--section-space-y)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-6)] sm:p-[var(--space-8)]">
          <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)] lg:items-start">
            <h2 className="m-[var(--space-0)] font-display text-[length:var(--type-panel-title-display-size)] font-black leading-[var(--leading-display)] tracking-[var(--tracking-display-tight)]">
              Recipes are contracts, not vibes.
            </h2>
            <p className="m-[var(--space-0)] text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
              Each cookbook entry should explain the coordination invariant, the
              Port Daddy primitive that enforces it, and the recovery behavior
              when an agent crashes or another process races the same resource.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </motion.div>
  );
}
