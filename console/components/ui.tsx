/**
 * The console's shared primitives.
 *
 * The landing page does not use these — it is centred, serif-led and mostly
 * one-off typography. This is the workspace vocabulary: pill controls,
 * hairline-bordered panels, and mono for anything the machine reported.
 * Keeping it in one file is what stops eleven screens from each inventing
 * their own button.
 */

import Link from "next/link";

/* -------------------------------------------------------------------------- */
/* buttons                                                                    */
/* -------------------------------------------------------------------------- */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:opacity-85",
  secondary: "border border-line text-ink hover:border-ink/35 hover:bg-ink/[0.04]",
  ghost: "text-soft hover:text-ink hover:bg-ink/[0.04]",
  danger: "border border-danger/35 text-danger hover:bg-danger/10",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px] gap-1.5",
  md: "h-10 px-5 text-[14px] gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
};

function buttonClass(variant: Variant, size: Size, extra = "") {
  return [
    "inline-flex shrink-0 items-center justify-center rounded-full font-medium",
    "transition-[opacity,background-color,border-color,transform] duration-200",
    "disabled:pointer-events-none disabled:opacity-45",
    VARIANT[variant],
    SIZE[size],
    extra,
  ].join(" ");
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return <button className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className = "",
  href,
  ...rest
}: React.ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest} />
  );
}

/** An anchor for real external / non-route URLs, styled as a button. */
export function ButtonAnchor({
  variant = "secondary",
  size = "md",
  className = "",
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return <a className={buttonClass(variant, size, className)} {...rest} />;
}

/* -------------------------------------------------------------------------- */
/* surfaces                                                                   */
/* -------------------------------------------------------------------------- */

export function Panel({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-line bg-raised ${className}`}
    >
      {children}
    </div>
  );
}

export function Eyebrow({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

/** The page title block every console screen opens with. */
export function PageHeading({
  eyebrow,
  title,
  meta,
  actions,
}: {
  eyebrow: string;
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-3 font-serif text-[clamp(30px,5vw,46px)] leading-[1.02] tracking-[-0.028em]">
          {title}
        </h1>
        {meta && (
          <p className="mt-3 font-mono text-[13px] text-faint">{meta}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* status                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A dot that beats while the machine is answering. The beat is the signal —
 * a static green dot and a static grey dot differ only in hue, which is the
 * one channel some people cannot use.
 */
export function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block size-[7px] shrink-0 rounded-full ${
        online ? "bg-online dw-beat" : "bg-offline"
      }`}
      title={online ? "Online" : "Offline"}
      aria-label={online ? "Online" : "Offline"}
      role="img"
    />
  );
}

export function StatusPill({
  online,
  className = "",
}: {
  online: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] ${
        online
          ? "border-signal/25 bg-signal-soft text-signal"
          : "border-line text-faint"
      } ${className}`}
    >
      <StatusDot online={online} />
      {online ? "Online" : "Offline"}
    </span>
  );
}

export function Tag({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: "neutral" | "signal" | "warn" | "danger";
  className?: string;
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "border-line text-soft",
    signal: "border-signal/25 bg-signal-soft text-signal",
    warn: "border-warn/30 text-warn",
    danger: "border-danger/30 text-danger",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* messages                                                                   */
/* -------------------------------------------------------------------------- */

export function Notice({
  tone = "danger",
  className = "",
  children,
}: {
  tone?: "danger" | "warn" | "signal";
  className?: string;
  children: React.ReactNode;
}) {
  const tones = {
    danger: "border-danger/25 bg-danger/[0.07] text-danger",
    warn: "border-warn/30 bg-warn/[0.07] text-warn",
    signal: "border-signal/25 bg-signal-soft text-signal",
  };
  return (
    <p
      className={`rounded-2xl border px-4 py-3 text-[14px] ${tones[tone]} ${className}`}
    >
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* forms                                                                      */
/* -------------------------------------------------------------------------- */

export const inputClass =
  "w-full rounded-full border border-line bg-paper px-4 py-2.5 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus:border-soft";

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] tracking-[0.08em] text-faint uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * A segmented control. Scrolls sideways rather than wrapping when the labels
 * outgrow a narrow screen — a tab rail that reflows to two rows shifts the
 * content below it every time the selection changes.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`no-scrollbar flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-line p-1 ${className}`}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              active
                ? "bg-ink text-paper"
                : "text-soft hover:bg-ink/[0.05] hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
