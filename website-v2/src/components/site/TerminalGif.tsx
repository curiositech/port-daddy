interface TerminalGifProps {
  src: string;
  title: string;
  caption: string;
  className?: string;
  mediaClassName?: string;
}

export function TerminalGif({
  src,
  title,
  caption,
  className = "",
  mediaClassName = "",
}: TerminalGifProps) {
  return (
    <figure
      className={`not-prose overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--code-bg)] ${className}`}
    >
      <div className="flex min-w-0 items-center gap-[var(--space-2)] border-b-2 border-[var(--border-strong)] bg-[var(--code-header-bg)] px-[var(--space-3)] py-[var(--space-2)]">
        <span
          className="h-1.5 w-1.5 bg-[var(--code-dot-red)]"
          aria-hidden="true"
        />
        <span
          className="h-1.5 w-1.5 bg-[var(--code-dot-amber)]"
          aria-hidden="true"
        />
        <span
          className="h-1.5 w-1.5 bg-[var(--code-dot-green)]"
          aria-hidden="true"
        />
        <figcaption className="ml-[var(--space-2)] min-w-0 truncate font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--code-comment)]">
          {title}
        </figcaption>
      </div>
      <div className="overflow-hidden bg-[var(--code-bg)]">
        <img
          src={src}
          alt={caption}
          loading="lazy"
          className={`block h-[clamp(22rem,44vw,38rem)] w-full bg-[var(--code-bg)] object-cover object-top ${mediaClassName}`}
        />
      </div>
      <p className="m-[var(--space-0)] border-t-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-small-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
        {caption}
      </p>
    </figure>
  );
}
