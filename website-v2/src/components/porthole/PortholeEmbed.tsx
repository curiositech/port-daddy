import { useEffect, useRef } from "react";
import { PortholePlayer } from "@/lib/porthole/player";
import "./porthole.css";

export interface PortholeEmbedProps {
  /** URL of the `.cast` file to replay, e.g. `/casts/porthole/collision.cast`. */
  src: string;
  /** Accessible label for the embed; not rendered as a heading — the
   *  caller's own copy carries that. Used for the aria-label only. */
  label: string;
  className?: string;
  /** Skip the "wait until scrolled into view" gate and start loading (and
   *  playing, unless reduced-motion) immediately. Use for an embed that is
   *  already visible on mount — e.g. the active tab of a tabbed demo. */
  eager?: boolean;
}

/**
 * React lifecycle wrapper around {@link PortholePlayer}. Motivation for
 * lazy-by-default: an embed offscreen on page load has no business
 * spending CPU on a playback clock or bytes on a cast fetch nobody has
 * scrolled to yet — `IntersectionObserver` gates both until the embed is
 * actually about to be seen, so a page with several Porthole embeds only
 * pays for the ones a visitor reaches.
 */
export function PortholeEmbed({ src, label, className, eager = false }: PortholeEmbedProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const player = new PortholePlayer(root, { reducedMotion, autoplay: !reducedMotion });

    let cancelled = false;
    const startLoad = () => {
      if (cancelled) return;
      player.load(src).catch((err: unknown) => {
        console.error("Porthole embed failed to load", src, err);
      });
    };

    if (eager) {
      startLoad();
      return () => {
        cancelled = true;
        player.destroy();
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          startLoad();
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(root);

    return () => {
      cancelled = true;
      observer.disconnect();
      player.destroy();
    };
  }, [src, eager]);

  return <div ref={rootRef} className={className} role="group" aria-label={label} />;
}
