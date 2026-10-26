import { Link, NavLink } from "react-router-dom";
import * as Popover from "@radix-ui/react-popover";
import {
  ChevronDown,
  Github,
  Menu,
  Search,
  X,
} from "lucide-react";
import { DocsSearch } from "@/components/docs/DocsSearch";
import { openDocsSearch } from "@/components/docs/docsSearchEvents";
import { AppearanceControl } from "./AppearanceControl";
import { AccountChip } from "./AccountChip";
import { PageContainer, Wordmark } from "./primitives";
import { useHeroWordmark } from "@/lib/hero-brand-context";

type NavItem = {
  label: string;
  href: string;
  end: boolean;
  badge?: string;
  featured?: boolean;
  className?: string;
  /** Extra classes on this item's row inside the "More" dropdown. */
  menuClassName?: string;
};

const PRIMARY_NAV_ITEMS = [
  { label: "Home", href: "/", end: true },
  { label: "Agent Harness", href: "/harness", end: true },
  { label: "Agent Tubes", href: "/pd-tube", end: false },
  // The book and the research program sit in the primary row: they are the
  // argument the product stands on, and each page links to the other.
  { label: "The Book", href: "/whitepaper", end: true },
  { label: "Research", href: "/research", end: false },
  { label: "Blog", href: "/blog", end: false },
  // The tail of the row folds into "More" until the viewport is ultra-wide:
  // below ~1800px the centered nav otherwise collides with the search box and
  // account chip pinned to the right column (items truncate instead of wrap).
  {
    label: "Cryptography",
    href: "/security",
    end: false,
    className: "hidden min-[1800px]:inline-flex",
    menuClassName: "min-[1800px]:hidden",
  },
  {
    label: "The Big Idea",
    href: "/manifesto",
    end: true,
    className: "hidden min-[1800px]:inline-flex",
    menuClassName: "min-[1800px]:hidden",
  },
] satisfies readonly NavItem[];

// Primary-row items that fold into the "More" dropdown on narrower desktops
// (their menuClassName hides the duplicate row once they are inline again).
const FOLDING_PRIMARY_ITEMS: readonly NavItem[] = PRIMARY_NAV_ITEMS.filter(
  (item) => item.menuClassName,
);

// Secondary destinations live behind the "More" dropdown to keep the top bar
// uncrowded. Docs, Scout and Examples dropped out of the primary row but stay
// reachable here.
const OVERFLOW_NAV_ITEMS = [
  { label: "Docs", href: "/docs", end: false },
  { label: "Mac app", href: "/mac-preview", end: false },
  // Install is the one thing a first visit is usually trying to reach, and it
  // had no entry of its own: you had to know it was a section of the Mac app
  // page. It sits next to that page rather than in the top row, because the
  // top row is already at its width and this is a destination, not a section.
  { label: "Install", href: "/mac-preview#install", end: false },
  { label: "Run agents on your subscription", href: "/cli-backend", end: true },
  { label: "Tutorials", href: "/tutorials", end: false },
  { label: "Scout", href: "/scout", end: false },
  { label: "Examples", href: "/examples", end: false },
  { label: "Landscape", href: "/landscape", end: false },
] satisfies readonly NavItem[];

// Everything the "More" popover lists: folded primary items first (visible
// only while folded), then the permanent overflow set.
const MORE_MENU_ITEMS: readonly NavItem[] = [
  ...FOLDING_PRIMARY_ITEMS,
  ...OVERFLOW_NAV_ITEMS,
];

const NAV_ITEMS: readonly NavItem[] = [
  ...PRIMARY_NAV_ITEMS,
  ...OVERFLOW_NAV_ITEMS,
];

function navItemClass(
  isActive: boolean,
  mobile = false,
  displayClass = "inline-flex",
  featured = false,
) {
  const featuredDesktop = featured && !mobile;

  return [
    displayClass,
    // Padding grows past --space-2 only once the nav is roomy again (the same
    // 1800px threshold where Cryptography/The Big Idea rejoin the primary row)
    // — growing it as early as xl (1280px) ate exactly the width the compact
    // header needs to fit inline nav without colliding with the search box.
    "shrink-0 items-center gap-[var(--space-2)] border-2 px-[var(--space-2)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] min-[1800px]:px-[var(--space-3)]",
    featuredDesktop
      ? "border-[var(--border-strong)] bg-[var(--text-primary)] text-[var(--surface-base)] hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]"
      : isActive
      ? "border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]"
      : mobile
        ? "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-base)] hover:text-[var(--text-primary)]"
        : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]",
  ].join(" ");
}

function PrimaryNavItem({
  item,
  mobile = false,
}: {
  item: NavItem;
  mobile?: boolean;
}) {
  const desktopDisplayClass = item.className ?? "inline-flex";

  if (item.href.includes("#")) {
    return (
      <a
        href={item.href}
        className={navItemClass(
          false,
          mobile,
          mobile ? "inline-flex" : desktopDisplayClass,
          item.featured,
        )}
      >
        {item.label}
      </a>
    );
  }

  return (
    <NavLink
      to={item.href}
      end={item.end}
      className={({ isActive }) =>
        navItemClass(
          isActive,
          mobile,
          mobile ? "inline-flex" : desktopDisplayClass,
          item.featured,
        )
      }
    >
      <span>{item.label}</span>
    </NavLink>
  );
}

function OverflowNavMenu() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-[var(--space-2)] border-2 border-transparent px-[var(--space-2)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] min-[1800px]:px-[var(--space-3)]"
        >
          More
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="center"
          sideOffset={8}
          className="z-[120] grid min-w-[14rem] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] shadow-[var(--shadow-brutal)]"
        >
          {MORE_MENU_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.end}
              className={({ isActive }) =>
                [
                  "flex items-center justify-between gap-[var(--space-3)] border-2 px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]",
                  item.menuClassName ?? "",
                  isActive
                    ? "border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]"
                    : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-base)] hover:text-[var(--text-primary)]",
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// A row in the phone menu's utility group: the same shape as the nav rows
// above it, so search, the repo and the account read as part of one list.
const menuRowClass =
  "flex items-center justify-between gap-[var(--space-3)] border-2 border-[var(--border-default)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]";

function CompressedNavMenu() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] min-[1440px]:hidden"
          aria-label="Open site navigation"
        >
          <Menu size={18} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          // Fifteen rows plus the phone utilities outrun an 812px screen; the
          // list scrolls inside the sheet so the last rows are reachable.
          className="z-[120] grid max-h-[calc(100dvh-5rem)] w-[min(calc(100vw-var(--space-6)),22rem)] content-start overflow-y-auto border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] shadow-[var(--shadow-brutal)]"
        >
          <div className="flex items-center justify-between border-b-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-2)]">
            <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-meta)]">
              Site Menu
            </span>
            <Popover.Close asChild>
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center border-2 border-transparent p-[var(--space-1)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-base)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                aria-label="Close site navigation"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </Popover.Close>
          </div>

          <nav
            aria-label="Compressed primary navigation"
            className="grid gap-[var(--space-1)] pt-[var(--space-2)]"
          >
            {NAV_ITEMS.map((item) => (
              <Popover.Close asChild key={`compressed-${item.href}`}>
                <NavLink
                  to={item.href}
                  end={item.end}
                  className={({ isActive }) =>
                    [
                      "flex items-center justify-between gap-[var(--space-3)] border-2 px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]",
                      isActive
                        ? "border-[var(--border-strong)] bg-[var(--brand-primary)] text-white"
                        : "border-[var(--border-default)] bg-[var(--surface-base)] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)]",
                    ].join(" ")
                  }
                >
                  <span>{item.label}</span>
                </NavLink>
              </Popover.Close>
            ))}
          </nav>

          {/* Below sm the bar is brand, menu and theme only: at 375px the
              search box, the octocat and the account chip pushed the wordmark
              onto two lines under the menu button. They live here instead,
              as rows of the same list, and reappear in the bar from sm up. */}
          <div className="mt-[var(--space-2)] grid gap-[var(--space-1)] border-t-2 border-[var(--border-strong)] pt-[var(--space-2)] sm:hidden">
            <Popover.Close asChild>
              <button type="button" onClick={openDocsSearch} className={menuRowClass}>
                <span>Search the docs</span>
                <Search size={16} aria-hidden="true" />
              </button>
            </Popover.Close>
            <a
              href="https://github.com/curiositech/port-daddy"
              target="_blank"
              rel="noreferrer"
              className={menuRowClass}
            >
              <span>GitHub repository</span>
              <Github size={16} aria-hidden="true" />
            </a>
            <AccountChip variant="row" />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function SiteHeader() {
  const { heroWordmarkVisible } = useHeroWordmark();

  return (
    <>
      <a
        href="#main-content"
        className="sr-only bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] focus:not-sr-only focus:fixed focus:left-[var(--space-4)] focus:top-[var(--space-4)] focus:z-[200] focus:border-2 focus:border-[var(--border-strong)] focus:px-[var(--space-4)] focus:py-[var(--space-2)] focus:font-sans focus:text-[length:var(--type-meta-size)] focus:font-semibold focus:uppercase focus:tracking-[var(--tracking-meta)] focus:outline focus:outline-2 focus:outline-offset-3 focus:outline-[var(--interactive-focus)]"
      >
        Skip to main content
      </a>
      <header
        data-shell="site-header"
        className="sticky top-0 z-50 border-b-2 border-[var(--border-strong)] bg-[var(--surface-base)] relative"
      >
        <PageContainer
          width="wide"
          className="!max-w-none grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[var(--space-2)] py-[var(--space-3)] lg:grid-cols-[minmax(10rem,0.72fr)_minmax(0,auto)_minmax(15rem,0.9fr)] xl:gap-[var(--space-3)]"
        >
          <Link
            to="/"
            aria-label="Port Daddy — home"
            aria-hidden={heroWordmarkVisible || undefined}
            tabIndex={heroWordmarkVisible ? -1 : undefined}
            className={`inline-flex shrink-0 items-center text-[var(--text-primary)] transition-opacity duration-200 ${
              heroWordmarkVisible ? "pointer-events-none opacity-0" : "opacity-100"
            }`}
          >
            {/* Compact wordmark lockup — spinning mark + "Port Daddy". Hidden
                while the hero wordmark is on-screen so the two don't stack. */}
            <Wordmark variant="header" className="h-9 xl:h-10" />
          </Link>

          <nav
            aria-label="Primary"
            className="hidden min-w-0 items-center justify-center gap-[var(--space-2)] min-[1440px]:flex"
          >
            {PRIMARY_NAV_ITEMS.map((item) => (
              <PrimaryNavItem key={item.href} item={item} />
            ))}
            <OverflowNavMenu />
          </nav>

          {/* Pin controls to the last column. Below 1440px the primary nav is
              display:none, so without an explicit column it auto-places into the
              empty middle track and the controls float mid-bar. */}
          <div className="flex min-w-0 items-center justify-end gap-[var(--space-2)] lg:col-start-3">
            <CompressedNavMenu />

            {/* min-w kept modest so the search box shrinks before it can ever
                collide with the centered nav or the account chip — this floor
                is the whole reason inline nav can start below the old 1536px
                cutoff without the compact search box spilling into it. */}
            <div className="hidden min-w-[7rem] max-w-[15rem] flex-1 shrink min-[1440px]:block">
              <DocsSearch variant="compact" />
            </div>

            {/* The wrapper owns the phone cutoff; the button keeps its own
                1440px cutoff. Stacking both on one element put the icon back
                beside the search box at 1440, because sm:inline-flex outranks
                the arbitrary min-[1440px]:hidden in the generated cascade. */}
            <div className="hidden sm:contents">
              <button
                type="button"
                onClick={openDocsSearch}
                className="inline-flex min-h-11 min-w-11 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] min-[1440px]:hidden"
                aria-label="Search documentation"
              >
                <Search size={16} />
              </button>
            </div>

            <a
              href="https://github.com/curiositech/port-daddy"
              target="_blank"
              rel="noreferrer"
              className="hidden min-h-11 min-w-11 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] sm:inline-flex"
              aria-label="Open GitHub repository"
            >
              <Github size={16} />
            </a>

            <div className="hidden sm:contents">
              <AccountChip />
            </div>

            <AppearanceControl />
          </div>
        </PageContainer>
      </header>
    </>
  );
}
