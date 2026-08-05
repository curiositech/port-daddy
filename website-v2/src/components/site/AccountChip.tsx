import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, User } from "lucide-react";

/**
 * AccountChip — the header's signed-in state, fed by the relay's public
 * session probe.
 *
 * The relay (relay.portdaddy.dev) is a separate origin holding the HttpOnly
 * `__Host-pd_session` cookie, so the probe is a credentialed cross-origin
 * fetch against GET /auth/status — an endpoint that returns nothing beyond
 * {login, avatarUrl} and answers with credentialed CORS pinned to
 * https://portdaddy.dev.
 *
 * Graceful degrade is the contract: while loading, when signed out, when the
 * response has an unexpected shape, or when the relay is unreachable at all,
 * the chip renders the plain "Sign in with GitHub" link — a static <a> that
 * still works as navigation even if fetch was blocked. The site never breaks
 * because the relay blinked.
 */

const RELAY_ORIGIN = "https://relay.portdaddy.dev";

type AccountState =
  | { status: "signed-out" }
  | { status: "signed-in"; login: string; avatarUrl: string | null };

function parseStatus(body: unknown): AccountState {
  if (typeof body === "object" && body !== null) {
    const o = body as Record<string, unknown>;
    if (typeof o.login === "string" && o.login.length > 0) {
      return {
        status: "signed-in",
        login: o.login,
        avatarUrl: typeof o.avatarUrl === "string" ? o.avatarUrl : null,
      };
    }
  }
  return { status: "signed-out" };
}

const chipClass =
  "inline-flex shrink-0 items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-2)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]";

const menuItemClass =
  "flex items-center justify-between gap-[var(--space-3)] border-2 border-transparent px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-base)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]";

const ACCOUNT_MENU_ITEMS = [
  { label: "Your runs", href: `${RELAY_ORIGIN}/account/runs` },
  { label: "Account", href: `${RELAY_ORIGIN}/account` },
  { label: "Mercy report", href: `${RELAY_ORIGIN}/account/mercy` },
] as const;

export function AccountChip() {
  const [state, setState] = useState<AccountState>({ status: "signed-out" });

  useEffect(() => {
    let cancelled = false;
    fetch(`${RELAY_ORIGIN}/auth/status`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return { status: "signed-out" } as const;
        return parseStatus(await res.json());
      })
      .catch(() => ({ status: "signed-out" }) as const)
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status !== "signed-in") {
    // Text only, provider-neutral, deliberately narrow: the octocat next door
    // already means "repo", and the header cannot afford a wide chip — GitHub
    // is the sign-in mechanism (relay /login says so), not the label.
    return (
      <a href={`${RELAY_ORIGIN}/login`} className={chipClass} data-account-chip="signed-out">
        Sign in
      </a>
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={chipClass}
          data-account-chip="signed-in"
          aria-label={`Account menu for ${state.login}`}
        >
          {state.avatarUrl ? (
            <img
              src={state.avatarUrl}
              alt=""
              width={20}
              height={20}
              className="h-5 w-5 border border-[var(--border-strong)] object-cover"
            />
          ) : (
            <User size={14} aria-hidden="true" />
          )}
          {/* Avatar-only until ultra-wide; the login label is a luxury the
              header can only afford once the primary nav has fully unfolded. */}
          <span className="hidden max-w-[8rem] truncate min-[1800px]:inline">{state.login}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-[120] grid min-w-[12rem] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] shadow-[var(--shadow-brutal)]"
        >
          {ACCOUNT_MENU_ITEMS.map((item) => (
            <a key={item.href} href={item.href} className={menuItemClass}>
              {item.label}
            </a>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
