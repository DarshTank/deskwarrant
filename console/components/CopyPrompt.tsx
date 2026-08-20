"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A prompt you can lift straight into the chat box.
 *
 * The whole chip is the button rather than a small icon beside it: on a phone
 * the icon-sized target is the difference between copying the prompt and
 * selecting the text by accident.
 */
export function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Blocked by an insecure origin or a denied permission. Staying on
      // "Copy" is the honest outcome -- claiming success would leave someone
      // pasting whatever was on the clipboard before.
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, [text]);

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={`Copy prompt: ${text}`}
      className="group mt-3 flex w-full items-center gap-3 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-left transition-colors hover:border-ink/25"
    >
      <span className="min-w-0 flex-1 text-[14px] leading-snug text-ink">
        {text}
      </span>
      <span
        className={`shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
          copied ? "text-signal" : "text-faint group-hover:text-soft"
        }`}
        aria-live="polite"
      >
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}
