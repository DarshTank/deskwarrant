/**
 * The mark: a solid accent square with a chevron and a command underscore cut
 * out of it — a prompt, which is what the product actually is.
 */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span
      className="block shrink-0 bg-accent"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 30 30" width={size} height={size}>
        <path
          d="M8 10 L13 15 L8 20"
          fill="none"
          stroke="#fff"
          strokeWidth="2.6"
        />
        <rect x="16" y="18.5" width="7" height="2.5" fill="#fff" />
      </svg>
    </span>
  );
}

export function Wordmark({
  size = 30,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-3 ${className}`}>
      <Logo size={size} />
      <span
        className="font-extrabold tracking-[-0.02em]"
        style={{ fontSize: Math.round(size * 0.6) }}
      >
        DeskWarrant
      </span>
    </span>
  );
}
