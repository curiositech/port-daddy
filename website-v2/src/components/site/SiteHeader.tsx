import { Link, NavLink } from "react-router-dom";
import * as Popover from "@radix-ui/react-popover";
import {
  ChevronDown,
  Github,
  Menu,
  Moon,
  Search,
  Sun,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DocsSearch } from "@/components/docs/DocsSearch";
import { openDocsSearch } from "@/components/docs/docsSearchEvents";
import { useTheme } from "@/lib/theme-context";
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
  { label: "Scout", href: "/scout", end: false },
  { label: "Examples", href: "/examples", end: false },
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
// uncrowded. Docs dropped out of the primary row but stays reachable here.
const OVERFLOW_NAV_ITEMS = [
  { label: "Docs", href: "/docs", end: false },
  { label: "Mac app", href: "/mac-preview", end: false },
  { label: "Run agents on your subscription", href: "/cli-backend", end: true },
  { label: "Tutorials", href: "/tutorials", end: false },
  { label: "Library", href: "/library", end: false },
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
    "shrink-0 items-center gap-[var(--space-2)] border-2 px-[var(--space-2)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] xl:px-[var(--space-3)]",
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
          className="inline-flex shrink-0 items-center gap-[var(--space-2)] border-2 border-transparent px-[var(--space-2)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] xl:px-[var(--space-3)]"
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

function CompressedNavMenu() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] 2xl:hidden"
          aria-label="Open site navigation"
        >
          <Menu size={18} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          className="z-[120] grid w-[min(calc(100vw-var(--space-6)),22rem)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] shadow-[var(--shadow-brutal)]"
        >
          <div className="flex items-center justify-between border-b-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-2)]">
            <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              Site Menu
            </span>
            <Popover.Close asChild>
              <button
                type="button"
                className="inline-flex border-2 border-transparent p-[var(--space-1)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-base)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function SiteHeader() {
  const { theme, toggle } = useTheme();
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
            className="hidden min-w-0 items-center justify-center gap-[var(--space-2)] 2xl:flex"
          >
            {PRIMARY_NAV_ITEMS.map((item) => (
              <PrimaryNavItem key={item.href} item={item} />
            ))}
            <OverflowNavMenu />
          </nav>

          {/* Pin controls to the last column. Below 2xl the primary nav is
              display:none, so without an explicit column it auto-places into the
              empty middle track and the controls float mid-bar. */}
          <div className="flex min-w-0 items-center justify-end gap-[var(--space-2)] lg:col-start-3">
            <CompressedNavMenu />

            {/* min-w kept modest so the search box shrinks before it can ever
                collide with the centered nav or the account chip. */}
            <div className="hidden min-w-[11rem] max-w-[19rem] flex-1 shrink 2xl:block">
              <DocsSearch variant="compact" />
            </div>

            <button
              type="button"
              onClick={openDocsSearch}
              className="inline-flex border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] 2xl:hidden"
              aria-label="Search documentation"
            >
              <Search size={16} />
            </button>

            <a
              href="https://github.com/curiositech/port-daddy"
              target="_blank"
              rel="noreferrer"
              className="hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] sm:inline-flex"
              aria-label="Open GitHub repository"
            >
              <Github size={16} />
            </a>

            <AccountChip />

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggle}
              aria-label="Toggle color theme"
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              <span className="hidden sm:inline">
                {theme === "dark" ? "Light" : "Dark"}
              </span>
            </Button>
          </div>
        </PageContainer>
      </header>
    </>
  );
}
