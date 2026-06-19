interface ConsoleMotionFigureProps {
  lightSrc: string;
  darkSrc: string;
  lightPoster?: string;
  darkPoster?: string;
  caption: string;
  className?: string;
}

export function ConsoleMotionFigure({
  lightSrc,
  darkSrc,
  lightPoster,
  darkPoster,
  caption,
  className = "",
}: ConsoleMotionFigureProps) {
  return (
    <figure className={`m-0 space-y-[var(--space-2)] ${className}`}>
      <div className="overflow-hidden border border-[var(--border-strong)]">
        <video
          className="block w-full dark:hidden"
          autoPlay
          loop
          muted
          playsInline
          poster={lightPoster}
        >
          <source src={lightSrc} type="video/mp4" />
        </video>
        <video
          className="hidden w-full dark:block"
          autoPlay
          loop
          muted
          playsInline
          poster={darkPoster}
        >
          <source src={darkSrc} type="video/mp4" />
        </video>
      </div>
      <figcaption className="font-sans text-[length:var(--type-small-size)] leading-[var(--leading-body-compact)] text-[var(--text-muted)]">
        {caption}
      </figcaption>
    </figure>
  );
}
