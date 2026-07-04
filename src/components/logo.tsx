/**
 * SelectStar logo mark — an "S" monogram with a star/asterisk accent.
 *
 * Used in the top bar and on the connection screen. The mark is drawn as
 * inline SVG so it inherits the current text color and scales crisply.
 */
export function Logo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-label="SelectStar logo"
      role="img"
    >
      {/* Rounded square background */}
      <rect x="1" y="1" width="30" height="30" rx="8" className="fill-primary" />
      {/* "S" stroke */}
      <path
        d="M22 11.5c0-2.2-2.4-3.8-6-3.8s-6 1.6-6 3.9c0 2 1.5 3.2 4.2 3.7l2.2.4c1.4.3 2 .7 2 1.5 0 1-1.1 1.6-2.8 1.6-1.9 0-3.1-.7-3.3-1.9"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Star/asterisk accent — the "*" in S* */}
      <g className="fill-white">
        <path d="M24.5 20.2l.8-2.1 1 2.1 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.5z" />
      </g>
    </svg>
  );
}

/**
 * Full lockup: logo mark + wordmark. Use in headers and the landing hero.
 */
export function LogoLockup({
  className = "",
  size = "md",
  showBeta = false,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  showBeta?: boolean;
}) {
  const dims = { sm: "h-6 w-6", md: "h-8 w-8", lg: "h-10 w-10" }[size];
  const text = { sm: "text-base", md: "text-lg", lg: "text-xl" }[size];
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Logo className={dims} />
      <span className={`font-semibold tracking-tight ${text}`}>SelectStar</span>
      {showBeta && (
        <span className="ml-0.5 text-[10px] uppercase tracking-widest text-muted-foreground/70 font-medium">
          beta
        </span>
      )}
    </div>
  );
}
