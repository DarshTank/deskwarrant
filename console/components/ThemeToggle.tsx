"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "deskwarrant-theme";

/**
 * Square, bordered, uppercase — the same button shape the rest of the system
 * uses. It reads the resolved theme on mount rather than assuming one: the
 * bootstrap script in the root layout may already have stamped `data-theme`,
 * and where it has not, the system preference is the truth.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
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

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch colour theme"
      className={`inline-flex items-center gap-2 border-2 border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground transition-colors hover:border-accent hover:text-accent ${className}`}
    >
      <span className="mark" aria-hidden="true" />
      {/* Rendered blank until mounted so server and client markup agree. */}
      <span className="min-w-[34px] text-left">
        {theme === null ? "" : theme === "dark" ? "Light" : "Dark"}
      </span>
    </button>
  );
}
