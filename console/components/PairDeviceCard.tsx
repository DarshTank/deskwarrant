"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

interface Minted {
  code: string;
  expiresAt: string;
}

/**
 * Pairing is agent-initiated: you run the agent on the PC and it opens this
 * console to an approval screen. There is nothing to click here first, which is
 * why this card is instructions rather than a button.
 *
 * The typed code below it is the fallback for a PC with no browser and no phone
 * in reach, reached with `--code`. It is folded away because reaching for it
 * when the normal path would have worked is strictly more work.
 */
export function PairDeviceCard({ onPaired }: { onPaired: () => void }) {
  const [minted, setMinted] = useState<Minted | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!minted) return;
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.round((new Date(minted.expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
      // The agent pairs out-of-band, so refresh the device list while a code
      // is live to catch the moment it lands.
      if (remaining > 0) onPaired();
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => clearInterval(timer);
  }, [minted, onPaired]);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<Minted>("/api/devices/pairing-code", {
        method: "POST",
      });
      setMinted(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a code.");
    } finally {
      setBusy(false);
    }
  }

  const expired = minted !== null && secondsLeft <= 0;

  return (
    <div className="border-2 border-border bg-surface p-6">
      <p className="kicker">Pair a new PC</p>
      <h2 className="mt-3 text-[20px] font-bold">Nothing to type.</h2>
      <p className="mt-2 max-w-[60ch] text-[15px] leading-[1.6] text-muted">
        Install DeskWarrant on the Windows PC. It opens a browser here and asks
        you to approve it — pick the four-character code it shows and the PC is
        paired.
      </p>

      <Link
        href="/download"
        className="mt-5 inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 text-[15px] font-extrabold text-accent-fg transition-opacity hover:opacity-90"
      >
        Add a PC
      </Link>

      {!showFallback && (
        <button
          type="button"
          onClick={() => setShowFallback(true)}
          className="mt-5 block text-[13px] uppercase tracking-[0.06em] text-muted transition-colors hover:text-accent"
        >
          Pair with a typed code instead
        </button>
      )}

      {showFallback && (
        <div className="mt-6 border-t-2 border-border pt-5">
          <p className="text-[15px] leading-[1.6] text-muted">
            Run the agent with{" "}
            <code className="bg-background px-1.5 py-0.5 font-mono text-[13px] text-foreground">
              --pair --code
            </code>{" "}
            and enter this. Codes last 10 minutes and work once.
          </p>

          {minted && !expired && (
            <div className="mt-4 border-2 border-accent bg-accent-wash p-5">
              <p className="kicker">Pairing code</p>
              <p className="mt-2 font-mono text-4xl font-extrabold tracking-[0.3em] text-foreground">
                {minted.code}
              </p>
              <p className="mt-2 text-[13px] text-muted">
                Expires in {Math.floor(secondsLeft / 60)}m{" "}
                {String(secondsLeft % 60).padStart(2, "0")}s
              </p>
            </div>
          )}

          {expired && (
            <p className="mt-4 text-[15px] text-warn">
              That code expired. Generate a new one.
            </p>
          )}

          {error && <p className="mt-4 text-[15px] text-danger">{error}</p>}

          <button
            type="button"
            onClick={() => void mint()}
            disabled={busy}
            className="mt-5 border-2 border-accent bg-accent px-4 py-2 text-[14px] font-extrabold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? "Generating…"
              : minted && !expired
                ? "Generate a new code"
                : "Generate pairing code"}
          </button>
        </div>
      )}
    </div>
  );
}
