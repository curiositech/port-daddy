interface ConsoleScreenshotFigureProps {
  lightSrc: string;
  darkSrc: string;
  alt: string;
  caption: string;
  className?: string;
}

export function ConsoleScreenshotFigure({
  lightSrc,
  darkSrc,
  alt,
  caption,
  className = "",
}: ConsoleScreenshotFigureProps) {
  return (
    <figure className={`m-0 space-y-[var(--space-2)] ${className}`}>
      <picture className="block overflow-hidden border border-[var(--border-strong)]">
        <source srcSet={darkSrc} media="(prefers-color-scheme: dark)" />
        <img
          src={lightSrc}
          alt={alt}
          className="block w-full"
          loading="lazy"
          decoding="async"
        />
      </picture>
      <figcaption className="font-sans text-[length:var(--type-small-size)] leading-[var(--leading-body-compact)] text-[var(--text-muted)]">
        {caption}
      </figcaption>
    </figure>
  );
}
