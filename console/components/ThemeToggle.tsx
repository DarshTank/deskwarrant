"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "deskwarrant-theme";

/**
 * Reads the resolved theme on mount rather than assuming one: the bootstrap
 * script in the root layout may already have stamped `data-theme`, and where
 * it has not, the system preference is the truth.
 */
export function ThemeToggle({
  className = "",
  label = false,
}: {
  className?: string;
  label?: boolean;
}) {
  const [theme, setTheme] = useState<Theme | null>(null);

  // Deferred by a tick, matching the rest of the app: reading the DOM and
  // setting state in the effect body cascades an extra render on mount.
  useEffect(() => {
    const timer = setTimeout(() => {
      const stamped = document.documentElement.dataset.theme;
      if (stamped === "light" || stamped === "dark") {
        setTheme(stamped);
        return;
      }
      setTheme(
        window.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
      );
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode — the choice just does not survive the tab */
    }
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={`inline-flex items-center gap-2 text-soft transition-colors hover:text-ink ${className}`}
    >
      {/* Both glyphs render at the same size, so the button never reflows
          between the unresolved state and either theme. */}
      <span className="grid size-[17px] place-items-center">
        {theme === null ? null : isDark ? <SunGlyph /> : <MoonGlyph />}
      </span>
      {label && (
        <span className="text-[14px]">
          {theme === null ? "" : isDark ? "Light" : "Dark"}
        </span>
      )}
    </button>
  );
}

function SunGlyph() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" />
    </svg>
  );
}
