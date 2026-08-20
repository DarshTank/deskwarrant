"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/devices", label: "Devices", icon: MonitorGlyph },
  { href: "/actions", label: "Actions", icon: ListGlyph },
  { href: "/download", label: "Add a PC", icon: PlusGlyph },
];

function useActive() {
  const pathname = usePathname();
  return (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop rail: icon and label, the active item filled rather than underlined. */
export function SidebarLinks() {
  const isActive = useActive();

  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[14px] transition-colors ${
              active
                ? "bg-ink text-paper"
                : "text-soft hover:bg-ink/[0.05] hover:text-ink"
            }`}
          >
            <Icon />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The narrow-screen rail. Labels stay visible — at this many destinations,
 * icons alone would be a guessing game for no space saved.
 */
export function TopBarLinks() {
  const isActive = useActive();

  return (
    <nav className="flex items-center gap-1">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors ${
              active ? "bg-ink text-paper" : "text-soft hover:text-ink"
            }`}
          >
            <Icon />
            <span className="hidden xs:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function MonitorGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8.5 21h7M12 17v4" />
    </svg>
  );
}

function ListGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <line x1="9" y1="7" x2="20" y2="7" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="17" x2="20" y2="17" />
      <circle cx="4.5" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="17" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
